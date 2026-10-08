import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { fetchBusDetailBatch as fetchCachedBusDetailBatch, validateDetailRouteIds } from "../lib/seoulBusDetails.js";
import { createPersistentTransportCache } from "../lib/transportCache.js";
import { applyBusDetailUpdates, loadBusDetails, markPendingBusDetails } from "../lib/busDetailLoader.js";
import { createBusRouteTableRows } from "../lib/seoulBusTable.js";
import { createRequestGate } from "../lib/researchIntegrity.js";
import { transportScopeKey, needsGyeonggiRouteDetail, needsRetryBusDetail, busGapSummary } from "../lib/client/transportEnrichment.js";

const stations = [
  { stationId: "121000213", arsId: "22289", stationName: "A", routes: [
    { busRouteId: "100100596", routeName: "400", dataMode: "OFFICIAL_FILE" },
    { busRouteId: "100100597", routeName: "405", dataMode: "OFFICIAL_FILE" },
  ] },
  { stationId: "121000214", arsId: "22290", stationName: "B", routes: [{ busRouteId: "100100596", routeName: "400", dataMode: "OFFICIAL_FILE" }] },
];
const scope = { center: { lat: 37.4837, lng: 127.0347 }, width: 800, height: 800,
  bounds: { south: 37.4801, north: 37.4873, west: 127.0302, east: 127.0392 } };
const update = { busRouteId: "100100596", detail: { routeType: "3", startStation: "기점", endStation: "종점", interval: "12분" },
  stationTimes: [{ stationId: "121000213", arsId: "22289", stationFirstBusTime: "05:10", stationLastBusTime: "25:10" }], fetchedAt: "2026-10-03T00:00:00Z" };
const xml = (items) => `<ServiceResult><headerCd>0</headerCd>${items.map((item) => `<itemList>${Object.entries(item).map(([k,v])=>`<${k}>${v}</${k}>`).join("")}</itemList>`).join("")}</ServiceResult>`;
const fetchBusDetailBatch = (ids) => fetchCachedBusDetailBatch(ids, { cache: createPersistentTransportCache({ store: null }) });

test("detail IDs must belong to the server's in-scope snapshot and respect the batch limit", () => {
  validateDetailRouteIds(stations, ["100100596"]);
  for (const ids of [[], ["999999999"], ["100100596", "100100596"], [100100596], ["100100596", "100100597", "100100598"]]) {
    assert.throws(() => validateDetailRouteIds(stations, ids));
  }
});

test("detail merge preserves all stops/routes, matches NODE_ID and leaves day-specific intervals manual", () => {
  const before = JSON.stringify(stations);
  const result = applyBusDetailUpdates(stations, [update]);
  assert.equal(JSON.stringify(stations), before);
  assert.equal(result.length, 2);
  assert.equal(result[0].routes.length, 2);
  assert.equal(result[0].routes[0].stationFirstBusTime, "05:10");
  assert.equal(result[0].routes[0].startStation, "기점");
  assert.match(result[1].routes[0].stationFirstBusTime, /미제공/);
  assert.match(result[1].routes[0].stationTimeError, /해당 정류장/);
  const rows = createBusRouteTableRows(result);
  assert.equal(rows[1][10], "12분");
  rows[1].slice(11).forEach(value=>assert.equal(value, "수동확인필요"));
  assert.equal(rows[1].length, 15);
});

test("ambiguous repeat visits and conflicting station IDs never pick an arbitrary time", () => {
  const result = applyBusDetailUpdates(stations, [{ ...update, stationTimes: [
    ...update.stationTimes, { ...update.stationTimes[0], stationFirstBusTime: "06:00" },
  ] }]);
  assert.match(result[0].routes[0].stationTimeError, /복수 경유/);
  assert.match(result[0].routes[0].stationFirstBusTime, /미제공/);
  const conflict = applyBusDetailUpdates(stations, [{ ...update, stationTimes: [{ ...update.stationTimes[0], stationId: "wrong" }] }]);
  assert.match(conflict[0].routes[0].stationFirstBusTime, /미제공/);
});

test("stale cache warning preserves the last verified station timetable", () => {
  const result = applyBusDetailUpdates(stations, [{ ...update, cacheWarning: "이전 저장 자료 사용" }]);
  assert.equal(result[0].routes[0].stationFirstBusTime, "05:10");
  assert.equal(result[0].routes[0].cacheWarning, "이전 저장 자료 사용");
});

test("client requests each unique route once and applies progressive updates", async () => {
  const calls = [], progress = [];
  await loadBusDetails({ stations, scope, request: createRequestGate().start("bus"), onProgress: value=>progress.push(value),
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return Response.json({ success: true, updates: [update, { ...update, busRouteId: "100100597" }] });
    },
  });
  assert.deepEqual(calls[0].routeIds, ["100100596", "100100597"]);
  assert.equal(calls.length, 1);
  assert.equal(progress[0].loading, true);
  assert.equal(progress.at(-1).loading, false);
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).stations[0].routes[0].stationFirstBusTime, "05:10");
});

test("systemic failure halts requests and marks pending rows without deleting data", async () => {
  const progress = [];
  let calls = 0;
  await loadBusDetails({ stations, scope, request: createRequestGate().start("bus"), onProgress: p=>progress.push(p),
    fetchImpl: async () => { calls++; return Response.json({ success: true, stopped: true, message: "HTTPS 시간 초과",
      updates: [{ ...update, detail: null, stationTimes: [], detailError: "HTTPS 시간 초과", stationTimeError: "HTTPS 시간 초과" }] }); },
  });
  const last = progress.at(-1);
  assert.equal(calls, 1);
  assert.equal(last.completed, 1);
  assert.equal(last.stations.length, 2);
  assert.equal(last.stations[0].routes[1].detailStatus, "NOT_QUERIED");
  assert.match(last.stations[0].routes[0].detailError, /HTTPS 시간 초과/);
  assert.equal(createBusRouteTableRows(last.stations)[1].length, 15);
  assert.equal(last.stations[0].routes[0].routeName, "400");
});

test("later network failure retains earlier detail results and never echoes a transport error", async () => {
  const many = [{ ...stations[0], routes: [...stations[0].routes, { busRouteId: "100100598", routeName: "406" }] }];
  const progress = [];
  let calls = 0;
  await loadBusDetails({ stations: many, scope, request: createRequestGate().start("bus"), onProgress: p=>progress.push(p),
    fetchImpl: async () => {
      if (++calls === 1) return Response.json({ success: true, updates: [update, { ...update, busRouteId: "100100597" }] });
      throw new Error("serviceKey=secret");
    },
  });
  assert.equal(calls, 2);
  assert.equal(progress.at(-1).stations[0].routes[0].interval, "12분");
  assert.equal(progress.at(-1).stations[0].routes[2].detailStatus, "NOT_QUERIED");
  assert.ok(!JSON.stringify(progress).includes("secret"));
});

test("address changes discard in-flight detail callbacks, and reload can mark pending rows", async () => {
  const gate = createRequestGate(), progress = [];
  await loadBusDetails({ stations, scope, request: gate.start("bus"), onProgress: p=>progress.push(p),
    fetchImpl: async () => { gate.cancel(); return Response.json({ success: true, updates: [update] }); },
  });
  assert.equal(progress.length, 1);
  assert.equal(markPendingBusDetails(progress[0].stations, "중단")[0].routes[0].detailStatus, "NOT_QUERIED");
});

async function withApiMock(run, responder) {
  const names = ["SEOUL_BUS_API_KEY", "SEOUL_BUS_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY", "TIA_DATAGOKR"];
  const saved = names.map(name=>process.env[name]);
  names.forEach(name=>delete process.env[name]);
  process.env.SEOUL_BUS_API_KEY = "synthetic-secret";
  const oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (raw, options) => {
    const url = new URL(raw);
    assert.equal(url.origin, "http://ws.bus.go.kr");
    assert.equal(options.redirect, "error");
    calls.push(url.pathname);
    return responder(url);
  };
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    names.forEach((name,i)=>{ if(saved[i]===undefined)delete process.env[name];else process.env[name]=saved[i]; });
  }
}

test("server reads route-wide timetable with official field names and rejects other route data", async () => {
  await withApiMock(async (calls) => {
    const result = await fetchBusDetailBatch(["100100596"]);
    assert.equal(result.updates[0].detail.routeType, "간선");
    assert.equal(result.updates[0].stationTimes.length, 1);
    assert.equal(result.updates[0].stationTimes[0].stationFirstBusTime, "05:10:00");
    assert.equal(calls.length, 2);
  }, url=>new Response(xml(url.pathname.endsWith("getRouteInfo")
    ? [{ busRouteId: "100100596", routeType: "3", stStationNm: "기점", edStationNm: "종점", term: "12" }]
    : [{ busRouteId: "100100596", station: "121000213", arsId: "22289", beginTm: "051000", lastTm: "251000" }, { busRouteId: "other", station: "121000213" }])));
});

test("server stops the batch on connection errors and never echoes secrets", async () => {
  await withApiMock(async (calls) => {
    const result = await fetchBusDetailBatch(["100100596", "100100597"]);
    assert.equal(calls.length, 2);
    assert.equal(result.stopped, true);
    assert.equal(result.updates.length, 1);
    assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
  }, ()=>{ throw new Error("https://example.invalid/?serviceKey=synthetic-secret"); });
});

test("actual details endpoint validates scope/IDs before any upstream call", async () => {
  const require = createRequire(import.meta.url);
  let source = readFileSync(new URL("../app/api/seoul-bus/details/route.js", import.meta.url), "utf8");
  source = source.replace('"next/server"', JSON.stringify(pathToFileURL(require.resolve("next/server.js")).href));
  for (const name of ["seoulBusSnapshot", "seoulBusDetails", "seoulBusStore"]) source = source.replace(`"../../../../lib/${name}.js"`, JSON.stringify(new URL(`../lib/${name}.js`, import.meta.url).href));
  const { POST } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  await withApiMock(async (calls)=>{
    const bad = await POST(new Request("http://localhost/api/seoul-bus/details", { method: "POST", body: JSON.stringify({ scope, routeIds: ["999999999"] }) }));
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 0);
    const ok = await POST(new Request("http://localhost/api/seoul-bus/details", { method: "POST", body: JSON.stringify({ scope, routeIds: ["100100596"] }) }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).updates[0].busRouteId, "100100596");
  },()=>new Response(xml([])));
});

test("actual component callback preserves base results even if the detail loader unexpectedly throws", async () => {
  const component = readFileSync(new URL("../components/TiaResearchBuilder.jsx", import.meta.url), "utf8");
  const module = readFileSync(new URL('../lib/client/createTransportSearch.js', import.meta.url), 'utf8');
  const source = module.slice(module.indexOf('async function searchPublicTransportFacilities'), module.lastIndexOf(';'));
  let state = { basics: { siteAddress: "서울특별시 서초구" }, publicTransportResult: {} };
  const context = vm.createContext({
    form: state, requestGateRef: { current: createRequestGate() }, safe: value=>value || "", toNumber: Number,
    detectSurveyRegion: ()=>"seoul", setStatusText: ()=>{}, setForm: callback=>{ state=callback(state); },
    createBlankPublicTransportResult: overrides=>({ busStops: [], ...overrides }),
    resolveScopeCenter: async ()=>scope.center, computeRectangleBounds: ()=>scope.bounds, formatNumber: String,
    markPendingBusDetails, loadBusDetails: async ()=>{ throw new Error("unexpected failure"); },
    transportScopeKey, needsGyeonggiRouteDetail, needsRetryBusDetail, busGapSummary, loadSubwayDetails: async () => {},
    fetch: async url=>({ ok: true, json: async ()=>url.endsWith("seoul-bus")
      ? { success: true, busStops: stations, summary: { returnedCount: 2 } }
      : { success: true, stations: [{ id: "bike" }], summary: { withinScopeCount: 1 } } }),
  });
  vm.runInContext(source, context);
  await context.searchPublicTransportFacilities({ address: "서울특별시 서초구", width: 800, height: 800 });
  assert.equal(state.publicTransportResult.busStops.length, 2);
  assert.equal(state.publicTransportResult.bikeStations.length, 1);
  assert.equal(state.publicTransportResult.busStops[0].routes[0].routeName, "400");
  assert.match(state.publicTransportResult.busDetailError, /기본 목록은 유지/);
});

test("missing API key stops enrichment without an external request", async () => {
  await withApiMock(async calls=>{
    delete process.env.SEOUL_BUS_API_KEY;
    const result = await fetchBusDetailBatch(["100100596"]);
    assert.equal(calls.length, 0);
    assert.equal(result.stopped, true);
    assert.match(result.message, /환경변수/);
  },()=>assert.fail("must not request"));
});

test("malformed batch responses cannot be reported as successful completion", async () => {
  const progress=[];
  await loadBusDetails({ stations, scope, request: createRequestGate().start("bus"), onProgress:p=>progress.push(p),
    fetchImpl:async()=>Response.json({ success:true, updates:[] }),
  });
  assert.equal(progress.at(-1).completed, 0);
  assert.equal(progress.at(-1).loading, false);
  assert.match(progress.at(-1).error, /연결 실패/);
  assert.equal(progress.at(-1).stations.length, stations.length);
});
