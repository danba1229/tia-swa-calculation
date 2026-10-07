import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validPointPosition, surveyMapPoints, referenceSearchQueries, referenceLocationChoices, createSurveyPointLayer, arrangeSurveyLabels } from "../lib/surveyPointMap.js";

const candidate = { pointCode: "0309-04", routeCode: "309", routeName: "지방도 309호선", sectionName: "사사 - 경기도청", lat: 37.28, lng: 127.02, sourceYear: "2024" };
const reference = { code: "4302-03", name: "일반국도 43호선 · 경기 화성 봉담읍 · 안녕IC분기" };

test("map retains source codes, recommendation rank and separate reference identity", () => {
  const rows = surveyMapPoints("gyeonggi", [], [{ ...candidate, lat: null }, candidate], { ...reference, lat: 37.2, lng: 126.98 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rank, 2);
  assert.equal(rows[0].code, "0309-04");
  assert.equal(rows[0].approximate, true);
  assert.match(rows[0].note, /공식 측정 좌표 아님/);
  assert.equal(rows[1].kind, "reference");
  assert.equal(rows[1].code, "4302-03");
  assert.equal(surveyMapPoints("seoul", [], [], { ...reference, lat: 37.2, lng: 126.98 }).length, 0);
});

test("missing, invalid and unresolved positions never become zero or project coordinates", () => {
  for (const p of [{ lat: null, lng: 127 }, { lat: "", lng: 127 }, { lat: "37", lng: 127 }, { lat: NaN, lng: 127 }, { lat: 0, lng: 0 }, { lat: 37, lng: 0 }]) assert.equal(validPointPosition(p), false);
  assert.deepEqual(surveyMapPoints("gyeonggi", [], [{ ...candidate, locationResolved: false }], reference), []);
});

test("reference queries use its source locality, not GITS or project locality", () => {
  assert.deepEqual(referenceSearchQueries(reference), ["경기 화성 봉담읍 안녕IC분기", "경기 화성 봉담읍 안녕IC"]);
  assert.deepEqual(referenceSearchQueries({ name: "일반국도 43호선 · 경기 화성 봉담읍" }), []);
  const place = { id: "1", address_name: "경기 화성시 봉담읍 수영리", place_name: "안녕IC", x: "126.98", y: "37.2" };
  const rows = referenceLocationChoices(reference, [place, place, { ...place, id: "2", address_name: "충북 괴산군" }, { ...place, id: "3", address_name: "경기 수원시" }, { ...place, id: "4", x: "" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matchedName, "안녕IC");
  assert.equal(rows[0].lng, 126.98);
});

test("map layer safe text, click details, and repeated cleanup do not duplicate markers", () => {
  const overlays = [];
  const maps = { LatLng: class { constructor(lat, lng) { Object.assign(this, { lat, lng }); } }, CustomOverlay: class {
    constructor(options) { Object.assign(this, options); overlays.push(this); }
    setMap(map) { this.map = map; }
  }, Marker: class { constructor(options) { Object.assign(this, options); } setMap(map) { this.map = map; } }, event: { addListener() {}, removeListener() {} } };
  const ownerDocument = { createElement: () => ({ style: {}, getBoundingClientRect: () => ({ left: 0, right: 140, top: 100, bottom: 134, height: 34 }), attributes: {}, listeners: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; }, removeEventListener(k) { delete this.listeners[k]; } }) };
  let selected;
  const point = surveyMapPoints("gyeonggi", [], [{ ...candidate, pointCode: "<img>" }])[0];
  const layer = createSurveyPointLayer({ maps, map: {}, points: [point], onSelect: (p) => { selected = p; }, ownerDocument });
  const button = overlays[0].content;
  assert.match(button.textContent, /<img>/);
  assert.equal(button.innerHTML, undefined);
  button.listeners.click({ stopPropagation() {} });
  assert.equal(selected, point);
  layer.destroy(); layer.destroy();
  assert.equal(overlays[0].map, null);
  assert.deepEqual(button.listeners, {});
});

test("overlapping label offsets are deterministic and reset after map zoom", () => {
  const buttons = [0, 0, 20].map(y => ({ style: {}, getBoundingClientRect: () => ({ left: 0, right: 140, top: 100 + y, bottom: 134 + y, height: 34 }) }));
  arrangeSurveyLabels(buttons);
  assert.deepEqual(buttons.map(b => b.style.transform), ["", "translateY(-42px)", "translateY(42px)"]);
  arrangeSurveyLabels(buttons);
  assert.equal(buttons[1].style.transform, "translateY(-42px)");
  arrangeSurveyLabels(buttons, { top: 90, bottom: 400 });
  assert.deepEqual(buttons.map(b => b.style.transform), ["", "translateY(42px)", "translateY(84px)"]);
});

test("map recreation, visibility and reference identity trigger layer resync", () => {
  const source = readFileSync(new URL("../components/TiaResearchBuilder.jsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("syncSurveyCandidateOverlays({"), source.indexOf("function updateBasics"));
  for (const dependency of ["mapRevision", "showSurveyPointsOnMap", "referencePosition", "peakMapKey"]) assert.ok(effect.includes(dependency));
  assert.match(source, /referencePosition\?\.key === peakMapKey/);
  assert.match(source, /if \(!cancelled\) setReferenceSearch/);
});
