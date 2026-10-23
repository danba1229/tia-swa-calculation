import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInvestigationSite } from '../lib/siteGeocode.js';
import { createRequestGate } from '../lib/researchIntegrity.js';
import { createTransportSearch } from '../lib/client/createTransportSearch.js';
import { createDevelopmentSearch } from '../lib/client/createDevelopmentSearch.js';
import { summarizeProjects } from '../lib/tiaScope.js';
import { tiaDatabaseUrl } from '../lib/tiaDatabase.js';
import { fetchTiaProjects, rawProjectKey } from '../lib/tiaApi.js';
import { collectTiaBusinessPeriod } from '../lib/tiaBusinessSync.js';
import { createBackgroundSnapshotReader } from '../lib/backgroundSnapshot.js';
import { busGapSummary } from '../lib/client/transportEnrichment.js';
import { getSubwaySchedule } from '../lib/subway.js';
import { createSubwayRows, subwaySlotStatus } from '../lib/subwayTable.js';

const site = { address: '서초구 남부순환로 2584', matchedAddress: '서울 서초구 남부순환로 2584', status: 'ready', lat: 37.483625, lng: 127.032683 };
test('current canonical address is shared; old address and invalid coordinates cannot be reused', async () => {
  const ready = await resolveInvestigationSite(site.address, site, { fetchImpl: () => assert.fail('already resolved') });
  assert.equal(ready.address, site.matchedAddress);
  let queries = [];
  const fetchImpl = async (_, opts) => { queries.push(JSON.parse(opts.body).address); return Response.json({ success: true, matchedAddress: '경기 수원시 팔달구 효원로 241', latitude: 37.263, longitude: 127.028 }); };
  const next = await resolveInvestigationSite('수원시 팔달구 효원로 241', site, { fetchImpl });
  assert.equal(next.address, '경기 수원시 팔달구 효원로 241');
  assert.deepEqual(queries, ['수원시 팔달구 효원로 241']);
  await assert.rejects(resolveInvestigationSite('bad', null, { fetchImpl: async () => Response.json({ success: true, latitude: 0, longitude: 0 }) }), /주소/);
});
test('cancelled geocoding cannot launch an investigation at the previous address', async () => {
  const abort = new AbortController(); let finish;
  const pending = resolveInvestigationSite('old', null, { signal: abort.signal, fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  abort.abort(); finish(Response.json({ success: true, matchedAddress: site.matchedAddress, latitude: site.lat, longitude: site.lng }));
  await assert.rejects(pending, { name: 'AbortError' });
});
test('transport classifies the geocoded address even if the input omits Seoul', async () => {
  let state = { basics: { siteAddress: site.address } }; const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ success: true, stations: [], busStops: [], summary: { returnedCount: 0 } }); };
  try {
    await createTransportSearch({ form: state, requestGateRef: { current: createRequestGate() }, safe: String, toNumber: Number, formatNumber: String,
      getScopeDimensions: () => ({ width: 500, height: 500 }), computeRectangleBounds: () => ({ north: 38, south: 37, east: 128, west: 126 }),
      createBlankPublicTransportResult: value => value, detectSurveyRegion: address => address.startsWith('서울 ') ? 'seoul' : '',
      resolveSite: () => resolveInvestigationSite(site.address, site), resolveScopeCenter: () => assert.fail('verified coordinates must be reused'),
      setForm: update => { state = update(state); }, setStatusText() {},
    })({ auto: true });
    assert.deepEqual(calls.map(c => c.url).sort(), ['/api/seoul-bike', '/api/seoul-bus', '/api/subway']);
    assert.ok(calls.every(c => c.body.center.lat === site.lat));
    assert.equal(state.publicTransportResult.transportRegion, 'seoul');
  } finally { globalThis.fetch = original; }
});
test('TIA uses an explicit binding first, otherwise the existing survey database', () => {
  assert.equal(tiaDatabaseUrl({ TIA_DATABASE_URL: 'tia', DATABASE_URL: 'general', TRAFFIC_DATABASE_URL: 'traffic' }), 'tia');
  assert.equal(tiaDatabaseUrl({ TRAFFIC_DATABASE_URL: 'traffic' }), 'traffic');
  assert.equal(tiaDatabaseUrl({ SEOUL_BUS_DATABASE_URL: 'bus' }), 'bus');
  assert.equal(tiaDatabaseUrl({}), '');
});
test('TIA live pagination requests one actual project per page and resumes beyond the first chunk', async () => {
  const names = ['DATA_GO_KR_SERVICE_KEY', 'TIA_SYSTEM_API_BASE_URL', 'TIA_SYSTEM_API_OPERATION_PATH', 'TIA_PROJECT_API_BASE_URL', 'TIA_API_BASE_URL'];
  const before = names.map(name => process.env[name]); const original = globalThis.fetch;
  process.env.DATA_GO_KR_SERVICE_KEY = 'fixture'; process.env.TIA_SYSTEM_API_BASE_URL = 'https://example.invalid/'; process.env.TIA_SYSTEM_API_OPERATION_PATH = 'businessSearch';
  delete process.env.TIA_PROJECT_API_BASE_URL; delete process.env.TIA_API_BASE_URL;
  const calls = [];
  globalThis.fetch = async url => {
    assert.equal(url.searchParams.get('numOfRows'), '1'); const page = Number(url.searchParams.get('pageNo')); calls.push(page);
    return Response.json({ totalCount: 53, items: [{ bsnsNo: String(page), bsnsNm: `사업 ${page}`, bsnsLc: '서울특별시 서초구', reqstDd: '20260101' }] });
  };
  try {
    const first = await fetchTiaProjects({}); const cursor = first.sourceDiagnostics[0].pageInfo;
    assert.equal(cursor.nextPage, 49); assert.equal(cursor.complete, false);
    assert.equal(first.projects.length, 48); assert.deepEqual(first.errors, []);
    const last = await fetchTiaProjects({}, { systemPage: cursor.nextPage });
    assert.equal(last.projects.length, 5); assert.equal(last.sourceDiagnostics[0].pageInfo.complete, true);
    assert.equal(last.sourceDiagnostics[0].pageInfo.signature, cursor.signature);
    assert.equal(new Set([...first.projects, ...last.projects].map(p => p.id)).size, 53);
    assert.ok(calls.includes(53));
    globalThis.fetch = async () => Response.json({ totalCount: 4, items: [{ bsnsNo: 'same', bsnsNm: '반복' }] });
    const broken = await fetchTiaProjects({});
    assert.equal(broken.sourceDiagnostics[0].pageInfo.complete, false); assert.ok(broken.errors.length);
  } finally { globalThis.fetch = original; names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; }); }
});
test('development client continues source pages, accumulates unique projects and rejects duplicate source rows', async () => {
  const original = globalThis.fetch;
  for (const duplicate of [false, true]) {
    let state = {}; const pages = [];
    globalThis.fetch = async (_, options) => {
      const body = JSON.parse(options.body); pages.push(body.sourcePage);
      const page = body.sourcePage;
      return Response.json({ success: true, results: [{ id: String(page), projectName: 'project', location: '서울 서초구', withinScope: true }],
        pagination: { nextOffset: null }, sourcePagination: { signature: 'stable', nextPage: page === 1 ? 2 : null,
          complete: page === 2, totalCount: 2, processedPage: page, projectKeys: [duplicate ? 'repeat' : String(page)] }, debug: { apiErrors: [] } });
    };
    await createDevelopmentSearch({ createBlankDevelopmentResult: v => v, createBlankDevelopmentSearch: () => ({}), formatNumber: String,
      getDevelopmentPayload: () => ({ siteAddress: '서울 서초구' }), requestGateRef: { current: createRequestGate() }, summarizeProjects,
      setForm: update => { state = update(state); }, setStatusText() {},
    })();
    assert.deepEqual(pages, [1, 2]);
    assert.equal(state.developmentResult.complete, !duplicate);
    if (!duplicate) assert.equal(state.developmentResult.results.length, 2);
    else assert.match(state.developmentResult.error, /반복 페이지/);
  }
  globalThis.fetch = original;
});
test('TIA counts facility records separately but rejects a repeated record with only a different row number', async () => {
  const apartment = { bsnsNo: '', dlbrtNo: '', bsnsNm: '복합개발사업', bsnsLc: '충남 당진시', rno: '1', tyDetail: '아파트', tyStep3: '공동주택', tyStep4: '아파트' };
  const shop = { ...apartment, rno: '2', tyDetail: '기타', tyStep3: '제1종 근린생활시설', tyStep4: '기타' };
  assert.notEqual(rawProjectKey(apartment), rawProjectKey(shop));
  assert.equal(rawProjectKey(apartment), rawProjectKey(Object.fromEntries(Object.entries({ ...apartment, rno: '99' }).reverse())));
  const names = ['DATA_GO_KR_SERVICE_KEY', 'TIA_SYSTEM_API_BASE_URL', 'TIA_SYSTEM_API_OPERATION_PATH', 'TIA_PROJECT_API_BASE_URL', 'TIA_API_BASE_URL'];
  const before = names.map(name => process.env[name]), original = globalThis.fetch;
  process.env.DATA_GO_KR_SERVICE_KEY = 'fixture'; process.env.TIA_SYSTEM_API_BASE_URL = 'https://example.invalid/'; process.env.TIA_SYSTEM_API_OPERATION_PATH = 'businessSearch';
  delete process.env.TIA_PROJECT_API_BASE_URL; delete process.env.TIA_API_BASE_URL;
  try {
    for (const duplicate of [false, true]) {
      globalThis.fetch = async url => {
        const page = Number(url.searchParams.get('pageNo'));
        return Response.json({ totalCount: 2, items: [page === 1 ? apartment : duplicate ? { ...apartment, rno: '2' } : shop] });
      };
      const live = await fetchTiaProjects({}), source = live.sourceDiagnostics[0];
      assert.equal(source.pageInfo.complete, !duplicate);
      assert.equal(source.rawCount, duplicate ? 1 : 2);
      assert.equal(live.projects.length, 1, 'facility records still belong to a single candidate project');
      if (!duplicate) assert.equal(new Set(source.pageInfo.projectKeys).size, 2);
      const stored = await collectTiaBusinessPeriod({ startDate: '2021-01-01', endDate: '2021-12-31' });
      assert.equal(stored.complete, !duplicate);
      assert.equal(stored.projects.length, duplicate ? 1 : 2);
    }
  } finally { globalThis.fetch = original; names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; }); }
});
test('expired GG snapshot returns before slow refresh and schedules only one background job', async () => {
  const snapshot = { months: [{ month: '2024-12' }] }, jobs = []; let loads = 0;
  const reader = createBackgroundSnapshotReader({ read: async () => ({ snapshot }), refresh: async () => { loads++; return { snapshot }; } });
  const first = await reader({ defer: job => jobs.push(job) });
  assert.equal(loads, 0); assert.equal(first.snapshot, snapshot); assert.equal(first.stale, true); assert.equal(first.refreshing, true);
  await reader({ defer: job => jobs.push(job) }); assert.equal(jobs.length, 1);
  await jobs[0](); assert.equal(loads, 1);
});
test('GG cooldown, fresh snapshots and cold start have distinct states', async () => {
  let saved = { snapshot: { months: [] }, fresh: true };
  const jobs = [], reader = createBackgroundSnapshotReader({ read: async () => saved, refresh: async () => {}, now: () => 100 });
  assert.equal((await reader({ defer: job => jobs.push(job) })).stale, false); assert.equal(jobs.length, 0);
  saved = { snapshot: { months: [] }, retryAt: 200, lastError: '원본 연결 실패' };
  const stale = await reader({ defer: job => jobs.push(job) }); assert.equal(stale.refreshing, false); assert.match(stale.warning, /원본 연결 실패/); assert.equal(jobs.length, 0);
  saved = null; const first = await reader({ defer: job => jobs.push(job) }); assert.equal(first.snapshot, null); assert.equal(first.refreshing, true); assert.equal(jobs.length, 1);
});
test('bus gaps count displayed origin times and unique routes, not missing terminal times', () => {
  const route = { busRouteId: '1', routeName: '400', routeType: '간선', startStation: 'A', endStation: 'B', originFirstBusTime: '04:15', originLastBusTime: '22:25', interval: '10분', dayIntervalSource: 'SEOUL_TDATA', saturdayInterval: '15분', holidayInterval: '20분', endpointTimeError: '기점·종점 운행시간 일부 미제공' };
  const stops = [{ routes: [route] }, { routes: [route] }];
  assert.equal(busGapSummary(stops).failedStationTimes, 0); assert.equal(busGapSummary(stops).partial, false);
  route.originLastBusTime = ''; assert.equal(busGapSummary(stops).failedStationTimes, 1);
  route.holidayInterval = ''; assert.equal(busGapSummary(stops).missingIntervals, 1);
});
const station = { subwayStationId: 'MTRDXD1D008', seoulStationCode: '4308' };
const tagoRow = { subwayStationId: station.subwayStationId, dailyTypeCode: '02', upDownTypeCode: 'U', endSubwayStationNm: '신사', depTime: '054400' };
test('fresh TAGO fallback clears Seoul failure but does not invent Saturday data', async () => {
  const cache = (_key, loader) => loader();
  for (const seoul of [async () => { throw Error('Seoul unavailable'); }, async () => ({ rows: [], cacheInfo: { stale: true } })]) {
    const data = await getSubwaySchedule(station, ['02:U'], { cache, seoul, tago: async () => [tagoRow] });
    assert.equal(data.status, 'SUCCESS'); assert.equal(data.error, ''); assert.equal(data.schedules[0].day, '토요일');
  }
  const absent = await getSubwaySchedule(station, ['02:U'], { cache, seoul: async () => ({ rows: [] }), tago: async () => [] });
  assert.equal(absent.slots[0].status, 'NO_DATA'); assert.equal(absent.schedules.length, 0);
});
test('stale outer subway cache remains partial, not a fresh success', async () => {
  const result = await getSubwaySchedule(station, ['01:U'], { cache: async () => ({ status: 'SUCCESS', schedules: [{ firstTime: '05:00' }], cacheInfo: { stale: true } }) });
  assert.equal(result.status, 'PARTIAL'); assert.equal(subwaySlotStatus(result.slots[0]), '이전 자료');
});
test('missing Saturday appears in the table even when weekday times exist', () => {
  const rows = createSubwayRows([{ stationName: '양재', schedules: [{ day: '평일', direction: '상행(U)', firstTime: '05:00', lastTime: '23:00' }], scheduleSlots: [{ key: '02:U', status: 'NO_DATA', schedules: [] }] }]);
  assert.equal(rows.length, 3); assert.equal(rows[2][4], '토요일'); assert.equal(rows[2][8], '수동확인필요');
});
