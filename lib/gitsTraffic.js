import { persistentTransport } from './transportCache.js';
import { OFFICIAL_TTL, officialBytes, htmlRows } from './officialTransportSource.js';
import { parseGgTraffic, GgTrafficError } from './gyeonggiTraffic.js';
import { isoDate, shiftDate, mondayOf } from './trafficPeak.js';

export const GITS_TRAFFIC_PAGE = 'https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/alwaysTrafficVolumeByTime.do';
export const GITS_SOURCE = '경기도 교통정보센터 상시교통량(일반국도 시간대별)';
export function parseGitsForm(html) {
  const dates = [...html.matchAll(/maxDate:\s*new Date\('(\d{4}-\d{2}-\d{2})'\)/g)].map(m => m[1]);
  const routes = [...html.matchAll(/name="lineLocal01"[^>]*value="(\d+)"/g)].map(m => m[1]);
  const csrf = html.match(/name="_csrf" value="([a-zA-Z0-9_-]+)"/)?.[1];
  if (!csrf || !dates.length || new Set(dates).size !== 1 || routes.length < 3 || routes.length > 50) throw new GgTrafficError('경기도 교통정보센터 조회 형식이 변경됐습니다.');
  isoDate(dates[0]);
  return { latestDate: dates[0], routes, csrf };
}
export function parseGitsPage(html, { start, end, direction, routes }) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1]).find(t => t.includes('지점번호') && t.includes('전일합계'));
  const totalMatch = html.match(/총\s*([\d,]+)건/), paging = html.match(/<select id="paging"[^>]*>([\s\S]*?)<\/select>/i)?.[1];
  if (!table || !totalMatch || paging === undefined) throw new GgTrafficError('경기도 교통정보센터 표 형식 변경·누락');
  const hours = [...table.matchAll(/<th[^>]*>\s*(\d{2})~(\d{2})시\s*<\/th>/g)];
  if (hours.length !== 24 || hours.some((m, i) => Number(m[1]) !== i || Number(m[2]) !== i + 1)) throw new GgTrafficError('경기도 시간대 순서가 변경됐습니다.');
  const total = Number(totalMatch[1].replaceAll(',', ''));
  const pages = Math.max(1, ...[...paging.matchAll(/value="(\d+)"/g)].map(m => Number(m[1])));
  if (!Number.isSafeInteger(total) || total > 10000 || pages > 100) throw new GgTrafficError('경기도 조회 건수 상한 초과');
  const rows = [];
  for (const cells of htmlRows(table)) {
    if (cells[0] === '지점번호' || cells[0] === '00~01시') continue;
    if (!/^\d{4,5}-\d{1,3}$/.test(cells[0] || '')) {
      if (total > 0 && cells.length === 33) throw new GgTrafficError('경기도 지점번호 형식 변경');
      continue;
    }
    if (cells.length !== 33) throw new GgTrafficError('경기도 시간대 열 누락');
    const route = /^일반국도 (\d+)호선$/.exec(cells[1])?.[1];
    const year = /^(20\d{2})년$/.exec(cells[2])?.[1], month = /^(\d{1,2})월$/.exec(cells[3])?.[1], day = /^(\d{1,2})일$/.exec(cells[4])?.[1];
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    isoDate(date);
    if (!routes.includes(route) || date < start || date > end || cells[5] !== { 0: '양방향', 1: '상행', 2: '하행' }[direction]) throw new GgTrafficError('경기도 조회 조건·응답 불일치');
    const row = { SPOT_NO_INFO: cells[0], ROUTE_NM: cells[1], YY: year, MT: month, DE: day, UPNDW_CD: String(direction), UPNDW_DIV: cells[5], REGION: cells[6], CIRCUMFR_BFRCT_NM: cells[7], TDAY_SUM: cells[32], route };
    cells.slice(8, 32).forEach((v, i) => { row[`TM${String(i + 1).padStart(2, '0')}_TRNSPORT_AMNT`] = v; });
    rows.push(row);
  }
  if (total > 0 && !rows.length) throw new GgTrafficError('경기도 조회 결과 누락');
  return { rows, total, pages };
}
async function openGits(fetchImpl) {
  const { bytes, headers } = await officialBytes(GITS_TRAFFIC_PAGE, { fetchImpl });
  const form = parseGitsForm(bytes.toString('utf8'));
  // Anonymous site session and its own form token; never stored or logged.
  const cookies = (headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  return { ...form, cookies };
}
async function collectRange(session, query, fetchImpl, deadline) {
  const result = [], signatures = new Set(); let total, pages;
  for (let page = 1; page <= (pages || 1); page++) {
    if (Date.now() >= deadline) throw new GgTrafficError('경기도 교통정보센터 조회 시간 초과');
    const body = new URLSearchParams({ _csrf: session.csrf, searchDiv: '2', mode: page === 1 ? '' : 'Page', startDate: query.start, endDate: query.end,
      direction: String(query.direction), T_Start: '0', T_End: '24', pageIndex: String(page) });
    query.routes.forEach(route => body.append('lineLocal01', route));
    const { bytes } = await officialBytes(GITS_TRAFFIC_PAGE.replace('Time.do', 'TimeLoad.do'), { fetchImpl, method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: session.cookies, Referer: GITS_TRAFFIC_PAGE }, timeout: Math.min(15000, Math.max(1, deadline - Date.now())) });
    const parsed = parseGitsPage(bytes.toString('utf8'), query);
    const signature = JSON.stringify(parsed.rows);
    if (signatures.has(signature) || (total !== undefined && (total !== parsed.total || pages !== parsed.pages))) throw new GgTrafficError('경기도 페이지 반복·수집 중 변경');
    signatures.add(signature); total = parsed.total; pages = parsed.pages; result.push(...parsed.rows);
  }
  if (result.length !== total) throw new GgTrafficError('경기도 일부 페이지 누락');
  return result;
}
export async function collectGitsCatalog({ fetchImpl = fetch } = {}) {
  const session = await openGits(fetchImpl), deadline = Date.now() + 70000, points = new Map();
  // Code 0 is used only for the published station index, never as a traffic measurement.
  for (let i = 0; i < session.routes.length; i += 9) {
    const groups = Array.from({ length: Math.ceil(Math.min(9, session.routes.length - i) / 3) }, (_, j) => session.routes.slice(i + j * 3, i + j * 3 + 3));
    const batches = await Promise.all(groups.map(routes => collectRange(session, { routes, start: session.latestDate, end: session.latestDate, direction: 0 }, fetchImpl, deadline)));
    for (const row of batches.flat()) {
      if (points.has(row.SPOT_NO_INFO)) throw new GgTrafficError('경기도 지점 목록 중복');
      points.set(row.SPOT_NO_INFO, { code: row.SPOT_NO_INFO, route: row.route, name: `${row.ROUTE_NM} · ${row.REGION} · ${row.CIRCUMFR_BFRCT_NM}`,
        directions: { in: '1: 상행', out: '2: 하행' }, locationVerified: false });
    }
  }
  if (!points.size) throw new GgTrafficError('경기도 최신 연도 지점 목록이 비어 있습니다.');
  const list = [...points.values()].sort((a, b) => a.code.localeCompare(b.code));
  const latestMonth = session.latestDate.slice(0, 7);
  return { provider: 'gyeonggi', sourceName: GITS_SOURCE, sourceUrl: GITS_TRAFFIC_PAGE, latestDate: session.latestDate,
    checkedAt: new Date().toISOString(), collectedAt: new Date().toISOString(),
    months: Array.from({ length: Number(latestMonth.slice(5)) }, (_, i) => ({ month: `${latestMonth.slice(0, 4)}-${String(Number(latestMonth.slice(5)) - i).padStart(2, '0')}`,
      sourceType: 'gits', points: list })),
    warning: `GITS 공개 연도 ${latestMonth.slice(0, 4)}년. 지점 목록은 ${session.latestDate} 기준이며 선택 주간의 관측값은 조회 후 검증합니다. 연 단위 공개자료로 실시간 교통량이 아닙니다.` };
}
export function getGitsCatalog({ cache = persistentTransport, fetchImpl = fetch } = {}) {
  return cache('gits-traffic-catalog-v1', () => collectGitsCatalog({ fetchImpl }), { ttl: OFFICIAL_TTL, valid: v => v?.months?.length > 0 && v.latestDate });
}
export async function getGitsRange({ station, route, start, end }, { cache = persistentTransport, fetchImpl = fetch } = {}) {
  isoDate(start); isoDate(end);
  if (!/^\d{4,5}-\d{1,3}$/.test(station) || !/^\d{1,3}$/.test(route) || end < start || (isoDate(end) - isoDate(start)) / 86400000 > 31) throw new GgTrafficError('경기도 조회 조건 오류');
  return cache(`gits-traffic-range-v1:${station}:${route}:${start}:${end}`, async () => {
    const session = await openGits(fetchImpl), deadline = Date.now() + 70000;
    if (!session.routes.includes(route)) throw new GgTrafficError('경기도 공식 노선 목록 불일치');
    const batches = await Promise.all(['1', '2'].map(direction => collectRange(session, { routes: [route], start, end, direction }, fetchImpl, deadline)));
    const rows = batches.flat().filter(r => r.SPOT_NO_INFO === station);
    if (!rows.length) throw new GgTrafficError('선택 지점·기간의 GITS 관측자료가 없습니다. 다른 주간을 선택해 주세요.');
    const parsed = parseGgTraffic(rows);
    return { ...parsed, sourceName: GITS_SOURCE, sourceUrl: GITS_TRAFFIC_PAGE };
  }, { ttl: OFFICIAL_TTL, valid: v => v?.records?.length > 0, complete: v => v.invalidDailyRows === 0 && v.missingValues === 0 && v.records.length === ((isoDate(end) - isoDate(start)) / 86400000 + 1) * 2 });
}
export function latestWholeWeek(latestDate) {
  const monday = mondayOf(latestDate);
  return shiftDate(monday, isoDate(latestDate).getUTCDay() === 0 ? 0 : -7);
}
