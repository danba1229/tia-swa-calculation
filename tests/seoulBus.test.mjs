import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { searchSeoulBusStopsInScope, validateSeoulBusScope } from "../lib/seoulBus.js";
import { BUS_ROUTE_COLUMNS, createBusRouteTableRows } from "../lib/seoulBusTable.js";

const scope = { center: { lat: 37.57, lng: 126.98 }, bounds: { south: 37.568, north: 37.572, west: 126.978, east: 126.982 }, width: 200, height: 200 };
const tags = (obj) => Object.entries(obj).map(([key, value]) => `<${key}>${value}</${key}>`).join("");
const xml = (items, headerCd = "0") => `<ServiceResult><msgHeader><headerCd>${headerCd}</headerCd><headerMsg>provider-message</headerMsg><itemCount>0</itemCount></msgHeader><msgBody>${items.map((item) => `<itemList>${tags(item)}</itemList>`).join("")}</msgBody></ServiceResult>`;
const stops = [{ stationId: "1001", stationNm: "A", arsId: "00123", gpsX: "126.98", gpsY: "37.57" }, { stationId: "1002", stationNm: "B", arsId: "00124", gpsX: "126.981", gpsY: "37.57" }];
const route = { busRouteId: "100100123", busRouteNm: "123", routeType: "3" };
const detail = { ...route, stStationNm: "기점", edStationNm: "종점", firstBusTm: "20261002043000", lastBusTm: "20261003010000", term: "12" };

async function loadApiRoute() {
  const root = process.env.TIA_NEXT_MODULE_ROOT || fileURLToPath(new URL("../", import.meta.url));
  const require = createRequire(pathToFileURL(`${root}/package.json`));
  let source = readFileSync(new URL("./fixtures/liveBusRoute.js", import.meta.url), "utf8");
  source = source.replace('"next/server"', JSON.stringify(pathToFileURL(require.resolve("next/server.js")).href));
  source = source.replace('"../../../lib/seoulBus"', JSON.stringify(new URL("../lib/seoulBus.js", import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function mocked(run, handler = () => undefined) {
  const oldFetch = globalThis.fetch;
  const keyNames = ["SEOUL_BUS_API_KEY", "SEOUL_BUS_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY", "TIA_DATAGOKR"];
  const oldKeys = keyNames.map((name) => process.env[name]);
  keyNames.forEach((name) => delete process.env[name]);
  process.env.SEOUL_BUS_API_KEY = "synthetic-test-key";
  const calls = [];
  globalThis.fetch = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push(url);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "ws.bus.go.kr");
    assert.ok(options.signal instanceof AbortSignal);
    const custom = await handler(url, options);
    if (custom !== undefined) return custom;
    let items;
    if (url.pathname.endsWith("/getStationByPos")) {
      assert.equal(url.searchParams.get("tmX"), String(Number(url.searchParams.get("tmX"))));
      assert.ok(Number(url.searchParams.get("tmX")) > 126);
      assert.ok(Number(url.searchParams.get("tmY")) < 38);
      items = stops;
    } else if (url.pathname.endsWith("/getRouteByStation")) items = [route];
    else if (url.pathname.endsWith("/getRouteInfo")) items = [detail];
    else if (url.pathname.endsWith("/getBustimeByStation")) {
      const arsId = url.searchParams.get("arsId");
      items = [{ busRouteId: route.busRouteId, arsId, firstBusTm: arsId === "00123" ? "050000" : "050500", lastBusTm: "253000" }];
    } else assert.fail(`Unexpected endpoint ${url.pathname}`);
    return new Response(xml(items));
  };
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    keyNames.forEach((name, index) => { if (oldKeys[index] === undefined) delete process.env[name]; else process.env[name] = oldKeys[index]; });
  }
}

test("joins stops, routes, cached route detail and distinct station times; preserves ARS zeros", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations.length, 2);
    assert.equal(result.stations[0].arsId, "00123");
    const first = result.stations[0].routes[0];
    const second = result.stations[1].routes[0];
    assert.equal(first.stationFirstBusTime, "05:00:00");
    assert.equal(second.stationFirstBusTime, "05:05:00");
    assert.equal(first.stationLastBusTime, "25:30:00");
    assert.equal(first.originFirstBusTime, "2026-10-02 04:30:00");
    assert.equal(first.originLastBusTime, "2026-10-03 01:00:00");
    assert.equal(first.startStation, "기점");
    assert.equal(first.endStation, "종점");
    assert.equal(first.interval, "12분");
    assert.match(first.weekdayInterval, /미제공/);
    assert.match(first.saturdayInterval, /미제공/);
    assert.match(first.holidayInterval, /미제공/);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/getRouteInfo")).length, 1);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/getBustimeByStation")).length, 2);
    assert.equal(result.summary.partial, false);
    assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
    assert.equal("updatedAt" in result, false);
  });
});

test("detail business error preserves station times/routes and does not echo credentials", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations[0].routes[0].stationFirstBusTime, "05:00:00");
    assert.match(result.stations[0].routes[0].originFirstBusTime, /미제공/);
    assert.equal(result.summary.failedRouteDetails, 2);
    assert.equal(result.summary.partial, true);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/getRouteInfo")).length, 1);
    assert.ok(!JSON.stringify(result).includes("synthetic-test-key"));
  }, (url) => url.pathname.endsWith("/getRouteInfo") ? new Response(xml([detail], "7").replace("provider-message", "serviceKey=synthetic-test-key")) : undefined);
});

for (const kind of ["HTTP429", "timeout", "empty"]) {
  test(`station-time ${kind} retains route-origin detail and reports partial`, async () => {
    await mocked(async () => {
      const result = await searchSeoulBusStopsInScope(scope);
      assert.equal(result.stations[0].routes[0].originFirstBusTime, "2026-10-02 04:30:00");
      assert.match(result.stations[0].routes[0].stationFirstBusTime, /미제공/);
      assert.equal(result.summary.failedStationTimes, 2);
      assert.equal(result.summary.partial, true);
      assert.ok(!JSON.stringify(result).includes("synthetic-test-key"));
    }, (url) => {
      if (!url.pathname.endsWith("/getBustimeByStation")) return undefined;
      if (kind === "timeout") throw new DOMException("secret-url=synthetic-test-key", "TimeoutError");
      return kind === "empty" ? new Response(xml([])) : new Response("secret-url=synthetic-test-key", { status: 429 });
    });
  });
}

test("empty valid stop result makes no route/detail calls", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.deepEqual(result.stations, []);
    assert.ok(calls.every((url) => url.pathname.endsWith("/getStationByPos")));
  }, () => new Response(xml([])));
});

test("single item is retained despite itemCount=0, and unprovided time/term is not invented", async () => {
  await mocked(async () => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations.length, 1);
    const item = result.stations[0].routes[0];
    assert.match(item.originFirstBusTime, /미제공/);
    assert.match(item.originLastBusTime, /미제공/);
    assert.match(item.interval, /미제공/);
  }, (url) => {
    if (url.pathname.endsWith("/getStationByPos")) return new Response(xml([stops[0]]));
    if (url.pathname.endsWith("/getRouteInfo")) return new Response(xml([{ ...route, firstBusTm: "없음", lastBusTm: "999999", term: "0" }]));
    return undefined;
  });
});

test("blank or projected-only station coordinates never become geographic coordinates", async () => {
  await mocked(async () => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.deepEqual(result.stations, []);
  }, () => new Response(xml([{ ...stops[0], gpsX: "", gpsY: "", posX: "126.98", posY: "37.57" }])));
});

test("station route failure is explicit rather than a fabricated count of zero", async () => {
  await mocked(async () => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.summary.failedStationRoutes, 2);
    assert.equal(result.summary.partial, true);
    assert.match(result.stations[0].routeError, /응답 오류/);
    assert.ok(createBusRouteTableRows(result.stations)[1].slice(1).every(value => value === "-"));
  }, (url) => url.pathname.endsWith("/getRouteByStation") ? new Response(xml([], "4")) : undefined);
});

test("missing success header and HTTP200 business failure are rejected", async () => {
  for (const body of ["<html>synthetic-test-key</html>", xml([], "1")]) {
    await mocked(async () => {
      await assert.rejects(searchSeoulBusStopsInScope(scope), (error) => /응답 오류/.test(error.message) && !error.message.includes("synthetic-test-key"));
    }, () => new Response(body));
  }
});

test("invalid/null scope and excessive station/grid requests fail before API calls", async () => {
  for (const invalid of [{ ...scope, center: { lat: null, lng: 126.98 } }, { ...scope, width: 0 }, { ...scope, maxStations: 0 }, { ...scope, maxStations: 36 }, { ...scope, width: 10000, height: 10000 }, { ...scope, bounds: { ...scope.bounds, north: scope.bounds.south } }]) {
    assert.throws(() => validateSeoulBusScope(invalid));
  }
});

test("nearest-stop cap reports truncation and never requests detail for omitted stops", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope({ ...scope, maxStations: 1 });
    assert.equal(result.summary.withinScopeCount, 2);
    assert.equal(result.summary.returnedCount, 1);
    assert.equal(result.summary.truncated, true);
    assert.equal(calls.filter((url) => url.pathname.endsWith("/getRouteByStation")).length, 1);
  });
});

test("missing key fails without sending any request", async () => {
  await mocked(async (calls) => {
    delete process.env.SEOUL_BUS_API_KEY;
    await assert.rejects(searchSeoulBusStopsInScope(scope), /환경변수가 설정되지 않았습니다/);
    assert.equal(calls.length, 0);
  });
});

test("UI/CSV have identical row widths and never reuse old inferred weekday times", () => {
  const rows = createBusRouteTableRows([{ stationName: "legacy", routes: [{ routeName: "123", firstBusTime: "05:00", weekdayInterval: "12분" }] }, { stationName: "failed", routeError: "조회 실패" }]);
  assert.equal(BUS_ROUTE_COLUMNS.length, 15);
  assert.ok(rows.every((row) => row.length === BUS_ROUTE_COLUMNS.length));
  assert.match(rows[1][3], /미제공/);
  assert.match(rows[1][10], /미제공/);
  assert.ok(rows[2].slice(1).every(value => value === "-"));
  assert.ok(!BUS_ROUTE_COLUMNS.includes("조회 상태"));
});

test("table uses endpoint times only and never substitutes intermediate stop times or exposes status", () => {
  const rows = createBusRouteTableRows([{ stationName: "A", routes: [
    { stationFirstBusTime: "05:10", stationLastBusTime: "25:10", originFirstBusTime: "04:00", originLastBusTime: "23:00", detailError: "internal error" },
    { originFirstBusTime: "04:00", originLastBusTime: "23:00" },
  ] }]);
  assert.deepEqual(rows[1].slice(4, 6), ["04:00", "23:00"]);
  rows[2].slice(7, 9).forEach(value => assert.match(value, /미제공/));
  assert.ok(!JSON.stringify(rows).includes("05:10"));
  assert.ok(!JSON.stringify(rows).includes("25:10"));
  assert.ok(!JSON.stringify(rows).includes("internal error"));
  assert.ok(!rows[0].some(column => /정류장 첫차|정류장 막차|조회 상태/.test(column)));
});

test("API route rejects blank coordinates, zero limits and missing dimensions without fetch", async () => {
  const { POST } = await loadApiRoute();
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Invalid input must not call external API");
  try {
    for (const body of [{ ...scope, center: { lat: "", lng: 126.98 } }, { ...scope, maxStations: 0 }, { ...scope, height: null }]) {
      const response = await POST({ json: async () => body });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).success, false);
    }
  } finally { globalThis.fetch = original; }
});

test("HHmm, midnight, extended night hours and calendar-date boundaries stay distinct", async () => {
  for (const [firstBusTm, lastBusTm, firstExpected, lastExpected] of [
    ["000000", "243000", "00:00:00", "24:30:00"],
    ["0430", "25:30:00", "04:30", "25:30:00"],
    ["20240229043000", "20261003010000", "2024-02-29 04:30:00", "2026-10-03 01:00:00"],
    ["20260229043000", "00000000000000", null, null],
    ["04300", "300000", null, null],
    ["시각 0430", "046000", null, null],
  ]) {
    await mocked(async () => {
      const item = (await searchSeoulBusStopsInScope(scope)).stations[0].routes[0];
      if (firstExpected) assert.equal(item.originFirstBusTime, firstExpected);
      else assert.match(item.originFirstBusTime, /미제공/);
      if (lastExpected) assert.equal(item.originLastBusTime, lastExpected);
      else assert.match(item.originLastBusTime, /미제공/);
    }, (url) => url.pathname.endsWith("/getRouteInfo") ? new Response(xml([{ ...detail, firstBusTm, lastBusTm }])) : undefined);
  }
});

test("wrong detail route/stop IDs never attach another route's timetable", async () => {
  await mocked(async () => {
    const result = await searchSeoulBusStopsInScope(scope);
    const item = result.stations[0].routes[0];
    assert.match(item.originFirstBusTime, /미제공/);
    assert.match(item.stationFirstBusTime, /미제공/);
    assert.equal(result.summary.failedRouteDetails, 2);
    assert.equal(result.summary.failedStationTimes, 2);
  }, (url) => {
    if (url.pathname.endsWith("/getRouteInfo")) return new Response(xml([{ ...detail, busRouteId: "other-route" }]));
    if (url.pathname.endsWith("/getBustimeByStation")) return new Response(xml([{ ...route, arsId: "99999", firstBusTm: "050000", lastBusTm: "230000" }]));
    return undefined;
  });
});

test("missing ARS ID retains stop and makes no unsupported route request", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations.length, 1);
    assert.equal(result.summary.failedStationRoutes, 1);
    assert.match(result.stations[0].routeError, /ARS/);
    assert.ok(calls.every((url) => url.pathname.endsWith("/getStationByPos")));
  }, (url) => url.pathname.endsWith("/getStationByPos") ? new Response(xml([{ ...stops[0], arsId: "" }])) : undefined);
});

test("missing route ID keeps route name but marks detail/time as unprovided", async () => {
  await mocked(async (calls) => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations[0].routes[0].routeName, "123");
    assert.match(result.stations[0].routes[0].detailError, /ID 미제공/);
    assert.match(result.stations[0].routes[0].stationTimeError, /ID 미제공/);
    assert.ok(!calls.some((url) => /getRouteInfo|getBustimeByStation/.test(url.pathname)));
  }, (url) => url.pathname.endsWith("/getRouteByStation") ? new Response(xml([{ ...route, busRouteId: "" }])) : undefined);
});

test("XML entity decoding preserves display names and decimal geographic coordinates", async () => {
  await mocked(async () => {
    const result = await searchSeoulBusStopsInScope(scope);
    assert.equal(result.stations[0].stationName, 'A & "B"');
    assert.equal(result.stations[0].latitude, 37.57);
    assert.equal(result.stations[0].longitude, 126.98);
  }, (url) => url.pathname.endsWith("/getStationByPos") ? new Response(xml([{ ...stops[0], stationNm: "A &amp; &quot;B&quot;" }])) : undefined);
});

test("encoded existing test key is decoded once and correctly query encoded", async () => {
  await mocked(async (calls) => {
    process.env.SEOUL_BUS_API_KEY = '"encoded%2Btest%2Fkey%3D"';
    await searchSeoulBusStopsInScope(scope);
    assert.ok(calls.every((url) => url.searchParams.get("serviceKey") === "encoded+test/key="));
  });
});

test("a fresh search retries prior detail failure without keeping a stale failure cache", async () => {
  let fail = true;
  await mocked(async (calls) => {
    assert.equal((await searchSeoulBusStopsInScope(scope)).summary.partial, true);
    fail = false;
    const recovered = await searchSeoulBusStopsInScope(scope);
    assert.equal(recovered.summary.partial, false);
    assert.equal(recovered.stations[0].routes[0].originFirstBusTime, "2026-10-02 04:30:00");
    assert.equal(calls.filter((url) => url.pathname.endsWith("/getRouteInfo")).length, 2);
  }, (url) => fail && url.pathname.endsWith("/getRouteInfo") ? new Response(xml([], "7")) : undefined);
});

test("actual component CSV/clipboard serializers retain row shape and escape special cells", () => {
  const source = readFileSync(new URL("../components/TiaResearchBuilder.jsx", import.meta.url), "utf8");
  const clipboardSource = source.slice(source.indexOf("function toClipboardText(rows)"), source.indexOf("function toCsvText(rows)"));
  const csvSource = source.slice(source.indexOf("function toCsvText(rows)"), source.indexOf("async function copyDevelopmentTable()"));
  const clipboard = new Function(`${clipboardSource}; return toClipboardText;`)();
  const csv = new Function(`${csvSource}; return toCsvText;`)();
  assert.equal(csv([['A,"B"', "한글\n표", "00123"]]), '"A,""B""","한글\n표",00123');
  assert.equal(clipboard([["A\tB", "한글\n표", "00123"]]), "A B\t한글 표\t00123");
  const rows = createBusRouteTableRows([{ stationName: "A", routes: [route] }]);
  assert.equal(clipboard(rows).split("\n")[0].split("\t").length, 15);
  assert.ok(csv(rows).includes("기점 첫차"));
  assert.ok(csv(rows).includes("배차시간(토요일)"));
});

test("approved HTTP API success exposes only parsed data, not provider messages or request URLs", async () => {
  const { POST } = await loadApiRoute();
  await mocked(async () => {
    const response = await POST({ json: async () => scope });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.busStops.length, 2);
    assert.ok(!JSON.stringify(result).includes("synthetic-test-key"));
    assert.ok(!JSON.stringify(result).includes("serviceKey="));
  }, (url) => url.pathname.endsWith("/getStationByPos") ? new Response(xml(stops).replace("provider-message", "https://ws.bus.go.kr/path?serviceKey=synthetic-test-key")) : undefined);
});

const sensitiveUrl = "http://ws.bus.go.kr/path?serviceKey=synthetic-test-key";
const securityCases = [
  ["same-host HTTP redirect", () => new Response(null, { status: 302, headers: { Location: "http://ws.bus.go.kr/path?serviceKey=synthetic-test-key" } }), /리디렉션을 차단/],
  ["other-host HTTPS redirect", () => new Response(null, { status: 307, headers: { Location: "https://other.invalid/path?serviceKey=synthetic-test-key" } }), /리디렉션을 차단/],
  ["native fetch redirect refusal", () => { throw new TypeError(sensitiveUrl, { cause: new Error("unexpected redirect") }); }, /리디렉션을 차단/],
  ["HTTP timeout", () => { throw new DOMException(sensitiveUrl, "TimeoutError"); }, /HTTP 응답 시간 초과\(10초\)/],
  ["TLS certificate failure", () => { throw new TypeError(sensitiveUrl, { cause: Object.assign(new Error(sensitiveUrl), { code: "CERT_HAS_EXPIRED" }) }); }, /HTTPS 인증서 확인 실패/],
  ["HTTP connection failure", () => { throw new TypeError(sensitiveUrl, { cause: Object.assign(new Error(sensitiveUrl), { code: "ECONNREFUSED" }) }); }, /HTTP 연결 실패/],
  ["HTTP429 secret-bearing provider body", () => new Response(sensitiveUrl, { status: 429 }), /HTTP 요청 실패 \(HTTP 429\)/],
];
for (const [name, handler, expected] of securityCases) {
  test(`${name}: API error and logs never expose key/URL and no redirect is followed`, async () => {
    const { POST } = await loadApiRoute();
    const oldError = console.error;
    const captured = [];
    console.error = (...items) => captured.push(items.join(" "));
    try {
      await mocked(async (calls) => {
        const response = await POST({ json: async () => scope });
        assert.equal(response.status, 500);
        const result = await response.json();
        assert.match(result.message, expected);
        assert.equal(result.success, false);
        assert.equal(calls.length, 1);
        const emitted = JSON.stringify({ result, captured });
        assert.ok(!emitted.includes("synthetic-test-key"));
        assert.ok(!emitted.includes("serviceKey="));
        assert.ok(!emitted.includes(sensitiveUrl));
        assert.ok(!emitted.includes("other.invalid"));
        assert.deepEqual(captured, []);
      }, handler);
    } finally { console.error = oldError; }
  });
}
