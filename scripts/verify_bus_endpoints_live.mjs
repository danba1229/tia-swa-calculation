// Uses a few live provider calls. Never write to the operational transport DB.
import assert from 'node:assert/strict';
delete process.env.SEOUL_BUS_DATABASE_URL;
delete process.env.SEOUL_BUS_POSTGRES_URL;
const { fetchBusDetailBatch } = await import('../lib/seoulBusDetails.js');
const { fetchGyeonggiBusDetails } = await import('../lib/gyeonggiBus.js');
const { applyBusDetailUpdates } = await import('../lib/busDetailLoader.js');
const { createBusRouteTableRows } = await import('../lib/seoulBusTable.js');
for (const [region, id, run] of [
  ['seoul', '100100596', fetchBusDetailBatch],
  ['gyeonggi', '200000085', fetchGyeonggiBusDetails],
]) {
  try {
    const result = await run([id]);
    const update = result.updates?.[0];
    assert.ok(update?.detail && !update.detailError, `${region}: route lookup failed`);
    assert.ok(update.detail.originFirstBusTime && update.detail.originLastBusTime, `${region}: origin times missing`);
    const stations = applyBusDetailUpdates([{ stationName: '검증용', routes: [{ busRouteId: id }] }], [update]);
    const rows = createBusRouteTableRows(stations);
    assert.ok(rows.every(row => row.length === rows[0].length));
    assert.equal(rows[1][4], update.detail.originFirstBusTime);
    assert.equal(rows[1][5], update.detail.originLastBusTime);
    console.log(JSON.stringify({ region, routeId: id, columns: rows[0], values: rows[1],
      detailError: update.detailError, supplementError: update.supplementError,
      endpointTimeError: stations[0].routes[0].endpointTimeError }, null, 2));
  } catch {
    console.log(JSON.stringify({ region, status: 'LIVE_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
