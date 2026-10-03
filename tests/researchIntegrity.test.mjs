import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { nullableArea, residualArea, areaStats, createRequestGate } from "../lib/researchIntegrity.js";
import { isInsideScope, summarizeProjects } from "../lib/tiaScope.js";
import { geocodeProject } from "../lib/projectGeocode.js";

test("missing area is not zero and incomplete/negative residual is not invented", () => {
  for (const value of [null, undefined, "", " ", "-", NaN, -1]) assert.equal(nullableArea(value), null);
  assert.equal(nullableArea("0"), 0);
  assert.equal(nullableArea("1,234"), 1234);
  assert.equal(residualArea(1000, [100, ""]), null);
  assert.equal(residualArea(1000, [1100, 0]), null);
  assert.equal(residualArea(1000, [100, 0]), 900);
});

test("partial report retains source total without normalizing known rows to 100 percent", () => {
  const partial = areaStats([{ value: 100 }, { value: "" }], 1000);
  assert.equal(partial.total, 1000);
  assert.equal(partial.entries[1].value, null);
  assert.equal(partial.complete, false);
  assert.equal(areaStats([{ value: 100 }, { value: null }]).total, null);
  assert.equal(areaStats([{ value: 100 }, { value: 0 }]).total, 100);
  assert.equal(areaStats([{ value: 1100 }, { value: null }], 1000).consistent, false);
});

const statsSource = readFileSync(new URL("../app/api/local-statistics/route.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "").replace(/^export /gm, "");
const statsContext = vm.createContext({ residualArea });
vm.runInContext(statsSource, statsContext);

test("actual KOSIS mapping preserves missing land categories and does not inflate other", () => {
  const result = vm.runInContext('makeLanduseAreas([{C3_NM:"계",DT:"1000"},{C3_NM:"전",DT:"100"},{C3_NM:"답",DT:"-"}])', statsContext);
  assert.equal(result.areas.전, "100");
  assert.equal(result.areas.답, "");
  assert.equal(result.areas.기타, "");
  assert.equal(result.total, 1000);
});

test("missing nonurban table never becomes a zero total or disappears from zoning rows", () => {
  const result = vm.runInContext('makeZoningRows([{C2_NM:"도시지역",DT:"1000"},{C2_NM:"주거지역",DT:"100"}], [])', statsContext);
  assert.equal(result.total, null);
  assert.equal(result.rows.find((r) => r.name === "관리지역").area, "");
  assert.equal(result.rows.find((r) => r.name === "기타").area, "");
});

test("request gate discards stale responses on replacement, input change and reset", () => {
  const gate = createRequestGate();
  const old = gate.start("statistics");
  const transport = gate.start("transport");
  const next = gate.start("statistics");
  assert.equal(old.current(), false);
  assert.equal(old.signal.aborted, true);
  assert.equal(next.current(), true);
  assert.equal(transport.current(), true);
  gate.cancel("statistics");
  assert.equal(next.current(), false);
  assert.equal(transport.current(), true);
  gate.cancel();
  assert.equal(transport.current(), false);
});

test("rectangle excludes a point inside circumscribed circle but outside map width", () => {
  const site = { latitude: 37.5, longitude: 127 };
  const east = { latitude: 37.5, longitude: 127 + 1500 / (111320 * Math.cos(37.5 * Math.PI / 180)), distanceMeters: 1500 };
  assert.equal(isInsideScope(site, east, 2300, 3200, 1971), false);
  assert.equal(isInsideScope(site, { ...site, distanceMeters: 0 }, 2300, 3200, 1971), true);
  assert.equal(isInsideScope(site, { ...site, distanceMeters: null }, 2300, 3200, 1971), false);
});

const routeSource = readFileSync(new URL("../app/api/tia/search/route.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "").replace(/^export /gm, "");

function tiaHandler(projects, lookup = async (address) => ({ success: true, latitude: 37.5, longitude: 127, matchedAddress: address })) {
  const context = vm.createContext({
    createHash, isInsideScope, summarizeProjects, console,
    NextResponse: { json: (data, options) => new Response(JSON.stringify(data), options) },
    geocodeAddress: async (address) => ({ success: true, latitude: 37.5, longitude: 127, matchedAddress: address }),
    geocodeProject,
    lookupKakaoAddress: lookup,
    isTiaDatabaseConfigured: () => false,
    searchStoredTiaProjects: async () => [],
    buildLocalNoticeSearches: () => [],
    haversineDistanceMeters: () => 0,
    judgeReflection: (p, d) => ({ reflectionStatus: d === null ? "제외후보" : "반영", reflectionReason: "test" }),
    fetchTiaProjects: async () => ({ rawCount: projects.length, projects, errors: [], sources: [], sourceCounts: {} }),
  });
  vm.runInContext(routeSource, context);
  return (body) => context.POST(new Request("http://localhost/api/tia/search", { method: "POST", body: JSON.stringify({ siteAddress: "site", width: 2300, height: 3200, ...body }) }));
}

test("batched actual handler reaches the nearby 81st candidate without dropping or duplicating any", async () => {
  const projects = Array.from({ length: 81 }, (_, i) => ({ id: String(i), location: i === 80 ? "nearby" : "" }));
  const handler = tiaHandler(projects);
  let offset = 0, datasetId;
  const results = [];
  do {
    const response = await handler({ offset, datasetId });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.results.length <= 20);
    results.push(...payload.results);
    offset = payload.pagination.nextOffset;
    datasetId = payload.pagination.datasetId;
  } while (offset !== null);
  assert.equal(results.length, 81);
  assert.equal(new Set(results.map((r) => r.id)).size, 81);
  assert.equal(results.find((r) => r.id === "80").withinScope, true);
  assert.equal(summarizeProjects(81, results).withinRadiusCount, 1);
});

test("changed candidate snapshot fails explicitly rather than mixing pages", async () => {
  const handler = tiaHandler([{ id: "1", location: "nearby" }]);
  assert.equal((await handler({ offset: 0, datasetId: "old" })).status, 409);
  assert.equal((await handler({ offset: -1 })).status, 400);
});

test("actual handler retains precise-address failure reasons and never computes failed distances", async () => {
  const handler = tiaHandler([{ id: "centroid", location: "서울 서초구 서초동" }], async () => ({ success: false, code: "REGION_ONLY", message: "동 대표 좌표" }));
  const payload = await (await handler({})).json();
  const result = payload.results[0];
  assert.equal(result.distanceMeters, null);
  assert.equal(result.latitude, null);
  assert.equal(result.withinScope, false);
  assert.equal(result.geocodeCode, "REGION_ONLY");
  assert.equal(result.geocodeAttempts[0].query, "서울 서초구 서초동");
  assert.equal(payload.summary.geocodedCount, 0);
});

test("actual handler surfaces systemic geocoder errors rather than reporting zero projects", async () => {
  const handler = tiaHandler([{ id: "1", location: "서울 서초구 양재동 1-26" }], async () => ({ success: false, code: "RATE_LIMITED", message: "호출 제한" }));
  const response = await handler({});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RATE_LIMITED");
});

const component = readFileSync(new URL("../components/TiaResearchBuilder.jsx", import.meta.url), "utf8");
function getFunction(name) {
  let start = component.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  if (component.slice(start - 6, start) === "async ") start -= 6;
  const tail = component.slice(start);
  return tail.slice(0, tail.indexOf("\n  }") + 4);
}

test("development CSV and clipboard rows retain original and matched addresses with query trace", () => {
  const context = vm.createContext({ developmentScaleText: () => "-", formatDevelopmentDistance: () => "584 m" });
  vm.runInContext(getFunction("developmentGeocodeText") + "\n" + getFunction("developmentTableRows") + "\n" + getFunction("toCsvText"), context);
  const rows = context.developmentTableRows([{
    location: "서울 서초구 남부순환로 2636", matchedAddress: "서울 서초구 양재동 1-26", geocodeStatus: "success", geocodeMethod: "PARCEL_FALLBACK",
    geocodeAttempts: [{ query: "서울 서초구 양재동 1-26", message: "상세 주소 일치 확인" }],
  }]);
  assert.equal(rows[0].length, 14);
  assert.equal(rows[1].length, 14);
  assert.equal(rows[1][2], "서울 서초구 남부순환로 2636");
  assert.equal(rows[1][4], "서울 서초구 양재동 1-26");
  assert.match(rows[1][3], /지번 재검색/);
  assert.match(context.toCsvText(rows), /"지번 재검색/);
});

test("table rows and Excel serializer preserve null while displaying real zero", () => {
  const start = component.indexOf("  function buildExcelReportSheet(");
  const end = component.indexOf("  function buildExcelChartSheet(", start);
  const context = vm.createContext({ form: { statisticsYear: "2024" }, DEFAULT_STATISTICS_YEAR: "2024" });
  vm.runInContext(component.slice(start, end), context);
  const rows = [{ label: "전", area: 0, ratio: 0 }, { label: "답", area: null, ratio: null }];
  const sheet = context.buildExcelReportSheet("test", "KOSIS", rows);
  assert.deepEqual(Array.from(sheet[5]), ["면적_m2", 0, null]);
  assert.deepEqual(Array.from(sheet[6]), ["면적_km2", 0, null]);
  assert.deepEqual(Array.from(sheet[7]), ["구성비_%", 0, null]);
});

test("main investigation starts independent tasks without waiting for map SDK", () => {
  const source = getFunction("startInvestigation");
  const calls = [];
  vm.runInNewContext(source + "\nstartInvestigation();", {
    form: { basics: { siteAddress: "site" } }, safe: String,
    getScopeDimensions: () => ({ width: 2300, height: 3200 }),
    refreshLocalStatisticsOnly: () => calls.push("stats"),
    searchDevelopmentPlans: () => calls.push("development"),
    searchPublicTransportFacilities: () => calls.push("transport"),
    renderScopeMap: () => calls.push("map"),
  });
  assert.deepEqual(calls, ["stats", "development", "transport", "map"]);
});

test("actual statistics callback does not apply an old response after input cancellation", async () => {
  let resolve;
  let state = {};
  const gate = createRequestGate();
  const context = vm.createContext({
    form: { basics: { siteAddress: "old-address" }, statisticsYear: "2024" },
    requestGateRef: { current: gate }, safe: String, DEFAULT_STATISTICS_YEAR: "2024",
    setStatusText: () => {}, setForm: (updater) => { state = updater(state); },
    fetchLocalStatistics: () => new Promise((done) => { resolve = done; }),
  });
  vm.runInContext(getFunction("refreshLocalStatisticsOnly"), context);
  const pending = context.refreshLocalStatisticsOnly();
  gate.cancel();
  state = { basics: { siteAddress: "new-address" } };
  resolve({ patch: { landuseAreas: { 전: "123" } }, message: "old response" });
  await pending;
  assert.equal(state.landuseAreas, undefined);
  assert.equal(state.basics.siteAddress, "new-address");
});
