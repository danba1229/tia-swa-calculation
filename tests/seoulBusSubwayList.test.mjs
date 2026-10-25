import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRouteDetail } from '../lib/seoulBus.js';
import { fetchBusDetailBatch } from '../lib/seoulBusDetails.js';
import { subwayStationListComplete } from '../lib/subway.js';

const xml = (headerCd, items = '') => `<ServiceResult><msgHeader><headerCd>${headerCd}</headerCd><headerMsg>msg</headerMsg></msgHeader><msgBody>${items}</msgBody></ServiceResult>`;
const routeItem = routeType => `<itemList><busRouteId>100100001</busRouteId><routeType>${routeType}</routeType><firstBusTm>20261025040000</firstBusTm><lastBusTm>20261025230000</lastBusTm><stStationNm>A</stStationNm><edStationNm>B</edStationNm><term>10</term></itemList>`;

async function withBusApi(handler, run) {
  const original = globalThis.fetch, names = ['SEOUL_BUS_API_KEY', 'SEOUL_TDATA_API_KEY'], old = names.map(n => process.env[n]);
  process.env.SEOUL_BUS_API_KEY = 'fixture'; delete process.env.SEOUL_TDATA_API_KEY;
  globalThis.fetch = async url => new Response(handler(new URL(url)), { status: 200 });
  try { await run(); } finally { globalThis.fetch = original; names.forEach((n, i) => { if (old[i] == null) delete process.env[n]; else process.env[n] = old[i]; }); }
}

test('Seoul BIS code 4 is reported as missing data, not as a key or quota problem', async () => {
  await withBusApi(() => xml(4), async () => {
    const detail = await fetchRouteDetail('100100001');
    assert.match(detail.noData, /자료 없음\(코드 4\).*수동 확인/);
    assert.doesNotMatch(detail.noData, /인증/);
  });
  await withBusApi(() => xml(7), async () => {
    await assert.rejects(fetchRouteDetail('100100001'), /오류코드 7\).*인증/);
  });
});

test('a no-data route keeps the batch going and surfaces one clear detail note', async () => {
  await withBusApi(url => url.pathname.endsWith('/getRouteInfo') ? xml(4) : xml(0), async () => {
    const cache = (_key, loader) => loader();
    const { updates, stopped } = await fetchBusDetailBatch(['100100001'], { cache });
    assert.equal(stopped, false);
    assert.match(updates[0].detailError, /자료 없음\(코드 4\)/);
    assert.equal(updates[0].detail.noData, undefined);
  });
});

test('route type codes outside the known table are labelled instead of shown as a bare number', async () => {
  for (const [code, label] of [['3', '간선'], ['0', '공용'], ['15', '기타(코드 15)']]) {
    await withBusApi(() => xml(0, routeItem(code)), async () => {
      assert.equal((await fetchRouteDetail('100100001')).routeType, label);
    });
  }
});

test('a station with no official code no longer makes every station-list refresh partial', () => {
  const ok = { stationName: '시청역 1호선', subwayStationId: 'SEOUL:0151', codeStatus: 'SUCCESS' };
  const airport = { stationName: '서울역 공항철도', subwayStationId: '', codeStatus: 'NOT_FOUND' };
  assert.equal(subwayStationListComplete({ truncated: false, stations: [ok, airport] }), true);
  assert.equal(subwayStationListComplete({ truncated: false, stations: [ok, { ...airport, codeStatus: 'AMBIGUOUS' }] }), true);
  for (const codeStatus of ['LOOKUP_FAILED', 'NOT_QUERIED', undefined]) {
    assert.equal(subwayStationListComplete({ truncated: false, stations: [ok, { ...airport, codeStatus }] }), false, String(codeStatus));
  }
  assert.equal(subwayStationListComplete({ truncated: true, stations: [ok] }), false);
});

test('details cached with a bare route type code are labelled when read', async () => {
  await withBusApi(() => xml(0), async () => {
    const cached = { 'seoul-bus-detail:100100610': { routeType: '15', startStation: '우이동' }, 'seoul-bus-detail:100100033': { routeType: '간선', startStation: '도봉산역' } };
    const cache = (key, loader) => key in cached ? Promise.resolve(cached[key]) : loader();
    const { updates } = await fetchBusDetailBatch(['100100610', '100100033'], { cache });
    assert.equal(updates[0].detail.routeType, '기타(코드 15)');
    assert.equal(updates[0].detail.startStation, '우이동');
    assert.equal(updates[1].detail.routeType, '간선');
  });
});
