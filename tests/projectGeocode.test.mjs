import test from "node:test";
import assert from "node:assert/strict";
import { createKakaoAddressLookup } from "../lib/kakao.js";
import { buildProjectAddressCandidates, geocodeProject, selectPreciseAddress } from "../lib/projectGeocode.js";
import { judgeReflection } from "../lib/judgeReflection.js";
import { haversineDistanceMeters } from "../lib/distance.js";
import { isInsideScope } from "../lib/tiaScope.js";

const yangjae = { address_type: "REGION_ADDR", address_name: "서울 서초구 양재동 1-26", x: "127.03911387726", y: "37.4848651314049" };
const seocho = { address_type: "REGION_ADDR", address_name: "서울 서초구 서초동 1584-7", x: "127.012219309422", y: "37.4852754366148" };
const missing = { success: false, code: "NOT_FOUND", message: "검색 결과 없음" };
const project = { projectName: "서초구 양재동 1-26번지 역세권 청년주택 신축공사 교통영향평가", location: "서울특별시 서초구 남부순환로 2636(양재동)" };

test("failed original and normalized road address recover with project-name parcel", async () => {
  const queries = [];
  const result = await geocodeProject(project, { lookup: async (query) => {
    queries.push(query);
    return query.endsWith("양재동 1-26") ? selectPreciseAddress(query, [yangjae]) : missing;
  } });
  assert.equal(result.success, true);
  assert.equal(result.method, "PARCEL_FALLBACK");
  assert.deepEqual(queries, [project.location, "서울특별시 서초구 남부순환로 2636", "서울 서초구 양재동 1-26"]);
  assert.equal(result.attempts.length, 3);
  const site = { latitude: 37.4836248649455, longitude: 127.032683002019 };
  const distanceMeters = haversineDistanceMeters(site, result);
  assert.equal(Math.round(distanceMeters), 584);
  assert.equal(isInsideScope(site, { ...result, distanceMeters }, 2300, 3200, 1971), true);
});

test("Seocho 1584-7 parcel fallback preserves original source address", async () => {
  const item = { projectName: "서초동 1584-7 오피스텔 신축공사", location: "서울특별시 서초구 반포대로14길 18 (서초동)" };
  const result = await geocodeProject(item, { lookup: async (q) => q.endsWith("서초동 1584-7") ? selectPreciseAddress(q, [seocho]) : missing });
  assert.equal(result.success, true);
  assert.equal(result.matchedAddress, seocho.address_name);
  assert.equal(item.location, "서울특별시 서초구 반포대로14길 18 (서초동)");
});

test("neighborhood centroids are never accepted or assigned a distance", async () => {
  const doc = { address_type: "REGION", address_name: "서울 서초구 서초동", x: "127.0195", y: "37.4900" };
  const result = await geocodeProject({ location: "서울특별시 서초구 서초동" }, { lookup: async (q) => selectPreciseAddress(q, [doc]) });
  assert.equal(result.success, false);
  assert.equal(result.code, "REGION_ONLY");
  assert.equal(result.latitude, undefined);
  assert.match(judgeReflection({ geocodeStatus: "failed", geocodeMessage: result.message }, null, 2000).reflectionReason, /대표 좌표/);
});

test("precise match validates road numbers, parcel subnumbers, jurisdiction and mountain parcels", () => {
  const road = { ...yangjae, address_type: "ROAD_ADDR", address_name: "서울 서초구 반포대로14길 18" };
  assert.equal(selectPreciseAddress("서울특별시 서초구 반포대로14길 18 (서초동)", [road]).success, true);
  assert.equal(selectPreciseAddress("서울 서초구 반포대로14길 19", [road]).code, "ADDRESS_MISMATCH");
  assert.equal(selectPreciseAddress("서울 서초구 양재동 1-27", [yangjae]).code, "ADDRESS_MISMATCH");
  assert.equal(selectPreciseAddress("경기 성남시 양재동 1-26", [yangjae]).code, "ADDRESS_MISMATCH");
  assert.equal(selectPreciseAddress("서울 서초구 양재동 산1-26", [yangjae]).code, "ADDRESS_MISMATCH");
  assert.equal(selectPreciseAddress("서울 서초구", [yangjae]).code, "INSUFFICIENT_ADDRESS");
  assert.equal(selectPreciseAddress("서울 서초구 양재동 1-26", [{ ...yangjae, x: null }]).success, false);
});

test("ambiguous or truncated API results are not silently reduced to first match", () => {
  assert.equal(selectPreciseAddress("서울 서초구 양재동 1-26", [yangjae, { ...yangjae, x: "127.04" }]).code, "AMBIGUOUS_ADDRESS");
  assert.equal(selectPreciseAddress("서울 서초구 양재동 1-26", [yangjae], 31).code, "AMBIGUOUS_ADDRESS");
});

test("conflicting city in project title and multiple parcels require manual confirmation", async () => {
  const cases = [
    [{ location: "서울 서초구 강남대로79길 42", projectName: "김포시 풍무동 오피스텔 신축공사" }, "ADMIN_CONFLICT"],
    [{ location: "서울특별시 서초구 반포동 1-23번지(공공청사), 1-19번지(문화시설) 일원" }, "MULTIPLE_LOCATIONS"],
    [{ location: "서울 서초구 양재동 1-26 외 3필지" }, "MULTIPLE_LOCATIONS"],
    [{ location: "서울 서초구 반포동 1-23, 1-19" }, "MULTIPLE_LOCATIONS"],
  ];
  for (const [item, code] of cases) {
    const result = await geocodeProject(item, { lookup: () => { throw new Error("must not call"); } });
    assert.equal(result.code, code);
    assert.equal(result.attempts.length, 0);
  }
});

test("rural parcel prefix is not duplicated and irrelevant raw office addresses are ignored", () => {
  const plan = buildProjectAddressCandidates({ location: "경기도 포천시 신북면", projectName: "신북면 가채리 777 개발사업", raw: { developerAddress: "서울 강남구 테헤란로 1" } });
  assert.ok(plan.candidates.some((item) => item.query === "경기 포천시 신북면 가채리 777"));
  assert.ok(!JSON.stringify(plan).includes("강남구"));
  assert.equal(buildProjectAddressCandidates({ projectName: "양재동 1-26 신축공사" }).candidates.length, 0);
  assert.equal(buildProjectAddressCandidates({ projectName: "2024년 신규 사업", location: "서울 서초구" }).candidates.some((c) => c.method === "PARCEL_FALLBACK"), false);
  assert.equal(buildProjectAddressCandidates({ location: "부산광역시 기장군 기장읍", projectName: "부산광역시 기장군 사업" }).code, undefined);
  assert.equal(buildProjectAddressCandidates({ location: "서울 서초구 양재동 1-26 (1필지)" }).code, undefined);
  assert.equal(selectPreciseAddress("경기도 포천시 신북면 가채리 777", [{ ...yangjae, address_name: "경기 포천시 다른면 가채리 777" }]).code, "ADDRESS_MISMATCH");
});

test("API errors are classified, sanitized and do not cascade into parcel retries", async () => {
  for (const [status, code] of [[401, "AUTH_ERROR"], [403, "AUTH_ERROR"], [429, "RATE_LIMITED"], [500, "API_ERROR"]]) {
    let calls = 0;
    const lookup = createKakaoAddressLookup({ getApiKey: () => "test-secret", fetchImpl: async () => { calls++; return new Response("private detail", { status }); } });
    const result = await geocodeProject(project, { lookup });
    assert.equal(result.code, code);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes("test-secret"));
    assert.ok(!JSON.stringify(result).includes("private detail"));
  }
  for (const [name, code] of [["TimeoutError", "TIMEOUT"], ["Error", "NETWORK_ERROR"]]) {
    const lookup = createKakaoAddressLookup({ getApiKey: () => "test-secret", fetchImpl: async () => { throw Object.assign(new Error("private detail"), { name }); } });
    assert.equal((await lookup(project.location)).code, code);
  }
});

test("successful lookup is cached briefly, failures are retried and exact query is requested", async () => {
  let calls = 0, now = 100;
  const query = "서울 서초구 양재동 1-26";
  const lookup = createKakaoAddressLookup({ getApiKey: () => "test-secret", now: () => now, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get("analyze_type"), "exact");
    assert.equal(options.redirect, "error");
    return Response.json({ documents: calls === 1 ? [] : [yangjae] });
  } });
  assert.equal((await lookup(query)).success, false);
  assert.equal((await lookup(query)).success, true);
  assert.equal((await lookup(query)).success, true);
  assert.equal(calls, 2);
  now += 600001;
  await lookup(query);
  assert.equal(calls, 3);
});

test("missing configuration, invalid response and exhausted search budget remain explicit failures", async () => {
  const noKey = createKakaoAddressLookup({ getApiKey: () => "" });
  assert.equal((await noKey(project.location)).code, "MISSING_API_KEY");
  const bad = createKakaoAddressLookup({ getApiKey: () => "test", fetchImpl: async () => new Response("not json") });
  assert.equal((await bad(project.location)).code, "INVALID_RESPONSE");
  const result = await geocodeProject(project, { budgetMs: 0, lookup: () => assert.fail("must not query") });
  assert.equal(result.code, "TIMEOUT");
});
