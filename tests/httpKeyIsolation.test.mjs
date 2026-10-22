import test from "node:test";
import assert from "node:assert/strict";
import { readDedicatedHttpKey, normalizeApiKey, KNOWN_API_KEY_NAMES } from "../lib/httpKeyIsolation.js";
import { searchSeoulBusStopsInScope } from "../lib/seoulBus.js";
import { readSeoulSubway, readSeoulSubwayKey } from "../lib/seoulSubway.js";

const BUS = ["SEOUL_BUS_API_KEY", "SEOUL_BUS_SERVICE_KEY"];

test("dedicated key passes when no other credential shares it", () => {
  const result = readDedicatedHttpKey(BUS, { env: { SEOUL_BUS_API_KEY: "bus-only", TAGO_SUBWAY_API_KEY: "shared" } });
  assert.deepEqual(result, { status: "ok", key: "bus-only", name: "SEOUL_BUS_API_KEY" });
});

test("missing, placeholder and URL-looking values are treated as missing", () => {
  assert.equal(readDedicatedHttpKey(BUS, { env: {} }).status, "missing");
  assert.equal(readDedicatedHttpKey(BUS, { env: { SEOUL_BUS_API_KEY: "[SENSITIVE]" } }).status, "missing");
  assert.equal(readDedicatedHttpKey(BUS, { env: { SEOUL_BUS_API_KEY: "http://example.invalid" } }).status, "missing");
});

test("shared data.go.kr fallbacks are never used for the HTTP bus service", () => {
  const result = readDedicatedHttpKey(BUS, { env: { DATA_GO_KR_SERVICE_KEY: "shared", TIA_DATAGOKR: "shared" } });
  assert.equal(result.status, "missing");
  assert.equal(result.key, "");
});

test("a key equal to any other credential is refused, even when URL-encoded or quoted", () => {
  for (const other of KNOWN_API_KEY_NAMES.filter((name) => !BUS.includes(name))) {
    const env = { SEOUL_BUS_API_KEY: '"abc%2Bdef%3D"', [other]: "abc+def=" };
    const result = readDedicatedHttpKey(BUS, { env });
    assert.equal(result.status, "shared", other);
    assert.equal(result.key, "");
  }
  assert.equal(normalizeApiKey(" 'abc%2Bdef%3D' "), "abc+def=");
});

test("aliases of the same HTTP service may hold the same key", () => {
  const result = readDedicatedHttpKey(BUS, { env: { SEOUL_BUS_API_KEY: "same", SEOUL_BUS_SERVICE_KEY: "same" } });
  assert.equal(result.status, "ok");
});

async function withEnv(values, run) {
  const names = [...KNOWN_API_KEY_NAMES];
  const saved = names.map((name) => process.env[name]);
  names.forEach((name) => delete process.env[name]);
  Object.assign(process.env, values);
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error("network disabled in test"); };
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
}

test("Seoul bus search refuses a shared key without sending any HTTP request", async () => {
  await withEnv({ SEOUL_BUS_API_KEY: "account-key", GYEONGGI_BUS_STATION_API_KEY: "account-key" }, async (calls) => {
    await assert.rejects(
      searchSeoulBusStopsInScope({ center: { lat: 37.57, lng: 126.98 }, bounds: { south: 37.568, north: 37.572, west: 126.978, east: 126.982 }, width: 200, height: 200 }),
      (error) => /전용 키/.test(error.message) && !error.message.includes("account-key"),
    );
    assert.equal(calls.length, 0);
  });
});

test("Seoul subway refuses a shared key without sending any HTTP request", async () => {
  await withEnv({ SEOUL_SUBWAY_API_KEY: "seoul-key", SEOUL_TDATA_API_KEY: "seoul-key" }, async (calls) => {
    assert.throws(() => readSeoulSubwayKey(), /전용 키/);
    await assert.rejects(readSeoulSubway("SearchInfoBySubwayNameService", ["서울"]), /전용 키/);
    assert.equal(calls.length, 0);
  });
});
