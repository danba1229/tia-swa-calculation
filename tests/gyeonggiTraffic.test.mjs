import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGgTraffic, collectGgTraffic, ggCatalog } from "../lib/gyeonggiTraffic.js";
import { buildWeekAnalysis, weekDates } from "../lib/trafficPeak.js";

function row(extra = {}) {
  return { YY: "2024", MT: "01", DE: "01", SPOT_NO_INFO: "4302-03", UPNDW_CD: "1", UPNDW_DIV: "상행",
    ROUTE_NM: "국도43", REGION: "화성", CIRCUMFR_BFRCT_NM: "팔탄-안녕", TDAY_SUM: "240",
    ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`TM${String(i + 1).padStart(2, "0")}_TRNSPORT_AMNT`, "10"])), ...extra };
}
function api(rows, total = rows.length) {
  return new Response(JSON.stringify({ ORDNTMTRNSPORTGENRLTM: [{ head: [{ list_total_count: total }, { RESULT: { CODE: "INFO-000" } }] }, { row: rows }] }));
}
test("GG fields retain exact source station and map TM01 to 00~01", () => {
  const s = parseGgTraffic([row({ TM01_TRNSPORT_AMNT: "20", TDAY_SUM: "250" })]);
  assert.equal(s.records[0].hours[0], 20); assert.equal(s.records[0].hours[23], 10);
  assert.equal(s.records[0].station, "4302-03"); assert.equal(s.months[0].month, "2024-01");
  assert.equal(s.months[0].points[0].directions.in, "1: 상행");
  assert.equal(s.months[0].points[0].locationVerified, false);
  assert.equal(ggCatalog(s).provider, "gyeonggi"); assert.equal(s.sourceSha256.length, 64);
});
test("missing values are not zeros; actual zero is retained", () => {
  const s = parseGgTraffic([row({ TM01_TRNSPORT_AMNT: "", TM02_TRNSPORT_AMNT: "-", TM03_TRNSPORT_AMNT: "0" })]);
  assert.deepEqual(s.records[0].hours.slice(0, 3), [null, null, 0]); assert.equal(s.missingValues, 2);
});
test("direction zero is preserved in raw but never added or used as a substitute", () => {
  const s = parseGgTraffic([row(), row({ UPNDW_CD: "2" }), row({ UPNDW_CD: "0", TDAY_SUM: "480" })]);
  assert.equal(s.records.length, 2); assert.equal(s.rawRows.length, 3); assert.equal(s.excludedDirectionRows, 1);
  const a = buildWeekAnalysis({ records: s.records, station: "4302-03", week: "2024-01-01" });
  assert.equal(a.days[0].total, 480);
  const missing = parseGgTraffic([row(), row({ UPNDW_CD: "0" })]);
  assert.equal(buildWeekAnalysis({ records: missing.records, station: "4302-03", week: "2024-01-01" }).days[0].total, null);
});
test("daily sum mismatch is excluded, raw original retained", () => {
  const s = parseGgTraffic([row({ TDAY_SUM: "999" })]);
  assert.equal(s.invalidDailyRows, 1); assert.ok(s.records[0].hours.every((h) => h === null));
  assert.equal(s.rawRows[0].TDAY_SUM, "999"); assert.match(ggCatalog(s).warning, /일합계/);
});
test("unknown schema, direction, invalid dates, duplicates fail closed", () => {
  for (const r of [row({ UPNDW_CD: "3" }), row({ DE: "32" }), row({ SPOT_NO_INFO: "D-13" })]) assert.throws(() => parseGgTraffic([r]));
  const r = row(); delete r.TM24_TRNSPORT_AMNT; assert.throws(() => parseGgTraffic([r]), /24시간/);
  assert.throws(() => parseGgTraffic([row(), row()]), /중복/);
  assert.throws(() => parseGgTraffic([]));
});
test("both directions use shared peak engine and missing days block weekly peaks", () => {
  const rows = weekDates("2024-01-01").flatMap((date) => ["1", "2"].map((d) => row({ DE: date.slice(8), UPNDW_CD: d })));
  const s = parseGgTraffic(rows);
  const a = buildWeekAnalysis({ records: s.records, station: "4302-03", week: "2024-01-01" });
  assert.equal(a.complete, true); assert.equal(a.dailyMax, 480); assert.equal(a.validHours, 168);
  assert.equal(buildWeekAnalysis({ records: s.records.slice(1), station: "4302-03", week: "2024-01-01" }).complete, false);
});
test("pagination collects all pages and rechecks first page", async () => {
  const calls = [];
  const s = await collectGgTraffic({ key: "test-secret", pageSize: 2, fetchImpl: async (url) => {
    const p = Number(url.searchParams.get("pIndex")); calls.push(p);
    assert.equal(url.searchParams.get("KEY"), "test-secret");
    return api(p === 1 ? [row(), row({ DE: "02" })] : [row({ DE: "03" })], 3);
  } });
  assert.deepEqual(calls, [1, 2, 1]); assert.equal(s.rowCount, 3);
});
test("empty, truncated and changing pages never publish partial results", async () => {
  await assert.rejects(collectGgTraffic({ key: "x", fetchImpl: async () => api([], 10) }));
  await assert.rejects(collectGgTraffic({ key: "x", pageSize: 1, fetchImpl: async (url) => api([row()], url.searchParams.get("pIndex") === "1" ? 2 : 3) }), /変更|변경|누락/);
  await assert.rejects(collectGgTraffic({ key: "x", pageSize: 1, fetchImpl: async () => api([row()], 2) }), /중복/);
});
test("HTML blocks, auth failure, network errors do not leak key", async () => {
  for (const fetchImpl of [async () => new Response("<html>blocked</html>"), async () => new Response(JSON.stringify({ RESULT: { CODE: "ERROR-300" } })), async () => { throw new Error("url?KEY=test-secret"); }]) {
    await assert.rejects(collectGgTraffic({ key: "test-secret", fetchImpl }), (e) => !e.message.includes("test-secret"));
  }
  await assert.rejects(collectGgTraffic({ key: "" }), /환경변수/);
});

async function testRoute({ snapshot, failure } = {}) {
  let source = readFileSync(new URL("../app/api/traffic-volume/gyeonggi/route.js", import.meta.url), "utf8");
  source = source.replace('import { NextResponse } from "next/server";', 'const NextResponse = Response;');
  source = source.replace('import { getGgTrafficSnapshot } from "../../../../lib/gyeonggiTrafficStore.js";',
    `async function getGgTrafficSnapshot() { ${failure ? 'throw new Error("secret-test-url");' : `return {snapshot:${JSON.stringify(snapshot)}, stale:false};`} }`);
  for (const name of ["gyeonggiTraffic", "trafficPeak"]) source = source.replace(`"../../../../lib/${name}.js"`, JSON.stringify(new URL(`../lib/${name}.js`, import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).GET;
}
test("actual GG route serves catalog, complete weekly result and raw monthly download", async () => {
  const snapshot = parseGgTraffic(weekDates("2024-01-01").flatMap((date) => ["1", "2"].map((d) => row({ DE: date.slice(8), UPNDW_CD: d }))));
  const GET = await testRoute({ snapshot });
  const request = (query = "") => new Request(`https://example.test/api/traffic-volume/gyeonggi${query}`);
  const catalog = await (await GET(request())).json();
  assert.equal(catalog.months[0].month, "2024-01"); assert.equal(catalog.provider, "gyeonggi");
  const a = await (await GET(request("?station=4302-03&week=2024-01-01"))).json();
  assert.equal(a.complete, true); assert.equal(a.dailyMax, 480); assert.equal(a.sources[0].month, "2024-01");
  const download = await GET(request("?source=2024-01"));
  assert.match(download.headers.get("content-disposition"), /GG-2024-01.json/);
  assert.equal((await download.json()).rows.length, 14);
  assert.equal((await GET(request("?source=2025-01"))).status, 404);
  assert.equal((await GET(request("?station=9999-99&week=2024-01-01"))).status, 404);
});
test("actual GG route rejects invalid parameters before touching storage and sanitizes errors", async () => {
  const GET = await testRoute({ failure: true });
  for (const query of ["?station=D-13&week=2024-01-01", "?station=4302-03&week=2024-02-30", "?direction=0", "?source=2024-13"]) {
    assert.equal((await GET(new Request(`https://example.test/${query}`))).status, 400);
  }
  const failed = await GET(new Request("https://example.test/"));
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("secret-test-url"));
});
