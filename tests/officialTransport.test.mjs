import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { parseSinTimetable, parseSinStations, parseKorailTimetable, selectKorailTimetable, operatorSubwayTimetable, sinTimetable, korailTimetable } from '../lib/operatorSubway.js';
import { isCurrentTransportMonth } from '../lib/transportRefreshPolicy.js';
import { createPersistentTransportCache } from '../lib/transportCache.js';
import { parseGitsPage, parseGitsForm, latestWholeWeek, getGitsRange } from '../lib/gitsTraffic.js';
import { parseGgTraffic } from '../lib/gyeonggiTraffic.js';
import { buildWeekAnalysis } from '../lib/trafficPeak.js';
import { getSubwaySchedule, summarizeSubwayTimes } from '../lib/subway.js';
import { pendingSubwaySlots, mergeSubwaySlots } from '../lib/client/transportEnrichment.js';
import { GET as officialCron } from '../app/api/cron/official-transport-sync/route.js';
import { GET as ggCron } from '../app/api/cron/gyeonggi-traffic-sync/route.js';
import { GET as officialRoute } from '../app/api/traffic-volume/gyeonggi/official/route.js';
const fixture = name => fs.readFileSync(new URL(`./fixtures/official-transport/${name}`, import.meta.url), 'utf8');
const sinHtml = fixture('sin-yangjae.html'), ggHtml = fixture('gits-week.html');
const query = { routes: ['1'], start: '2025-12-22', end: '2025-12-28', direction: '1' };
const workbook = JSON.parse(fixture('korail-sample.json'));
function korailBytes(data = workbook) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(data)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
test('operator Yangjae table explicitly covers Saturday and Sunday, destinations and overnight times', () => {
  const rows = parseSinTimetable(sinHtml, '양재');
  assert.equal(rows.length, 862);
  assert.deepEqual(rows.filter(r => r.dailyTypeCode === '02').map(r => r.depTime), rows.filter(r => r.dailyTypeCode === '03').map(r => r.depTime));
  const normalized = rows.map(r => ({ ...r, subwayStationId: 'MTRDXD1D008' }));
  const summary = summarizeSubwayTimes(normalized.filter(r => r.dailyTypeCode === '01' && r.upDownTypeCode === 'D'), 'MTRDXD1D008', '01', 'D');
  assert.equal(summary.invalid, 0);
  assert.equal(summary.rows.find(r => r.destination === '정자').lastTime, '익일 00:29');
  assert.throws(() => parseSinTimetable(sinHtml, '강남'), /불일치/);
  assert.throws(() => parseSinTimetable(sinHtml.replace('주말 및 공휴일', '평일'), '양재'), /운행일/);
  assert.throws(() => parseSinTimetable(sinHtml.replace('45 55', '75 55'), '양재'), /형식/);
  assert.throws(() => parseSinStations('changed page'), /역 목록/);
});
test('Korail selects effective rather than future schedule and restricts file locations', () => {
  const board = JSON.parse(fixture('korail-board.json'));
  assert.equal(selectKorailTimetable(board, '2026-10-15').effectiveDate, '2026-08-22');
  assert.equal(selectKorailTimetable(board, '2026-08-21').effectiveDate, '2026-02-28');
  board.boardList[0].fileId = ['../../secret.xlsx'];
  assert.throws(() => selectKorailTimetable(board, '2026-10-15'), /파일/);
});
test('Korail reads departure row, exact station aliases and official holiday sheets', () => {
  const rows = parseKorailTimetable(korailBytes());
  const first = rows.find(r => r.stationName === '수원시청' && r.dailyTypeCode === '02' && r.upDownTypeCode === 'U');
  assert.equal(first.depTime, '053900');
  assert.equal(first.endSubwayStationNm, '왕십리');
  assert.ok(rows.some(r => r.stationName === '인천' && r.dailyTypeCode === '03'));
  assert.ok(!rows.some(r => r.stationName === '수원시'));
  const changed = structuredClone(workbook); delete changed['휴일상행'];
  assert.throws(() => parseKorailTimetable(korailBytes(changed)), /시트/);
  const bad = structuredClone(workbook); bad['평일상행'][5][1] = 'invalid';
  assert.throws(() => parseKorailTimetable(korailBytes(bad)), /시각/);
});
test('unrelated subway lines do not call the operator websites', async () => {
  assert.equal(await operatorSubwayTimetable({ line: '1호선', stationName: '수원역 1호선' }, { fetchImpl: () => assert.fail() }), null);
});
test('operator rows precede APIs, retain true check date, and stale operator data stay partial', async () => {
  const station = { subwayStationId: 'MTRDXD1D008', line: '신분당선', stationName: '양재역 신분당선' };
  const data = { rows: parseSinTimetable(sinHtml, '양재').map(r => ({ ...r, subwayStationId: station.subwayStationId })), checkedAt: '2026-10-15T00:00:00Z', sourceSha256: 'hash', sourceUrl: 'https://www.shinbundang.co.kr/', cacheInfo: { stale: false } };
  const calls = [];
  const deps = { operator: async () => data, cache: async (key, loader, options) => { calls.push([key, options.ttl]); return loader(); }, tago: () => assert.fail('unneeded API'), seoul: () => assert.fail('unneeded API') };
  const first = await getSubwaySchedule(station, ['02:U', '02:D'], deps);
  assert.equal(first.status, 'SUCCESS'); assert.equal(first.slots[0].checkedAt, data.checkedAt);
  assert.equal(calls[0][1], undefined, 'subway summary cache uses the monthly policy');
  data.cacheInfo.stale = true;
  const stale = await getSubwaySchedule(station, ['02:U'], deps);
  assert.equal(stale.status, 'PARTIAL'); assert.match(stale.error, /이전 저장/);
  assert.notEqual(calls[0][0], calls.at(-1)[0]);
});
test('GITS verifies headers, periods, directions, daily sums and never uses aggregate direction 0 as a measurement', () => {
  const parsed = parseGitsPage(ggHtml, query);
  assert.equal(parsed.total, 21); assert.equal(parsed.rows.length, 21);
  const snapshot = parseGgTraffic(parsed.rows);
  assert.equal(snapshot.invalidDailyRows, 0);
  const analysis = buildWeekAnalysis({ records: snapshot.records, station: '0134-00', week: query.start });
  assert.equal(analysis.validHours, 0); // Only one direction: no invented sums.
  const inbound = buildWeekAnalysis({ records: snapshot.records, station: '0134-00', week: query.start, direction: 'in' });
  assert.equal(inbound.validHours, 168);
  assert.throws(() => parseGitsPage(ggHtml, { ...query, direction: '2' }), /불일치/);
  assert.throws(() => parseGitsPage(ggHtml, { ...query, start: '2025-12-23' }), /불일치/);
  assert.throws(() => parseGitsPage(ggHtml.replaceAll('00~01시', '01~02시'), query), /시간대/);
  assert.throws(() => parseGitsPage('<html>upstream error</html>', query), /형식/);
});
test('GITS latest year comes from official calendar, not local current year', () => {
  const html = `maxDate: new Date('2025-12-31') <input name="_csrf" value="anonymous"><input name="lineLocal01" value="1"><input name="lineLocal01" value="3"><input name="lineLocal01" value="6">`;
  assert.equal(parseGitsForm(html).latestDate, '2025-12-31');
  assert.throws(() => parseGitsForm(html.replace('2025-12-31', '2025-02-30')));
  assert.equal(latestWholeWeek('2025-12-31'), '2025-12-22');
  assert.equal(latestWholeWeek('2025-12-28'), '2025-12-22');
});
test('GITS range rejects invalid requests before network and cannot replace complete data with missing directions', async () => {
  await assert.rejects(getGitsRange({ station: '../x', route: '1', start: '2025-12-22', end: '2025-12-28' }), /조건/);
  await assert.rejects(getGitsRange({ station: '0134-00', route: '1', start: '2025-01-01', end: '2025-12-31' }), /조건/);
  let options;
  await getGitsRange({ station: '0134-00', route: '1', start: '2025-12-22', end: '2025-12-28' }, { cache: async (_key, _load, opts) => { options = opts; return {}; } });
  assert.equal(options.ttl, undefined, 'GITS periods use the monthly policy');
  assert.equal(options.complete({ invalidDailyRows: 0, missingValues: 0, records: Array(7) }), false);
  assert.equal(options.complete({ invalidDailyRows: 0, missingValues: 0, records: Array(14) }), true);
});
test('saved successful subway slots become retryable at the monthly KST boundary', () => {
  const checkedAt = '2026-10-15T00:00:00Z', now = Date.parse('2026-11-04T19:00:00Z');
  const keys = ['01:U', '01:D', '02:U', '02:D', '03:U', '03:D'];
  const station = { scheduleSlots: keys.map(key => ({ key, status: 'SUCCESS', checkedAt })) };
  assert.deepEqual(pendingSubwaySlots(station, now - 1), []);
  assert.deepEqual(pendingSubwaySlots(station, now), keys);
});
test('scheduled collectors reject unauthenticated requests and public route rejects invalid ranges', async () => {
  for (const handler of [officialCron, ggCron]) assert.equal((await handler(new Request('https://example.test/api/cron'))).status, 401);
  for (const query of ['station=foo&week=2025-12-22', 'source=2025-12', 'station=0134-00&week=2025-99-99', 'direction=invalid']) {
    assert.equal((await officialRoute(new Request(`https://example.test/api/traffic?${query}`))).status, 400);
  }
});
test('GITS anonymous form collection validates every page and retains both source directions', async () => {
  const form = `maxDate: new Date('2025-12-31') <input name="_csrf" value="anonymous"><input name="lineLocal01" value="1"><input name="lineLocal01" value="3"><input name="lineLocal01" value="6">`;
  const calls = [];
  const fetchImpl = async (_url, opts = {}) => {
    if (!opts.body) return new Response(form, { headers: { 'set-cookie': 'JSESSIONID=public-test; Path=/; Secure' } });
    const params = new URLSearchParams(opts.body); calls.push(params.get('direction'));
    assert.equal(opts.headers.Cookie, 'JSESSIONID=public-test');
    assert.equal(params.get('_csrf'), 'anonymous');
    return new Response(params.get('direction') === '1' ? ggHtml : ggHtml.replaceAll('상행', '하행'));
  };
  const input = { station: '0134-00', route: '1', start: '2025-12-22', end: '2025-12-28' };
  const snapshot = await getGitsRange(input, { cache: (_k, loader) => loader(), fetchImpl });
  assert.deepEqual(calls.sort(), ['1', '2']); assert.equal(snapshot.records.length, 14);
  assert.equal(buildWeekAnalysis({ records: snapshot.records, station: input.station, week: input.start }).validHours, 168);
  const repeating = async (url, opts) => {
    const response = await fetchImpl(url, opts);
    if (!opts.body) return response;
    return new Response((await response.text()).replace('총 21건', '총 42건').replace('</select>', '<option value="2">2 / 2</option></select>'));
  };
  await assert.rejects(getGitsRange(input, { cache: (_k, loader) => loader(), fetchImpl: repeating }), /페이지 반복/);
});

test('retained subway rows keep their original source and check date after a failed update', () => {
  const previous = { key: '02:U', status: 'SUCCESS', sourceUrl: 'https://old.example/', effectiveDate: '2026-08-22', checkedAt: '2026-10-14T00:00:00Z', schedules: [{ day: '토요일', direction: '상행(U)', firstTime: '05:39', lastTime: '23:00' }] };
  const result = mergeSubwaySlots({ scheduleSlots: [previous], schedules: previous.schedules }, [{ ...previous, sourceUrl: 'https://new.example/', checkedAt: '2026-10-15T00:00:00Z', status: 'PARTIAL', schedules: [], error: '갱신 실패' }]);
  assert.equal(result.scheduleSlots[0].sourceUrl, previous.sourceUrl);
  assert.equal(result.scheduleSlots[0].checkedAt, previous.checkedAt);
  assert.equal(result.scheduleSlots[0].retained, true);
});

test('operator timetables reuse daily requests until the monthly fifth-day KST boundary', async () => {
  let now = Date.parse('2026-10-15T00:00:00Z'), loads = 0;
  const entries = new Map();
  const store = {
    read: async key => entries.get(key), claim: async () => true,
    save: async (key, _token, value, expires) => { entries.set(key, { value, expires, updated: now }); return true; },
    fail: async () => {},
  };
  const cache = createPersistentTransportCache({ store, now: () => now });
  const board = fixture('korail-board.json'), bytes = korailBytes();
  const fetchImpl = async url => {
    loads++;
    if (String(url).includes('userBoard')) return new Response(board);
    if (String(url).endsWith('.xlsx')) return new Response(bytes);
    throw new Error('Unexpected fetch');
  };
  const deps = { cache, fetchImpl };
  const first = await korailTimetable(deps);
  assert.equal(loads, 2);
  assert.equal(new Date([...entries.values()][0].expires).toISOString(), '2026-11-04T19:00:00.000Z');
  now += 86400000;
  assert.equal((await korailTimetable(deps)).sourceSha256, first.sourceSha256);
  assert.equal(loads, 2, 'next-day query must not download the workbook again');
  now = Date.parse('2026-11-04T18:59:59Z');
  await korailTimetable(deps); assert.equal(loads, 2);
  now = Date.parse('2026-11-04T20:00:00Z');
  await korailTimetable(deps); assert.equal(loads, 4, 'monthly scheduled job downloads the new source');
  let sinOptions;
  await sinTimetable({ code: 'SB005', name: '양재' }, { cache: async (_key, _loader, options) => { sinOptions = options; return {}; } });
  assert.equal(sinOptions.ttl, undefined, 'Shinbundang uses the same monthly cache policy');
});

test('traffic snapshots remain current across days but expire exactly at the monthly boundary', () => {
  const collected = Date.parse('2026-10-15T00:00:00Z');
  assert.equal(isCurrentTransportMonth(collected, Date.parse('2026-10-31T00:00:00Z')), true);
  assert.equal(isCurrentTransportMonth(collected, Date.parse('2026-11-04T18:59:59Z')), true);
  assert.equal(isCurrentTransportMonth(collected, Date.parse('2026-11-04T19:00:00Z')), false);
  const refreshed = Date.parse('2026-11-04T20:30:00Z');
  assert.equal(isCurrentTransportMonth(refreshed, Date.parse('2026-11-05T00:00:00Z')), true);
  assert.equal(isCurrentTransportMonth(NaN), false);
});
test('official transport and Gyeonggi jobs run monthly in KST without changing other jobs', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const jobs = Object.fromEntries(config.crons.map(job => [job.path, job.schedule]));
  assert.equal(jobs['/api/cron/official-transport-sync'], '0 20 4 * *');
  assert.equal(jobs['/api/cron/gyeonggi-traffic-sync'], '30 20 4 * *');
  assert.equal(jobs['/api/cron/tia-sync'], '0 18 * * *');
});
