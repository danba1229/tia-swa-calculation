import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentTransportCache, nextTransportMonth, packTransport, unpackTransport } from '../lib/transportCache.js';
import { matchSeoulStation, readSeoulSubway, normalizeSeoulTimes } from '../lib/seoulSubway.js';
import { summarizeSubwayTimes } from '../lib/subway.js';

function fixture() {
  let time = Date.parse('2026-10-04T00:00:00Z'), entry = null, lease = null, saves = 0;
  const store = {
    read: async () => entry,
    claim: async (_, token) => { if (lease) return false; lease = token; return true; },
    save: async (_, token, value, expires) => { assert.equal(token, lease); entry = { value, expires, updated: time }; lease = null; saves++; return true; },
    fail: async (_, token) => { assert.equal(token, lease); lease = null; if (entry) entry.retry = time + 300000; },
  };
  return { store, now: () => time, advance: (ms) => { time += ms; }, saves: () => saves,
    saved: () => entry, set: (value) => { entry = value; }, busy: () => { lease = 'other'; } };
}
test('compressed cache roundtrip and monthly KST expiration', () => {
  assert.deepEqual(unpackTransport(packTransport({ rows: ['한글', 0, null] })), { rows: ['한글', 0, null] });
  assert.throws(() => unpackTransport('invalid'));
  assert.equal(new Date(nextTransportMonth(Date.parse('2026-10-04T18:59:59Z'))).toISOString(), '2026-10-04T19:00:00.000Z');
  assert.equal(new Date(nextTransportMonth(Date.parse('2026-10-04T19:00:00Z'))).toISOString(), '2026-11-04T19:00:00.000Z');
});
test('single-flight requests share one load and fresh data survives cold memory', async () => {
  const f = fixture(), cache = createPersistentTransportCache(f);
  let loads = 0;
  const loader = async () => { loads++; return { rows: [1] }; };
  const values = await Promise.all(Array.from({ length: 12 }, () => cache('same', loader)));
  assert.equal(loads, 1); assert.equal(f.saves(), 1);
  assert.equal(values[0].cacheInfo.updatedAt, new Date(f.now()).toISOString());
  const cold = createPersistentTransportCache(f);
  assert.deepEqual((await cold('same', loader)).rows, [1]); assert.equal(loads, 1);
});
test('failed and incomplete refreshes preserve old good data with stale warning', async () => {
  const f = fixture();
  await createPersistentTransportCache(f)('a', async () => ({ rows: [123] }), { ttl: 100 });
  f.advance(101);
  const stale = await createPersistentTransportCache(f)('a', async () => { throw new Error('upstream down'); });
  assert.equal(stale.cacheInfo.stale, true); assert.deepEqual(stale.rows, [123]);
  f.advance(300001);
  const partial = await createPersistentTransportCache(f)('a', async () => ({ rows: [] }), { complete: (v) => v.rows.length > 0 });
  assert.equal(partial.cacheInfo.stale, true); assert.equal(f.saves(), 1);
});
test('distributed busy lease never launches a duplicate upstream request', async () => {
  const f = fixture(); f.busy(); let loads = 0;
  await assert.rejects(createPersistentTransportCache({ ...f, sleep: async () => {} })('a', async () => { loads++; }), /갱신 중/);
  assert.equal(loads, 0);
});
test('DB outage falls back to live memory without falsely claiming persistence', async () => {
  const cache = createPersistentTransportCache({ store: { read: async () => { throw Error('offline'); } } });
  const value = await cache('a', async () => ({ rows: [0] }));
  assert.equal(value.cacheInfo.storage, 'MEMORY'); assert.deepEqual(value.rows, [0]);
});
test('partial results retry in five minutes, not next month', async () => {
  const f = fixture();
  await createPersistentTransportCache(f)('a', async () => ({ rows: [] }), { complete: () => false });
  assert.equal(f.saved().expires - f.now(), 300000);
});
test('cold workers share a distributed load instead of issuing duplicate calls', async () => {
  const f = fixture(); let loads = 0;
  const loader = async () => { loads++; await new Promise((resolve) => setTimeout(resolve, 10)); return { rows: [9] }; };
  const a = createPersistentTransportCache(f), b = createPersistentTransportCache({ ...f, sleep: () => new Promise((resolve) => setTimeout(resolve, 5)) });
  const results = await Promise.all([a('same', loader), b('same', loader)]);
  assert.equal(loads, 1); assert.deepEqual(results[0], results[1]);
});
test('unavailable upstream backs off in memory even without a database', async () => {
  const f = fixture(); let calls = 0;
  const cache = createPersistentTransportCache({ now: f.now });
  const loader = async () => { calls++; throw Error('offline'); };
  await assert.rejects(cache('a', loader)); await assert.rejects(cache('a', loader));
  assert.equal(calls, 1); f.advance(30001);
  await assert.rejects(cache('a', loader)); assert.equal(calls, 2);
});
test('Seoul subway matches line and station uniquely, preserving leading-zero codes', () => {
  const rows = [{ STATION_NM: '양재', LINE_NUM: '03호선', STATION_CD: '0332' }];
  assert.equal(matchSeoulStation('양재역', '3호선', rows), '0332');
  assert.equal(matchSeoulStation('양재', '신분당선', rows), '');
  assert.equal(matchSeoulStation('양재', '3호선', [...rows, ...rows]), '');
});
test('Seoul HTTP is fixed-host, redirects disabled, and connection errors hide key', async () => {
  const service = 'SearchInfoBySubwayNameService';
  const rows = await readSeoulSubway(service, ['양재'], { getKey: () => 'test-secret', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'http://openapi.seoul.go.kr:8088'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ [service]: { RESULT: { CODE: 'INFO-000' }, list_total_count: 1, row: [{ STATION_CD: '0332' }] } }) };
  } });
  assert.equal(rows[0].STATION_CD, '0332');
  await assert.rejects(readSeoulSubway(service, [], { getKey: () => 'secret', fetchImpl: async () => { throw Error('url/secret'); } }), (error) => !error.message.includes('secret'));
});
test('Seoul empty result and repeated page remain explicit, not zero schedules', async () => {
  const service = 'SearchSTNTimeTableByIDService';
  const options = { getKey: () => 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ RESULT: { CODE: 'INFO-200' } }) }) };
  assert.deepEqual(await readSeoulSubway(service, [], options), []);
  options.fetchImpl = async () => ({ ok: true, json: async () => ({ [service]: { RESULT: { CODE: 'INFO-000' }, list_total_count: 2, row: [{ id: 1 }] } }) });
  await assert.rejects(readSeoulSubway(service, [], options), /반복/);
});
test('terminal zero departures are omitted and local/express schedules stay separate', () => {
  const base = { STATION_CD: '0332', STATION_NM: '양재', DESTSTATION: '1958', SUBWAYENAME: '대화', LEFTTIME: '05:30:00', EXPRESS_YN: 'G' };
  const rows = normalizeSeoulTimes([base, { ...base, EXPRESS_YN: 'D', LEFTTIME: '06:00:00' }, { ...base, DESTSTATION: '0332', LEFTTIME: '00:00:00' }], 'SEOUL:0332', '02', 'U');
  const result = summarizeSubwayTimes(rows, 'SEOUL:0332', '02', 'U');
  assert.equal(rows.length, 2); assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].day, '토요일'); assert.equal(result.rows[0].source, '서울교통공사');
});
