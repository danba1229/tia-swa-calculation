import test from 'node:test';
import assert from 'node:assert/strict';
import { BUS_ROUTE_COLUMNS, createBusRouteTableRows } from '../lib/seoulBusTable.js';

test('bus route summary uses nine columns and deduplicates stops without losing partial details', () => {
  const base = { busRouteId: '100000001', routeName: '10', routeType: '간선', startStation: '기점', endStation: '종점' };
  const stations = [
    { stationName: '첫 정류장', routes: [{ ...base, originFirstBusTime: '2026-10-13 04:30:00', interval: '8~12분' }] },
    { stationName: '둘째 정류장', routes: [{ ...base, originFirstBusTime: '수동확인필요', originLastBusTime: '25:10',
      dayIntervalSource: 'SEOUL_TDATA', saturdayInterval: '15분', holidayInterval: '20분', terminalFirstBusTime: '06:00' }] },
    { stationName: '노선 미조회', routeError: '연결된 노선 없음' },
  ];
  const original = structuredClone(stations);
  assert.deepEqual(BUS_ROUTE_COLUMNS, ['버스 종류', '버스번호', '노선 기점', '노선 종점', '첫차', '막차',
    '배차간격(일반)', '배차간격(토요일)', '배차간격(공휴일)']);
  const rows = createBusRouteTableRows(stations);
  assert.deepEqual(rows, [BUS_ROUTE_COLUMNS, ['간선', '10', '기점', '종점', '04:30', '25:10', '8~12분', '15분', '20분']]);
  assert.deepEqual(stations, original);
});

test('bus numbers sort naturally, including suffixes and Korean names, while distinct route IDs survive', () => {
  const names = ['100', '10-2', '2', '10', '10-1', '서초10', '서초02', 'N37', 'N13'];
  const routes = names.map((routeName, i) => ({ busRouteId: String(i + 1), routeName }));
  const rows = createBusRouteTableRows([{ routes }, { routes: [...routes, { busRouteId: 'other', routeName: '10', startStation: '다른 기점' }] }]);
  const sorted = rows.slice(1).map(row => row[1]);
  assert.deepEqual(sorted.filter(name => /^\d/.test(name)), ['2', '10', '10', '10-1', '10-2', '100']);
  assert.deepEqual(sorted.filter(name => name.startsWith('서초')), ['서초02', '서초10']);
  assert.deepEqual(sorted.filter(name => name.startsWith('N')), ['N13', 'N37']);
  assert.equal(rows.length, 11);
});

test('legacy routes deduplicate by number/type/endpoints and absent routes create no fictional rows', () => {
  const route = { routeType: '마을', routeName: '서초02', startStation: 'A', endStation: 'B' };
  const rows = createBusRouteTableRows([{ routes: [route] }, { routes: [{ ...route }] }, { routes: [{ ...route, endStation: 'C' }] }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(createBusRouteTableRows([{ routes: [] }, { routeError: '조회 실패' }]), [BUS_ROUTE_COLUMNS]);
});
