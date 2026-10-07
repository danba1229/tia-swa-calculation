import test from "node:test";
import assert from "node:assert/strict";
import { gyeonggiPointLink, peakAnalysisIdentity, peakConnectionRows } from "../lib/trafficPointLink.js";

const candidate = { pointCode: "4302-03", routeCode: "43", routeName: "일반국도 43호선", jurisdiction: "경기 화성 봉담읍", sourceYear: "2024" };
const point = { code: "4302-03", name: "일반국도 43호선 · 경기 화성 봉담읍 · 안녕IC분기" };

test("GG links exact station, route, area and source year only", () => {
  assert.equal(gyeonggiPointLink(candidate, [point], "2024-12").status, "MATCHED");
  for (const change of [{ routeName: "지방도 43호선" }, { jurisdiction: "경기 수원" }, { jurisdiction: "-" }, { sourceYear: "2023" }, { sourceYear: "" }]) {
    assert.equal(gyeonggiPointLink({ ...candidate, ...change }, [point], "2024-12").station, "");
  }
});

test("different codes are not normalized or replaced with a nearby route", () => {
  for (const code of ["04302-03", "4302-3", "0309-04"]) {
    assert.equal(gyeonggiPointLink({ ...candidate, pointCode: code }, [point], "2024-12").status, "NO_DATA");
  }
  assert.equal(gyeonggiPointLink(candidate, [], "2024-12").station, "");
  assert.equal(gyeonggiPointLink(candidate, [point, point], "2024-12").status, "REVIEW_REQUIRED");
  assert.equal(gyeonggiPointLink(null, [point], "2024-12").status, "NO_CANDIDATE");
});

test("reference provenance cannot be mistaken for GITS station measurements", () => {
  const rows = peakConnectionRows({ candidate: { ...candidate, pointCode: "0309-04" }, point, month: "2024-12", link: { status: "NO_DATA", note: "없음" }, reference: true });
  assert.match(rows[0][1], /GITS 추천지점의 교통량이 아님/);
  assert.equal(rows[1][1], "0309-04");
  assert.equal(rows[3][1], "4302-03");
});

test("analysis identity changes with source, address, candidate, month and reference mode", () => {
  const args = { provider: "gyeonggi", address: "경기 수원", candidate, station: point.code, month: "2024-12", reference: false };
  const initial = peakAnalysisIdentity(args);
  for (const changes of [{ provider: "seoul" }, { address: "경기 양평" }, { candidate: { pointCode: "0309-04" } }, { month: "2024-11" }, { reference: true }]) {
    assert.notEqual(peakAnalysisIdentity({ ...args, ...changes }), initial);
  }
});
