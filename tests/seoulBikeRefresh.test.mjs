import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";
import { discoverBikeFile, parseBikeRows, buildBikeSnapshot, collectBikeSnapshot, refreshBikeSnapshot, BikeRefreshError } from "../lib/seoulBikeRefresh.js";
import { bundledBikeSnapshot, selectBikeSnapshot, usableBikeSnapshot } from "../lib/seoulBikeStore.js";
import { bikeRefreshStatusText } from "../lib/bikeRefreshStatus.js";

const html = `<form name="frmFile"><input name="infId" value="OA-13252"><input name="infSeq" value="2"></form>
<span title="공공자전거 대여소 정보(25.12월 기준).xlsx" onclick="downloadFile('23')">
<span title="공공자전거 대여소 정보(26.6월 기준).xlsx" onclick="downloadFile('24')">`;
const fixture = () => [
  ["대여소\n번호", "보관소(대여소)명", "소재지(위치)", null, null, null, "설치시기", "설치형태"],
  [null, null, null, null, null, null, null, "LCD", "QR"],
  [null, null, "자치구", "상세주소", "위도", "경도"],
  [null, null, null, null, null, null, null, "거치대수", "거치대수"], [],
  ...Array.from({ length: 1100 }, (_, i) => [i + 100, `대여소 ${i}`, "송파구", "서울 송파구", 37.5, 127.1, null, null, 10]),
];
const source = () => discoverBikeFile(html, "2026-10");
const snapshot = () => buildBikeSnapshot(parseBikeRows(fixture()), source(), null);
const code = expected => e => e.code === expected;

test("bike file discovery uses the latest non-future reference month and fails closed", () => {
  assert.equal(source().seq, "24");
  assert.equal(discoverBikeFile(html, "2026-01").baseMonth, "2025-12");
  assert.throws(() => discoverBikeFile("login"), code("FILE_LIST_CHANGED"));
  assert.throws(() => discoverBikeFile(html.replace("OA-13252", "OA-OTHER")), code("FILE_LIST_CHANGED"));
});
test("bike parser preserves missing values and sums LCD/QR capacity rather than available bikes", () => {
  const rows = fixture(); rows[5][7] = 3; rows[6][8] = null; rows[7][3] = " ";
  const stations = parseBikeRows(rows);
  assert.equal(stations[0].rackCount, 13);
  assert.equal(stations[1].rackCount, null);
  assert.equal(stations[2].address, "");
  rows[6][8] = 0; assert.equal(parseBikeRows(rows)[1].rackCount, 0);
});
test("bike parser rejects duplicate IDs, corrupt coordinates, malformed capacity and missing headers", () => {
  for (const mutate of [r => { r[6][0] = r[5][0]; }, r => { r[5][4] = null; }, r => { r[5][8] = "-"; }, r => { r[5][0] = null; }]) {
    const rows = fixture(); mutate(rows); assert.throws(() => parseBikeRows(rows));
  }
  assert.throws(() => parseBikeRows([["other"]]), code("INVALID_SCHEMA"));
});
test("bike snapshot rejects old source and suspicious row count changes", () => {
  const previous = snapshot();
  assert.throws(() => buildBikeSnapshot(previous.stations, { baseMonth: "2025-12" }, previous), code("OLDER_SOURCE"));
  assert.throws(() => buildBikeSnapshot(previous.stations.slice(0, 10), source(), previous), code("COUNT_CHANGED"));
  assert.throws(() => buildBikeSnapshot([...previous.stations, ...previous.stations], source(), previous), code("COUNT_CHANGED"));
});
test("collector detects unchanged bytes and same-month revisions, uses bounded no-redirect downloads", async () => {
  let rows = fixture();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options);
    if (url.includes("datasetView")) return new Response(html);
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "대여소현황");
    return new Response(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  };
  const first = await collectBikeSnapshot(null, { fetchImpl, now: "2026-10-07T00:00:00Z" });
  assert.equal(first.status, "UPDATED"); assert.equal(first.snapshot.source.sha256.length, 64);
  assert.equal((await collectBikeSnapshot(first.snapshot, { fetchImpl })).status, "UNCHANGED");
  rows = fixture(); rows[5][8] = 20;
  assert.equal((await collectBikeSnapshot(first.snapshot, { fetchImpl })).status, "UPDATED");
  assert.ok(calls.every(c => c.redirect === "error" && c.cache === "no-store"));
  await assert.rejects(() => collectBikeSnapshot(null, { fetchImpl: async () => new Response("", { status: 503 }) }), code("DOWNLOAD_FAILED"));
  await assert.rejects(() => collectBikeSnapshot(null, { fetchImpl: async () => new Response(html, { headers: { "content-length": "99999999" } }) }), code("DOWNLOAD_FAILED"));
});
test("refresh failures preserve last good data; busy and superseded leases cannot promote", async () => {
  let stored = snapshot(), finished;
  const original = stored;
  const store = { claim: async () => "token", current: async () => stored,
    finish: async (token, result) => { assert.equal(token, "token"); finished = result; if (result.status === "UPDATED") stored = result.snapshot; return true; } };
  const result = await refreshBikeSnapshot(store, { collect: async () => { throw new BikeRefreshError("INVALID_SCHEMA"); } });
  assert.equal(result.status, "FAILED"); assert.equal(finished.errorCode, "INVALID_SCHEMA"); assert.equal(stored, original);
  assert.equal((await refreshBikeSnapshot({ ...store, claim: async () => null })).status, "BUSY");
  assert.equal((await refreshBikeSnapshot({ ...store, finish: async () => false }, { collect: async () => ({ status: "UPDATED", snapshot: original }) })).status, "SUPERSEDED");
});
test("store selection uses current, previous or bundled snapshot without hiding failures", () => {
  const valid = { ...snapshot(), baseMonth: "2026-06" };
  assert.ok(usableBikeSnapshot(valid));
  assert.equal(selectBikeSnapshot({ snapshot: valid, status: "FAILED" }).snapshot, valid);
  assert.equal(selectBikeSnapshot({ snapshot: {}, previous_snapshot: valid }).refresh.storage, "PREVIOUS");
  assert.equal(selectBikeSnapshot({ snapshot: {} }).snapshot, bundledBikeSnapshot);
  assert.equal(selectBikeSnapshot({ snapshot: {} }).refresh.status, "INVALID_STORED_DATA");
});
test("monthly bike check is the first day 10:00 KST, version and warning remain explicit", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url)));
  assert.equal(config.crons.find(c => c.path === "/api/cron/seoul-bike-sync").schedule, "0 1 1 * *");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date("2026-11-01T01:00:00Z"));
  assert.equal(parts.find(p => p.type === "day").value, "01"); assert.equal(parts.find(p => p.type === "hour").value, "10");
  assert.match(bikeRefreshStatusText({ status: "FAILED" }), /이전 정상 자료/);
  assert.doesNotMatch(bikeRefreshStatusText({ status: "UNCHANGED" }), /미완료/);
});
