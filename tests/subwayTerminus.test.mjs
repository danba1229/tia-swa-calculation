import test from 'node:test';
import assert from 'node:assert/strict';
import { findSeoulStationCode } from '../lib/seoulSubway.js';
import { getSubwaySchedule, summarizeSubwayTimes } from '../lib/subway.js';
import { mergeSubwaySlots, pendingSubwaySlots } from '../lib/client/transportEnrichment.js';
import { createSubwayRows, subwaySlotStatus } from '../lib/subwayTable.js';

// Real Seoul Metro name-search results (2026-10-25): "서울" returns only GTX-A.
const byQuery = {
  서울: [{ STATION_NM: '서울', LINE_NUM: 'GTX-A', STATION_CD: '9005' }],
  서울역: [{ STATION_NM: '서울역', LINE_NUM: '01호선', STATION_CD: '0150' }, { STATION_NM: '서울역', LINE_NUM: '04호선', STATION_CD: '0426' }, { STATION_NM: '서울역', LINE_NUM: '경의선', STATION_CD: '1251' }],
  시청: [{ STATION_NM: '시청', LINE_NUM: '01호선', STATION_CD: '0151' }],
};

test('서울역 lines are found under the name registered with 역', async () => {
  const old = process.env.SEOUL_SUBWAY_API_KEY; process.env.SEOUL_SUBWAY_API_KEY = 'fixture';
  const queries = [];
  const read = async q => { queries.push(q); return byQuery[q] || []; };
  try {
    assert.equal(await findSeoulStationCode('서울역', '1호선', { read }), '0150');
    assert.equal(await findSeoulStationCode('서울역', '4호선', { read }), '0426');
    assert.equal(await findSeoulStationCode('서울역', 'GTX-A', { read }), '9005');
    queries.length = 0;
    assert.equal(await findSeoulStationCode('시청역', '1호선', { read }), '0151');
    assert.deepEqual(queries, ['시청'], 'no second lookup when the first name matches');
    assert.equal(await findSeoulStationCode('없는역', '1호선', { read }), '');
  } finally { if (old == null) delete process.env.SEOUL_SUBWAY_API_KEY; else process.env.SEOUL_SUBWAY_API_KEY = old; }
});

// TAGO rows for 서울역 GTX-A 상행: every train terminates here (depTime 0, arrival only).
const id = 'MTRGXAX106';
const arrival = arrTime => ({ subwayStationId: id, endSubwayStationId: id, endSubwayStationNm: '서울역', depTime: '0', arrTime, dailyTypeCode: '01', upDownTypeCode: 'U' });
const departure = depTime => ({ subwayStationId: id, endSubwayStationId: 'MTRGXAX101', endSubwayStationNm: '운정중앙', depTime, arrTime: '0', dailyTypeCode: '01', upDownTypeCode: 'D' });
const passthrough = (_key, loader) => loader();

test('a direction where every train terminates is reported as a terminus, not missing data', async () => {
  assert.equal(summarizeSubwayTimes([arrival('055200'), arrival('060200')], id, '01', 'U').arrivalsOnly, 2);
  const tago = async (_op, p) => p.upDownTypeCode === 'U' ? [arrival('055200'), arrival('060200'), arrival('000700')] : [departure('053000'), departure('054500')];
  const { slots } = await getSubwaySchedule({ subwayStationId: id, seoulStationCode: '' }, ['01:U', '01:D'], { cache: passthrough, tago, operator: async () => null });
  const up = slots.find(s => s.key === '01:U'), down = slots.find(s => s.key === '01:D');
  assert.equal(up.status, 'TERMINUS');
  assert.match(up.error, /종착역 · 이 방향 출발 열차 없음\(도착 3회\)/);
  assert.equal(down.status, 'SUCCESS');
});

test('mixed or broken rows are still flagged rather than called a terminus', async () => {
  const broken = { ...arrival('055200'), endSubwayStationId: 'MTRGXAX101' };
  const tago = async () => [arrival('055200'), broken];
  const { slots } = await getSubwaySchedule({ subwayStationId: id, seoulStationCode: '' }, ['01:U'], { cache: passthrough, tago, operator: async () => null });
  assert.equal(slots[0].status, 'NO_DATA');
  assert.match(slots[0].error, /불일치·시간 미제공 2건 제외/);
});

test('the client treats a terminus slot as settled and labels it in the table', () => {
  const terminus = { key: '01:U', schedules: [], status: 'TERMINUS', error: '평일 상행: 종착역 · 이 방향 출발 열차 없음(도착 3회)', checkedAt: new Date().toISOString() };
  const ok = key => ({ key, status: 'SUCCESS', checkedAt: terminus.checkedAt, schedules: [{ day: { '01': '평일', '02': '토요일', '03': '일요일·공휴일' }[key.slice(0, 2)], direction: key.endsWith('U') ? '상행(U)' : '하행(D)', destination: '운정중앙', firstTime: '05:30', lastTime: '23:00' }] });
  const station = mergeSubwaySlots({ id: 's', stationName: '서울역 GTX-A', line: 'GTX-A', schedules: [] }, [terminus, ...['01:D', '02:U', '02:D', '03:U', '03:D'].map(ok)]);
  assert.equal(station.status, 'SUCCESS');
  assert.deepEqual(pendingSubwaySlots(station), []);
  assert.equal(subwaySlotStatus(station.scheduleSlots.find(s => s.key === '01:U')), '종착역(출발 없음)');
  assert.ok(createSubwayRows([station]).some(row => row.includes('평일') && row.includes('상행(U)') && row.includes('종착역 · 출발 열차 없음')));
});
