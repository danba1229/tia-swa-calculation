import { getGitsCatalog, getGitsRange, GITS_SOURCE, GITS_TRAFFIC_PAGE, latestWholeWeek } from '../../../../../lib/gitsTraffic.js';
import { buildWeekAnalysis, isoDate, weekDates } from '../../../../../lib/trafficPeak.js';
import { GgTrafficError } from '../../../../../lib/gyeonggiTraffic.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const station = params.get('station'), week = params.get('week'), source = params.get('source'), direction = params.get('direction') || 'both';
  try {
    if (![ 'both', 'in', 'out' ].includes(direction)) throw new Error();
    if (station || week || source) {
      if (!/^\d{4,5}-\d{1,3}$/.test(station || '') || (!!week === !!source)) throw new Error();
      if (source) { if (!/^20\d{2}-\d{2}$/.test(source)) throw new Error(); isoDate(`${source}-01`); }
      else isoDate(week);
    }
  } catch { return Response.json({ error: '지점번호와 날짜를 확인해 주세요.' }, { status: 400, headers }); }
  try {
    const catalog = await getGitsCatalog();
    const catalogWarning = catalog.cacheInfo?.stale ? 'GITS 지점 목록 갱신 실패 · 이전 목록 사용. ' : '';
    if (!station) return Response.json({ ...catalog, stale: !!catalog.cacheInfo?.stale, refreshing: false, sync: [],
      suggestedWeek: latestWholeWeek(catalog.latestDate), warning: catalogWarning + catalog.warning }, { headers });
    const dates = source ? [`${source}-01`, new Date(Date.UTC(Number(source.slice(0, 4)), Number(source.slice(5)), 0)).toISOString().slice(0, 10)] : weekDates(week);
    const month = catalog.months.find(m => m.month === (source || dates.find(d => catalog.months.some(m => m.month === d.slice(0, 7)))?.slice(0, 7)));
    const point = month?.points.find(p => p.code === station);
    if (!point || dates[0] > catalog.latestDate) return Response.json({ error: 'GITS 공개 기간·지점 목록에 없는 조회입니다.' }, { status: 404, headers });
    const snapshot = await getGitsRange({ station, route: point.route, start: dates[0], end: dates.at(-1) });
    const stale = !!snapshot.cacheInfo?.stale;
    const warning = [catalogWarning, stale ? 'GITS 교통량 갱신 실패 · 이전 검증자료 사용' : '', snapshot.invalidDailyRows ? `일합계 불일치 ${snapshot.invalidDailyRows}행은 결측 처리` : ''].filter(Boolean).join(' ');
    if (source) return new Response(JSON.stringify({ source: GITS_TRAFFIC_PAGE, station, collectedAt: snapshot.collectedAt, checkedAt: snapshot.checkedAt, sourceSha256: snapshot.sourceSha256, stale, warning, rows: snapshot.rawRows }),
      { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="GITS-${station}-${source}.json"` } });
    const analysis = buildWeekAnalysis({ records: snapshot.records, station, week, direction });
    return Response.json({ ...analysis, provider: 'gyeonggi', sourceName: GITS_SOURCE, stale, sync: [],
      warning: [analysis.warning, warning].filter(Boolean).join(' '), sources: [{ month: dates[0].slice(0, 7), fileName: `GITS ${dates[0]}~${dates.at(-1)} ${station} 공식 조회자료`,
        collectedAt: snapshot.collectedAt, checkedAt: snapshot.checkedAt, sourceSha256: snapshot.sourceSha256, sourceUrl: GITS_TRAFFIC_PAGE }] }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof GgTrafficError ? error.message : 'GITS 공식자료 연결·검증에 실패했습니다. 잠시 후 재시도하거나 경기데이터드림 자료를 선택해 주세요.' }, { status: 503, headers });
  }
}
