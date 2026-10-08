import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusStopTableRows, createBusRouteTableRows } from '../lib/seoulBusTable.js';
import { createSubwayRows } from '../lib/subwayTable.js';
import { MANUAL_CHECK, transportTime, transportMissingNote } from '../lib/transportTableDisplay.js';

test('bus stop export keeps one stop per row, combined identifier, no coordinates and missing reasons outside cells', () => {
  const stops = [
    { stationName: '서초구청', arsId: '22863', distanceMeters: 42, routes: [], routeError: '공식 파일에 연결된 노선 없음 · 수동 확인 필요', location: '37.4, 127.1' },
    { stationName: '서울역', arsId: '00123', distanceMeters: 0, routes: [{ routeName: '1' }] },
    { stationName: '번호누락', distanceMeters: null },
  ];
  const rows = createBusStopTableRows(stops, stop => `${stop.distanceMeters}m`);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.length === 3));
  assert.deepEqual(rows[1], ['서초구청(22863)', '42m', MANUAL_CHECK]);
  assert.deepEqual(rows[2], ['서울역(00123)', '0m', 1]);
  assert.deepEqual(rows[3], [`번호누락(${MANUAL_CHECK})`, MANUAL_CHECK, MANUAL_CHECK]);
  assert.ok(!JSON.stringify(rows).includes('37.4'));
  assert.match(transportMissingNote(rows, stops.map(stop => stop.routeError)), /공식 파일에 연결된 노선 없음/);
});

test('bus display drops calendar dates without shifting provider clock or extended service hours', () => {
  assert.equal(transportTime('2026-10-02 04:30:00'), '04:30');
  assert.equal(transportTime('2026-10-02T23:10:00+09:00'), '23:10');
  assert.equal(transportTime('25:10'), '25:10');
  assert.equal(transportTime('4:05'), '04:05');
  for (const value of ['미제공 · 수동 확인 필요', '', null, '29:99', '2026-10-02']) assert.equal(transportTime(value), MANUAL_CHECK);
  const route = { originFirstBusTime: '2026-10-02 04:30:00', originLastBusTime: '2026-10-02 23:10:00', terminalFirstBusTime: '05:30', terminalLastBusTime: '25:10', routeType: '수동 확인 필요', endpointTimeBasis: '서울 노선 기점 · 일치 종점 정류소 운행시간(요일 구분 미제공)' };
  const rows = createBusRouteTableRows([{ stationName: '시청', routes: [route] }]);
  assert.deepEqual(rows[1].slice(4, 6), ['04:30', '23:10']);
  assert.deepEqual(rows[1].slice(7, 9), ['05:30', '25:10']);
  assert.equal(rows[1][1], MANUAL_CHECK);
  assert.equal(rows[1][9], route.endpointTimeBasis);
  assert.equal(route.originFirstBusTime, '2026-10-02 04:30:00');
});

test('subway missing cells are compact while valid overnight times and pending status remain intact', () => {
  const rows = createSubwayRows([
    { stationName: '시청', distanceMeters: null, schedules: [{ day: '평일', direction: '상행', trainType: '미제공', firstTime: '05:30', lastTime: '익일 01:15' }] },
    { stationName: '빈역', status: 'PARTIAL', schedules: [] },
    { stationName: '조회역', status: 'PENDING', schedules: [] },
  ]);
  assert.equal(rows[1][3], MANUAL_CHECK);
  assert.equal(rows[1][7], MANUAL_CHECK);
  assert.equal(rows[1][9], '익일 01:15');
  assert.ok(rows[2].slice(4).every(cell => cell === MANUAL_CHECK));
  assert.ok(rows[3].slice(4).every(cell => cell === '조회 중'));
  assert.match(transportMissingNote(rows, ['역 코드 조회 실패']), /공식 자료 미제공.*역 코드 조회 실패/);
});
