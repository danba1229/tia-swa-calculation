import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalTimes } from '../lib/seoulBusDetails.js';
import { mapGbisRoute } from '../lib/gyeonggiBus.js';
import { applyBusDetailUpdates } from '../lib/busDetailLoader.js';
import { createBusRouteTableRows } from '../lib/seoulBusTable.js';
import { matchTdataRoute } from '../lib/seoulTdata.js';
import { needsGyeonggiRouteDetail, busGapSummary } from '../lib/client/transportEnrichment.js';

test('Seoul terminal requires a unique exact endpoint match, not the last route row', () => {
  const row = { stationName: '종점', stationFirstBusTime: '05:40', stationLastBusTime: '24:30' };
  assert.deepEqual(terminalTimes({ endStation: '종점' }, [row, { ...row, stationName: '기점' }]),
    { terminalFirstBusTime: '05:40', terminalLastBusTime: '24:30' });
  assert.deepEqual(terminalTimes({ endStation: '종점' }, [row, row]), {});
  assert.deepEqual(terminalTimes({ endStation: '다른종점' }, [row]), {});
});

test('GBIS origin times and general/Saturday/holiday intervals reach screen/export without stop fallback', () => {
  const route = mapGbisRoute({ routeId: '200000001', routeName: '1', startStationName: 'A', endStationName: 'B',
    upFirstTime: '05:00', upLastTime: '23:00', downFirstTime: '06:00', downLastTime: '24:00',
    peekAlloc: 10, nPeekAlloc: 15, satPeekAlloc: 20, satNPeekAlloc: 25, sunPeekAlloc: 30, sunNPeekAlloc: 35, wePeekAlloc: 40, weNPeekAlloc: 45 });
  const stations = applyBusDetailUpdates([{ routes: [{ busRouteId: route.busRouteId }] }],
    [{ busRouteId: route.busRouteId, detail: route, stationTimes: [], stationTimeError: '미제공' }]);
  assert.equal(stations[0].routes[0].detailStatus, 'SUCCESS');
  assert.equal(busGapSummary(stations).partial, false);
  assert.equal(needsGyeonggiRouteDetail(stations[0].routes[0]), false);
  const rows = createBusRouteTableRows(stations);
  assert.deepEqual(rows[1].slice(2, 6), ['A', 'B', '05:00', '23:00']);
  assert.equal(stations[0].routes[0].terminalLastBusTime, '24:00');
  assert.equal(stations[0].routes[0].sundayInterval, '30~35분');
  assert.deepEqual(rows[1].slice(6), ['10~15분', '20~25분', '40~45분']);
  assert.ok(rows.every(row => row.length === 9));
});

test('Seoul general interval must not be relabeled weekday or Sunday', () => {
  const route = matchTdataRoute([{ routeId: '100000001', useAt: '1', opratAt: '1', mummCaralc: '8', mxmmCaralc: '12', caralcS: '15', caralcH: '20' }], '100000001');
  const row = createBusRouteTableRows([{ routes: [route] }])[1];
  assert.deepEqual(row.slice(6), ['8~12분', '15분', '20분']);
  assert.equal(route.weekdayInterval, undefined);
  assert.equal(route.sundayInterval, undefined);
});

test('endpoint provenance survives wording that describes unavailable day distinctions', () => {
  const basis = '서울 노선 기점 · 일치 종점 정류소 운행시간(요일 구분 미제공)';
  const stations = applyBusDetailUpdates([{ routes: [{ busRouteId: '100100596' }] }],
    [{ busRouteId: '100100596', detail: { endpointTimeBasis: basis }, stationTimes: [] }]);
  assert.equal(stations[0].routes[0].endpointTimeBasis, basis);
});
