import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import snapshot from "../data/seoul-bus-snapshot.json" with { type: "json" };
import { searchSeoulBusSnapshot, validateSnapshotScope } from "../lib/seoulBusSnapshot.js";
import { createBusRouteTableRows } from "../lib/seoulBusTable.js";

function scope(lat = 37.5665, lng = 126.978, width = 2300, height = 3200) {
  const dy = height / 2 / 111320;
  const dx = width / 2 / (111320 * Math.cos(lat * Math.PI / 180));
  return { center: { lat, lng }, width, height, bounds: { north: lat + dy, south: lat - dy, east: lng + dx, west: lng - dx } };
}

test("official snapshot has provenance, unique stops and unique routes per stop", () => {
  assert.equal(snapshot.baseDate, "2026-09-02");
  assert.equal(snapshot.stations.length, 11228);
  assert.equal(new Set(snapshot.stations.map(s => s.id)).size, snapshot.stations.length);
  assert.equal(snapshot.sources.length, 2);
  for (const source of snapshot.sources) {
    assert.match(source.url, /^https:\/\/data.seoul.go.kr\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.rowCount > 1000);
  }
  for (const station of snapshot.stations) {
    assert.ok(station.latitude > 33 && station.latitude < 39);
    assert.ok(station.longitude > 124 && station.longitude < 132);
    assert.ok(!station.stationType.includes("선착장"));
    assert.equal(new Set(station.routes.map(r => r.busRouteId)).size, station.routes.length);
  }
  assert.ok(snapshot.stations.some(s => /^0\d{4}$/.test(s.arsId)));
});

test("rectangle search returns every stop without the former 35-stop cap, sorted by distance", () => {
  const input = scope();
  const result = searchSeoulBusSnapshot(input);
  const expected = snapshot.stations.filter(s => s.latitude >= input.bounds.south && s.latitude <= input.bounds.north && s.longitude >= input.bounds.west && s.longitude <= input.bounds.east);
  assert.ok(result.busStops.length > 35);
  assert.deepEqual(new Set(result.busStops.map(s => s.id)), new Set(expected.map(s => s.id)));
  assert.equal(result.summary.returnedCount, expected.length);
  assert.equal(result.summary.truncated, false);
  assert.equal(result.sourceDate, snapshot.baseDate);
  result.busStops.forEach((s, i) => {
    assert.ok(Number.isFinite(s.distanceMeters));
    if (i) assert.ok(s.distanceMeters >= result.busStops[i - 1].distanceMeters);
    assert.equal(s.distanceKm, s.distanceMeters / 1000);
  });
});

test("missing operations data stays manual, never inferred from route number or zero", () => {
  const result = searchSeoulBusSnapshot(scope());
  const rows = createBusRouteTableRows(result.busStops);
  assert.equal(rows[0].length, 15);
  for (const row of rows.slice(1)) {
    assert.equal(row.length, 15);
    if (row[2] === "-") continue;
    assert.match(row[1], /수동 확인/);
    row.slice(3).forEach(cell => assert.match(cell, /수동 확인/));
  }
  assert.equal(result.sourceDate, "2026-09-02");
});

test("empty area succeeds with an empty result; no outside stops are substituted", () => {
  const result = searchSeoulBusSnapshot(scope(37.5, 127, 1, 1));
  assert.equal(result.success, true);
  assert.equal(result.busStops.length, 0);
});

test("invalid scope is rejected", () => {
  for (const input of [scope(0, 0), scope(37.5, 127, 0), scope(37.5, 127, 10001), { ...scope(), center: null }, { ...scope(), bounds: { north: NaN } }]) {
    assert.throws(() => validateSnapshotScope(input));
  }
});

async function loadRoute() {
  const require = createRequire(import.meta.url);
  let source = readFileSync(new URL("../app/api/seoul-bus/route.js", import.meta.url), "utf8");
  source = source.replace('"next/server"', JSON.stringify(pathToFileURL(require.resolve("next/server.js")).href));
  source = source.replace('"../../../lib/seoulBusSnapshot"', JSON.stringify(new URL("../lib/seoulBusSnapshot.js", import.meta.url).href));
  source = source.replace('"../../../lib/seoulBusStore.js"', JSON.stringify(new URL("../lib/seoulBusStore.js", import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("production handler needs no external API request and returns snapshot data", async () => {
  const { POST } = await loadRoute();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("External request forbidden in snapshot mode"); };
  try {
    const response = await POST(new Request("http://localhost/api/seoul-bus", { method: "POST", body: JSON.stringify(scope()) }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.dataMode, "OFFICIAL_FILE");
    assert.ok(result.busStops.length > 35);
    const bad = await POST(new Request("http://localhost/api/seoul-bus", { method: "POST", body: JSON.stringify({ ...scope(), width: "" }) }));
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = oldFetch; }
});
