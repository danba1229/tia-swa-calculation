import test from "node:test";
import assert from "node:assert/strict";
import { topisPost, TOPIS_MAX_BYTES, networkErrorDetails } from "../lib/topisRequest.js";
import { collectTopisYears } from "../lib/topisSync.js";

function requestHarness(fetchImpl) {
  const logs = [], sleeps = [];
  return { logs, sleeps, options: { fetchImpl, logger: (v) => logs.push(v), sleepImpl: async (ms) => sleeps.push(ms) } };
}
const json = () => new Response('{"rows":[]}');
const networkFailure = () => new TypeError("fetch failed secret=do-not-log", {
  cause: Object.assign(new Error("connection secret=do-not-log"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
});

test("TOPIS logs nested transport codes and retries without raw errors or params", async () => {
  let calls = 0;
  const h = requestHarness(async () => { if (++calls < 3) throw networkFailure(); return json(); });
  assert.deepEqual(await topisPost("/test", { key: "do-not-log" }, h.options), { rows: [] });
  assert.deepEqual(h.sleeps, [1500, 3000]);
  assert.equal(h.logs[0].stage, "connect");
  assert.equal(h.logs[0].error.cause.code, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(h.logs[2].event, "topis_request_success");
  assert.equal(JSON.stringify(h.logs).includes("do-not-log"), false);
});

test("TOPIS retains bounded AggregateError diagnostics and exhausts retries", async () => {
  const error = new TypeError("fetch failed", { cause: new AggregateError([
    Object.assign(new Error("secret"), { code: "ETIMEDOUT", syscall: "connect" }),
    Object.assign(new Error("secret"), { code: "ENETUNREACH" }),
  ]) });
  const h = requestHarness(async () => { throw error; });
  await assert.rejects(topisPost("/test", {}, h.options), (e) => {
    assert.equal(e.retryable, true);
    assert.equal(e.diagnostic.attempt, 3);
    assert.equal(e.diagnostic.error.cause.errors[1].code, "ENETUNREACH");
    assert.match(e.message, /ETIMEDOUT/);
    return true;
  });
  const cyclic = new Error("secret"); cyclic.cause = cyclic;
  assert.ok(JSON.stringify(networkErrorDetails(cyclic)).length < 500);
});

test("HTTP 429 respects capped Retry-After and cancels failed response body", async () => {
  let calls = 0, canceled = false;
  const h = requestHarness(async () => ++calls === 1 ? new Response(new ReadableStream({ cancel() { canceled = true; } }),
    { status: 429, headers: { "retry-after": "9999" } }) : json());
  await topisPost("/test", {}, h.options);
  assert.deepEqual(h.sleeps, [60000]);
  assert.equal(canceled, true);
  assert.equal(h.logs[0].status, 429);
});

test("HTTP 503 and timeout can recover; 403, invalid JSON and TLS cannot", async () => {
  for (const fail of [() => new Response("busy", { status: 503 }), () => { throw new DOMException("timeout", "TimeoutError"); }]) {
    let calls = 0;
    const h = requestHarness(async () => ++calls === 1 ? fail() : json());
    await topisPost("/test", {}, h.options);
    assert.equal(calls, 2);
  }
  for (const fail of [() => new Response("secret", { status: 403 }), () => new Response("<html>secret</html>"),
    () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("secret"), { code: "CERT_HAS_EXPIRED" }) }); }]) {
    const h = requestHarness(async () => fail());
    await assert.rejects(topisPost("/test", {}, h.options), (e) => e.retryable === false && !e.message.includes("secret"));
    assert.equal(h.sleeps.length, 0);
  }
});

test("body read errors retry but oversized files stop immediately", async () => {
  let calls = 0;
  const h = requestHarness(async () => ++calls === 1 ? new Response(new ReadableStream({ start(c) {
    c.error(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }));
  } })) : json());
  await topisPost("/test", {}, h.options);
  assert.equal(h.logs[0].stage, "body");
  const large = requestHarness(async () => new Response("abc", { headers: { "content-length": String(TOPIS_MAX_BYTES + 1) } }));
  await assert.rejects(topisPost("/test", {}, large.options), /TOPIS_SIZE_LIMIT/);
  assert.equal(large.sleeps.length, 0);
});

function syncHarness(overrides = {}) {
  const saved = [], recorded = [], logs = [], sleeps = [];
  const deps = {
    list: async (year) => [{ month: `${year}-08`, fingerprint: "new" }],
    download: async () => Buffer.from("xlsx"), parse: () => ({ rowCount: 100, missingValues: 3 }),
    stored: async () => null, save: async (...v) => saved.push(v), record: async (...v) => recorded.push(v), ...overrides,
  };
  return { deps, saved, recorded, logs, sleeps, options: { logger: (v) => logs.push(v), sleepImpl: async (ms) => sleeps.push(ms) } };
}
const transient = () => Object.assign(new Error("TOPIS source connection failed"), { retryable: true, diagnostic: {} });

test("long retries only revisit failed years and recover FAILED to CHECKED", async () => {
  const calls = [];
  const h = syncHarness({ list: async (year) => {
    calls.push(year);
    if (year === 2026 && calls.filter((y) => y === year).length < 3) throw transient();
    return [{ month: `${year}-08` }];
  } });
  const result = await collectTopisYears([2025, 2026], h.deps, h.options);
  assert.equal(result.success, true);
  assert.deepEqual(calls, [2025, 2026, 2026, 2026]);
  assert.deepEqual(h.sleeps, [120000, 300000]);
  assert.equal(h.saved.length, 2);
  assert.deepEqual(h.recorded.at(-1).slice(0, 2), ["2026", "CHECKED"]);
});

test("completed months skipped during retry, unchanged source never downloaded", async () => {
  const downloads = [];
  const h = syncHarness({ list: async () => ["01", "02", "03"].map((m) => ({ month: `2026-${m}`, fingerprint: "same" })),
    stored: async (m) => m.endsWith("01") ? { fingerprint: "same" } : null,
    download: async (item) => { downloads.push(item.month); if (item.month.endsWith("03") && downloads.length === 2) throw transient(); return Buffer.from("ok"); },
  });
  const result = await collectTopisYears([2026], h.deps, h.options);
  assert.equal(result.success, true);
  assert.deepEqual(downloads, ["2026-02", "2026-03", "2026-03"]);
  assert.equal(h.saved.length, 2);
});

test("parse failures and row shrink preserve old data and never retry", async () => {
  for (const overrides of [ { parse: () => { throw new Error("bad workbook"); } },
    { stored: async () => ({ fingerprint: "old", data: { rowCount: 200 } }) } ]) {
    const h = syncHarness(overrides);
    const result = await collectTopisYears([2026], h.deps, h.options);
    assert.equal(result.success, false);
    assert.equal(h.saved.length, 0);
    assert.equal(h.sleeps.length, 0);
    assert.equal(result.failures[0].retryable, false);
    assert.deepEqual(h.recorded.at(-1).slice(0, 2), ["2026", "PARTIAL"]);
  }
});

test("permanent failure survives another month's successful retry", async () => {
  let calls = 0;
  const h = syncHarness({ list: async () => [{ month: "2026-01" }, { month: "2026-02" }],
    download: async (item) => { if (item.month.endsWith("01")) throw new Error("bad workbook"); if (++calls === 1) throw transient(); return Buffer.from("ok"); },
  });
  const r = await collectTopisYears([2026], h.deps, h.options);
  assert.equal(r.success, false);
  assert.deepEqual(r.failures.map((f) => f.key), ["2026-01"]);
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.recorded.at(-1).slice(0, 2), ["2026", "PARTIAL"]);
});

test("network exhaustion remains failure; DB failures do not trigger source retry", async () => {
  const h = syncHarness({ list: async () => { throw transient(); } });
  const r = await collectTopisYears([2026], h.deps, h.options);
  assert.equal(r.success, false);
  assert.equal(r.failures.length, 1);
  assert.equal(h.sleeps.length, 2);
  const db = syncHarness({ stored: async () => { throw new Error("database error"); } });
  await assert.rejects(collectTopisYears([2026], db.deps, db.options), /database error/);
  assert.equal(db.sleeps.length, 0);
  assert.equal(db.saved.length, 0);
});
