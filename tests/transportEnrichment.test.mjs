import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementGyeonggiStations, validateStationIds } from '../lib/gyeonggiBus.js';
import { resolveSubwayIdentity, getSubwaySchedule, validateSubwaySlots } from '../lib/subway.js';
import { loadGyeonggiStationRoutes, loadSubwayDetails, mergeSubwaySlots, pendingSubwaySlots, transportScopeKey, needsRetryBusDetail } from '../lib/client/transportEnrichment.js';
import { applyBusDetailUpdates, loadBusDetails, markPendingBusDetails } from '../lib/busDetailLoader.js';
import { createTransportSearch } from '../lib/client/createTransportSearch.js';
import { createRequestGate } from '../lib/researchIntegrity.js';
import { investigationStates } from '../lib/surveyStatus.js';

const request = () => createRequestGate().start('transport');
const stops = n => Array.from({ length: n }, (_, i) => ({ id: String(200000001 + i), stationId: String(200000001 + i), routes: [] }));
const busUpdate = stationId => ({ stationId, routes: [{ busRouteId: '210000001', routeName: '100' }], routeLookupStatus: 'SUCCESS', routeError: '' });
const cache = (_key, loader) => loader();
const station = { id: '123', stationName: '수원역 1호선', line: '1호선', subwayStationId: 'MTRKRK123', schedules: [], status: 'PENDING' };
const slot = key => ({ key, status: 'SUCCESS', error: '', schedules: [{ day: { '01': '평일', '02': '토요일', '03': '일요일·공휴일' }[key.slice(0, 2)],
  direction: key.endsWith('U') ? '상행(U)' : '하행(D)', firstTime: '05:10', lastTime: '23:40', destination: '종점', count: 5 }] });

test('GBIS supplements more than eight stops in bounded batches and only missing stops', async () => {
  const calls = [], progress = [];
  const input = [...stops(11), { stationId: '200000099', routes: [{ busRouteId: '210000002', routeName: 'keep' }] }];
  const result = await loadGyeonggiStationRoutes({ stations: input, scope: {}, request: request(), onProgress: p => progress.push(p),
    fetchImpl: async (_url, opts) => { const ids = JSON.parse(opts.body).stationIds; calls.push(ids); return Response.json({ success: true, updates: ids.map(busUpdate) }); } });
  assert.equal(calls.length, 6);
  assert.equal(calls.flat().length, 11);
  assert.ok(calls.every(ids => ids.length <= 2));
  assert.equal(result.at(-1), input.at(-1));
  assert.equal(progress.at(-1).completed, 11);
  assert.equal(progress.at(-1).loading, false);
});

test('bus resume preserves successful batches, retries remaining stops and ignores stale responses', async () => {
  let calls = 0, final;
  const result = await loadGyeonggiStationRoutes({ stations: stops(5), scope: {}, request: request(), onProgress: p => { final = p; },
    fetchImpl: async (_url, opts) => { if (++calls === 2) throw new Error('key=secret'); return Response.json({ success: true, updates: JSON.parse(opts.body).stationIds.map(busUpdate) }); } });
  assert.equal(result[0].routes.length, 1);
  assert.equal(result[2].routes.length, 0);
  assert.doesNotMatch(final.error, /secret/);
  const retryIds = [];
  await loadGyeonggiStationRoutes({ stations: result, scope: {}, request: request(), onProgress() {},
    fetchImpl: async (_url, opts) => { const ids = JSON.parse(opts.body).stationIds; retryIds.push(...ids); return Response.json({ success: true, updates: ids.map(busUpdate) }); } });
  assert.deepEqual(retryIds, ['200000003', '200000004', '200000005']);
  const gate = createRequestGate(), progress = [];
  await loadGyeonggiStationRoutes({ stations: stops(2), scope: {}, request: gate.start('transport'), onProgress: p => progress.push(p),
    fetchImpl: async () => { gate.cancel(); return Response.json({ success: true, updates: stops(2).map(s => busUpdate(s.stationId)) }); } });
  assert.equal(progress.length, 1);
});

test('GBIS server rejects out of scope, duplicate and oversized station batches before upstream calls', async () => {
  for (const ids of [[], ['999999999'], ['200000001', '200000001'], stops(3).map(s => s.stationId)]) {
    assert.throws(() => validateStationIds(stops(3), ids));
  }
  let calls = 0;
  await assert.rejects(() => supplementGyeonggiStations(stops(2), ['999999999'], { cache, request: async () => { calls++; } }));
  assert.equal(calls, 0);
  const good = await supplementGyeonggiStations(stops(2), ['200000001', '200000002'], { cache,
    request: async () => ({ busRouteList: [{ routeId: '210000001', routeName: '100' }, { routeId: '210000001', routeName: '100' }] }) });
  assert.equal(good.updates[0].routes.length, 1);
  const bad = await supplementGyeonggiStations(stops(2), ['200000001', '200000002'], { cache, request: async () => { calls++; throw new Error('secret'); } });
  assert.equal(calls, 1);
  assert.equal(bad.stopped, true);
  assert.equal(bad.updates[0].routeLookupStatus, 'FAILED');
  assert.doesNotMatch(JSON.stringify(bad), /secret/);
  const empty = await supplementGyeonggiStations(stops(1), ['200000001'], { cache, request: async () => ({}) });
  assert.equal(empty.updates[0].routeLookupStatus, 'NO_DATA');
});

test('malformed station response never erases existing bus rows or marks completion', async () => {
  let final;
  const data = stops(2);
  const result = await loadGyeonggiStationRoutes({ stations: data, scope: {}, request: request(), onProgress: p => { final = p; },
    fetchImpl: async () => Response.json({ success: true, updates: [busUpdate('999999999')] }) });
  assert.deepEqual(result, data);
  assert.equal(final.completed, 0);
  assert.ok(final.error);
});

test('failed detail retry preserves previously verified stop times and does not substitute origin times', () => {
  const data = [{ stationId: '200000001', routes: [{ busRouteId: '210000001', stationFirstBusTime: '05:10', stationLastBusTime: '23:10' }] }];
  const result = applyBusDetailUpdates(data, [{ busRouteId: '210000001', detail: { originFirstBusTime: '04:00' }, stationTimes: [], stationTimeError: '연결 실패' }]);
  assert.equal(result[0].routes[0].stationFirstBusTime, '05:10');
  assert.equal(result[0].routes[0].stationLastBusTime, '23:10');
  assert.equal(result[0].routes[0].detailStatus, 'PARTIAL');
  assert.equal(needsRetryBusDetail({ detailStatus: 'SUCCESS' }, 'seoul'), false);
});

test('subway identity distinguishes ambiguous, absent and failed official matches', async () => {
  const base = { ...station, subwayStationId: '' };
  const row = { subwayStationName: '수원', subwayRouteName: '1호선', subwayStationId: station.subwayStationId };
  assert.equal((await resolveSubwayIdentity(base, { lookup: async () => [row], seoulLookup: async () => '' })).codeStatus, 'SUCCESS');
  assert.equal((await resolveSubwayIdentity(base, { lookup: async () => [row, row], seoulLookup: async () => '' })).codeStatus, 'AMBIGUOUS');
  assert.equal((await resolveSubwayIdentity(base, { lookup: async () => [], seoulLookup: async () => '' })).codeStatus, 'NOT_FOUND');
  const failed = await resolveSubwayIdentity(base, { lookup: async () => { throw new Error('secret'); }, seoulLookup: async () => '' });
  assert.equal(failed.codeStatus, 'LOOKUP_FAILED');
  assert.doesNotMatch(failed.error, /secret/);
});

test('subway server queries only selected service slots and validates batch limits', async () => {
  for (const input of [[], ['01:U', '01:U'], ['04:D'], ['01:U', '02:U', '03:U']]) assert.throws(() => validateSubwaySlots(input));
  const calls = [];
  const result = await getSubwaySchedule(station, ['02:U', '03:D'], { cache,
    tago: async (_op, p) => { calls.push([p.dailyTypeCode, p.upDownTypeCode]); return [{ ...p, depTime: '051000', endSubwayStationNm: '종점' }]; } });
  assert.deepEqual(calls, [['02', 'U'], ['03', 'D']]);
  assert.equal(result.slots.length, 2);
  assert.equal(result.status, 'SUCCESS');
});

test('subway retries only incomplete slots and keeps good rows on failed refresh', async () => {
  const good = ['01:U', '01:D', '02:U', '02:D'].map(slot);
  const original = { ...station, scheduleSlots: good, schedules: good.flatMap(s => s.schedules), status: 'PARTIAL' };
  const calls = []; let final;
  await loadSubwayDetails({ stations: [original], scope: {}, request: request(), onProgress: p => { final = p; },
    fetchImpl: async (_url, opts) => { const body = JSON.parse(opts.body); calls.push(body.slots); return Response.json({ success: true, stationId: station.subwayStationId, slots: body.slots.map(slot) }); } });
  assert.deepEqual(calls, [['03:U', '03:D']]);
  assert.equal(final.stations[0].status, 'SUCCESS');
  assert.equal(final.stations[0].schedules.length, 6);
  const retained = mergeSubwaySlots(final.stations[0], [{ key: '01:U', status: 'FAILED', schedules: [], error: '연결 실패' }]);
  assert.equal(retained.schedules.length, 6);
  assert.deepEqual(pendingSubwaySlots(retained), ['01:U']);
  assert.match(retained.error, /이전 결과 유지/);
});

test('subway resolves deferred codes, avoids ambiguous codes and blocks wrong-slot responses', async () => {
  let final; const calls = [];
  await loadSubwayDetails({ stations: [{ ...station, subwayStationId: '', codeStatus: 'NOT_QUERIED' }], scope: {}, request: request(), onProgress: p => { final = p; },
    fetchImpl: async (url, opts) => { calls.push(url); if (url.endsWith('resolve')) return Response.json({ success: true, station: { ...station, codeStatus: 'SUCCESS' } });
      const body = JSON.parse(opts.body); return Response.json({ success: true, stationId: station.subwayStationId, slots: body.slots.map(slot) }); } });
  assert.equal(calls[0], '/api/subway/resolve');
  assert.equal(final.stations[0].status, 'SUCCESS');
  await loadSubwayDetails({ stations: [{ ...station, subwayStationId: '', codeStatus: 'AMBIGUOUS' }], scope: {}, request: request(), onProgress() {}, fetchImpl: () => assert.fail('ambiguous station must remain manual') });
  await loadSubwayDetails({ stations: [station], scope: {}, request: request(), onProgress: p => { final = p; }, fetchImpl: async () => Response.json({ success: true, stationId: station.subwayStationId, slots: [slot('03:U'), slot('03:D')] }) });
  assert.equal(final.stations[0].schedules.length, 0);
  assert.notEqual(final.stations[0].status, 'SUCCESS');
});

test('subway cancellation discards in-flight schedules', async () => {
  const gate = createRequestGate(), progress = [];
  await loadSubwayDetails({ stations: [station], scope: {}, request: gate.start('transport'), onProgress: p => progress.push(p),
    fetchImpl: async () => { gate.cancel(); return Response.json({ success: true, stationId: station.subwayStationId, slots: [slot('01:U'), slot('01:D')] }); } });
  assert.equal(progress.length, 1);
});

test('controller retry preserves bike and successful transport results without base API calls', async () => {
  const center = { lat: 37.5, lng: 127 }, bounds = { south: 37.49, north: 37.51, west: 126.99, east: 127.01 };
  let state = { basics: { siteAddress: '서울특별시 서초구' }, publicTransportResult: { searched: true, scope: { center, bounds, width: 800, height: 800 },
    scopeKey: transportScopeKey('서울특별시 서초구', 800, 800), busStops: [{ stationId: '200000001', routes: [{ busRouteId: '210000001', detailStatus: 'SUCCESS' }] }],
    busSummary: { returnedCount: 1 }, bikeStations: [{ id: 'keep-bike' }], subwaySource: 'official', subwayStations: [{ ...station, status: 'SUCCESS' }], transportRegion: 'seoul' } };
  const deps = { computeRectangleBounds: () => bounds, createBlankPublicTransportResult: v => v, detectSurveyRegion: () => 'seoul', form: state,
    formatNumber: String, getScopeDimensions: () => ({ width: 800, height: 800 }), loadBusDetails, markPendingBusDetails, requestGateRef: { current: createRequestGate() },
    resolveScopeCenter: () => assert.fail('retry must use saved scope'), safe: v => v || '', setForm: cb => { state = cb(state); }, setStatusText() {}, toNumber: Number };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('successful data must not refetch');
  try { await createTransportSearch(deps)({ retryMissing: true }); }
  finally { globalThis.fetch = oldFetch; }
  assert.equal(state.publicTransportResult.bikeStations[0].id, 'keep-bike');
  assert.equal(state.publicTransportResult.busStops[0].routes[0].detailStatus, 'SUCCESS');
  assert.equal(state.publicTransportResult.loading, false);
  let message;
  deps.form = { ...state, basics: { siteAddress: '서울특별시 노원구' } };
  deps.setStatusText = v => { message = v; };
  await createTransportSearch(deps)({ retryMissing: true });
  assert.match(message, /조사 조건이 달라/);
});

test('station-route progress and missing routes cannot appear completed in step navigation', () => {
  const base = { mapPhase: 'complete', development: {}, accident: 'idle', pointCount: 0 };
  assert.equal(investigationStates({ ...base, transport: { searched: true, busRouteLoading: true } })[5], 'loading');
  assert.equal(investigationStates({ ...base, transport: { searched: true, busSummary: { partial: true } } })[5], 'partial');
});
