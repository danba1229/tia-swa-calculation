import XLSX from 'xlsx';
import { persistentTransport } from './transportCache.js';
import { isoDate } from './trafficPeak.js';
import { cleanStationName, cleanLineName } from './seoulSubway.js';
import { sourceDigest, plainHtml, htmlRows, officialBytes } from './officialTransportSource.js';

export const SIN_URL = 'https://www.shinbundang.co.kr/index.jsp?pageID=/dxline/dxline3_1.jsp&open_main=1&open_sub1=4&open_sub2=1';
export const KORAIL_BOARD = 'https://www.korail.com/com/userBoard.do?schBcid=ticketTable&mode=list&page=1&schStr=%EC%88%98%EC%9D%B8&bdCode=_ticketTable02';
const valid = v => v?.rows?.length > 0 && v.sourceSha256 && v.checkedAt;
// Omitting ttl uses the shared monthly boundary: the fifth day at 04:00 KST.
// The 05:00 daily job reads this cache; only an expired/missing entry fetches the operator.
const options = { valid };

export function parseSinStations(html) {
  const entries = [...html.matchAll(/<a href="javascript:search\('(SB\d{3})'\)"[^>]*>[\s\S]*?<span>\s*([^<]+)<br/gi)]
    .map(m => ({ code: m[1], name: cleanStationName(m[2]) }));
  if (entries.length < 10 || new Set(entries.map(e => e.code)).size !== entries.length) throw new Error('신분당선 역 목록 형식 변경');
  return entries;
}
export function parseSinTimetable(html, expectedName) {
  const selected = html.match(/class="sta_txt02"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i)?.[1];
  if (cleanStationName(plainHtml(selected || '')) !== cleanStationName(expectedName)) throw new Error('신분당선 선택 역 불일치');
  if (!html.includes('주말 및 공휴일')) throw new Error('신분당선 운행일 구분 미확인');
  const tables = [...html.matchAll(/<table class="tb_st01">([\s\S]*?)<\/table>/g)];
  if (tables.length !== 2) throw new Error('신분당선 시간표 형식 변경');
  const rows = [];
  tables.forEach(([ , table], index) => {
    const cells = htmlRows(table);
    const header = cells[0];
    if (header?.length !== 3 || header[1] !== '시' || header[0] !== '신사방면' || !/^광교(?:\(경기대\))?방면$/.test(header[2])) throw new Error('신분당선 방향 표기 변경');
    const hours = cells.filter(r => r.length === 3 && /^\d{2}$/.test(r[1]));
    const expectedHours = Array.from({ length: 21 }, (_, i) => String((i + 5) % 24).padStart(2, '0'));
    if (hours.length !== expectedHours.length || hours.some((r, i) => r[1] !== expectedHours[i])) throw new Error('신분당선 시간대 누락');
    for (const r of hours) for (const [col, direction] of [[0, 'U'], [2, 'D']]) {
      if (Number(r[1]) > 25) throw new Error('신분당선 시각 오류');
      const tokens = r[col] ? r[col].split(/\s+/) : [];
      for (const token of tokens) {
        const m = /^(\d{2})(?:\(([^)]+)\))?$/.exec(token);
        if (!m || Number(m[1]) > 59) throw new Error('신분당선 분·행선지 형식 변경');
        for (const day of index === 0 ? ['01'] : ['02', '03']) rows.push({ stationName: cleanStationName(expectedName), dailyTypeCode: day,
          upDownTypeCode: direction, depTime: `${r[1]}${m[1]}00`, endSubwayStationNm: m[2] || header[col].replace(/방면$/, ''), trainType: '일반', source: '신분당선 운영사' });
      }
    }
  });
  if (!rows.length) throw new Error('신분당선 시간표 없음');
  return rows;
}
export async function sinCatalog({ cache = persistentTransport, fetchImpl = fetch } = {}) {
  return cache('operator-sin-stations-v1', async () => {
    const { bytes } = await officialBytes(SIN_URL, { fetchImpl });
    return { stations: parseSinStations(new TextDecoder('euc-kr').decode(bytes)) };
  }, { valid: v => v?.stations?.length >= 10 });
}
export async function sinTimetable(entry, { cache = persistentTransport, fetchImpl = fetch } = {}) {
  return cache(`operator-sin-v1:${entry.code}`, async () => {
    const body = new URLSearchParams({ pageID: '/dxline/dxline3_1.jsp', open_main: '1', open_sub1: '4', open_sub2: '1', st_cd: entry.code });
    const { bytes } = await officialBytes('https://www.shinbundang.co.kr/index.jsp', { fetchImpl, method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const html = new TextDecoder('euc-kr').decode(bytes);
    return { rows: parseSinTimetable(html, entry.name), sourceUrl: SIN_URL, sourceSha256: sourceDigest(bytes), checkedAt: new Date().toISOString(), effectiveDate: '' };
  }, options);
}

// The operator workbook uses abbreviated operational station names, not fuzzy matches.
const KORAIL_NAMES = { 신인천: '인천', 남동인: '남동인더스파크', 인천논: '인천논현', 소래포: '소래포구', 신길온: '신길온천', 신수원: '수원', 수원시: '수원시청', 매탄권: '매탄권선', 대모산: '대모산입구', 강남구: '강남구청', 로데오: '압구정로데오', 구룡역: '구룡' };
const korailName = name => KORAIL_NAMES[String(name).trim()] || cleanStationName(name);
export function selectKorailTimetable(data, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })) {
  if (!Array.isArray(data?.boardList) || data.strResult !== 'SUCC') throw new Error('코레일 게시목록 형식 변경');
  const candidates = data.boardList.filter(r => /^수인분당선.*시각표/.test(r.bdTitle)).map(r => {
    const m = r.bdTitle.match(/(20\d{2})[.년]\s*(\d{1,2})[.월]\s*(\d{1,2})[.일]/);
    if (!m) throw new Error('코레일 시행일 표기 변경');
    const effectiveDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    isoDate(effectiveDate);
    return { ...r, effectiveDate };
  }).filter(r => r.effectiveDate && r.effectiveDate <= today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const item = candidates[0], file = item?.fileId?.[0];
  if (!item || item.fileId.length !== 1 || !/^jfile\/\d{6}\/\d{2}\/[a-zA-Z0-9]+\.xlsx$/.test(file)) throw new Error('시행 중인 코레일 시간표 파일 미확인');
  return { effectiveDate: item.effectiveDate, title: item.bdTitle, sourceUrl: `https://www.korail.com/file/cubedata/COMMON/${file}` };
}
export function parseKorailTimetable(bytes) {
  const workbook = XLSX.read(bytes, { type: 'buffer' }), rows = [];
  for (const [sheetName, days, direction] of [['평일상행', ['01'], 'U'], ['평일하행', ['01'], 'D'], ['휴일상행', ['02', '03'], 'U'], ['휴일하행', ['02', '03'], 'D']]) {
    if (!workbook.Sheets[sheetName]) throw new Error('코레일 운행일·방향 시트 변경');
    const cells = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    const destIndex = cells.findIndex(r => r[0] === '종착역'), trainIndex = cells.findIndex(r => r[0] === '열차번호');
    if (destIndex < 0 || trainIndex !== destIndex + 1) throw new Error('코레일 열차 표 형식 변경');
    let count = 0;
    for (let i = trainIndex + 1; i < cells.length; i++) {
      if (!String(cells[i][0] || '').trim()) continue;
      const name = korailName(cells[i][0]), departures = cells[i + 1];
      if (!departures || String(departures[0] || '').trim()) throw new Error('코레일 도착·출발 행 형식 변경');
      for (let col = 1; col < cells[trainIndex].length; col++) {
        const time = String(departures[col] || '').trim();
        if (!time || ['通過', '통과', '↓', '↑', '…', '－', '-'].includes(time)) continue;
        const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(time);
        if (!m || Number(m[1]) > 29 || !/^K\d+$/.test(String(cells[trainIndex][col]))) throw new Error('코레일 출발 시각·열차번호 형식 변경');
        const destination = korailName(cells[destIndex][col]);
        if (!destination) throw new Error('코레일 행선지 누락');
        for (const day of days) rows.push({ stationName: name, dailyTypeCode: day, upDownTypeCode: direction, endSubwayStationNm: destination,
          depTime: `${m[1].padStart(2, '0')}${m[2]}${m[3]}`, trainType: '미제공', source: '코레일 수인분당선 공식 시각표' });
        count++;
      }
      i++;
    }
    if (count < 100) throw new Error('코레일 시각표 누락');
  }
  return rows;
}
export async function korailTimetable({ cache = persistentTransport, fetchImpl = fetch } = {}) {
  return cache('operator-korail-suin-v1', async () => {
    const board = await officialBytes(KORAIL_BOARD, { fetchImpl });
    const selected = selectKorailTimetable(JSON.parse(board.bytes.toString('utf8')));
    const { bytes } = await officialBytes(selected.sourceUrl, { fetchImpl });
    return { ...selected, rows: parseKorailTimetable(bytes), sourceSha256: sourceDigest(bytes), checkedAt: new Date().toISOString() };
  }, options);
}
export async function operatorSubwayTimetable(station, deps = {}) {
  const line = cleanLineName(station.line || ''), name = cleanStationName(String(station.stationName || '').split(/\s+(?:신분당|수인분당)/)[0]);
  let data;
  if (line === '신분당') {
    const catalog = await sinCatalog(deps), entry = catalog.stations.find(s => s.name === name);
    if (!entry) throw new Error('신분당선 운영사 역명 미일치');
    data = await sinTimetable(entry, deps);
  } else if (line === '수인분당') data = await korailTimetable(deps);
  else return null;
  const rows = data.rows.filter(r => r.stationName === name).map(r => ({ ...r, subwayStationId: station.subwayStationId }));
  if (!rows.length) throw new Error('운영사 시간표 역명 미일치');
  return { ...data, rows };
}
