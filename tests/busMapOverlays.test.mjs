import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { visibleBusStops, busStopMapDetails, createBusStopLayer, clearBusStopOverlays } from "../lib/busMapOverlays.js";

const bounds = { south: 37.48, north: 37.50, west: 127.02, east: 127.04 };
const stop = { id: "1", stationId: "1", stationName: "서초구청", arsId: "01001", latitude: 37.49, longitude: 127.03,
  distanceMeters: 584.4, routes: [{ routeName: "470" }, { routeName: "N37" }], sourceDate: "2026-09-30" };

test("only in-scope stops with actual coordinates are shown; distinct opposite-side stops remain", () => {
  const rows = [stop, { ...stop }, { ...stop, id: "2", stationId: "2" }, { ...stop, stationId: "3", latitude: null },
    { ...stop, stationId: "4", longitude: "" }, { ...stop, stationId: "5", latitude: 37.51 }, { ...stop, stationId: "6", latitude: "37.48" }];
  assert.deepEqual(visibleBusStops(rows, bounds).map((row) => row.stationId), ["1", "2", "6"]);
  assert.deepEqual(visibleBusStops(rows, null), []);
  assert.deepEqual(visibleBusStops(rows, { ...bounds, north: NaN }), []);
});

test("details preserve ARS leading zeros, distinguish missing distance from zero and deduplicate routes", () => {
  assert.equal(busStopMapDetails(stop).number, "01001");
  assert.equal(busStopMapDetails({ ...stop, arsId: 1001 }).number, "01001");
  assert.equal(busStopMapDetails({ ...stop, arsId: "00000" }).number, "미제공");
  assert.equal(busStopMapDetails({ ...stop, distanceMeters: null }).distance, "거리 미확인");
  assert.equal(busStopMapDetails({ ...stop, distanceMeters: 0 }).distance, "0 m (직선거리)");
  assert.equal(busStopMapDetails({ ...stop, routes: [{ routeName: "470" }, { routeName: "470" }] }).routes, "470");
  assert.match(busStopMapDetails({ ...stop, routes: [] }).routes, /미제공/);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
}
function fixture() {
  const overlays = [];
  class CustomOverlay {
    constructor(options) { Object.assign(this, options); overlays.push(this); }
    setMap(map) { this.map = map; }
    setZIndex(value) { this.zIndex = value; }
  }
  return { overlays, maps: { CustomOverlay, LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } } },
    ownerDocument: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) } };
}

test("markers show safe text, support click and focus, and remove all handlers on toggle/reset", () => {
  const f = fixture(), selected = [];
  const hostile = { ...stop, stationName: '<img src=x onerror="alert(1)">' };
  const layer = createBusStopLayer({ ...f, map: {}, stops: [hostile], bounds, onSelect: (row) => selected.push(row) });
  assert.equal(layer.count, 1);
  const overlay = f.overlays[0], button = overlay.content.children[0], tooltip = overlay.content.children[1];
  assert.equal(tooltip.textContent, hostile.stationName);
  assert.equal(tooltip.innerHTML, undefined);
  assert.equal(button.tag, "button");
  assert.equal(button.attributes["aria-controls"], "selected-bus-stop-info");
  button.listeners.get("focus")();
  assert.equal(overlay.zIndex, 6);
  let stopped = false;
  button.listeners.get("click")({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(selected, [hostile]);
  const runtimeRef = { current: { busStopLayer: layer, bikeStationOverlays: ["preserved"] } };
  clearBusStopOverlays(runtimeRef);
  assert.equal(overlay.map, null);
  assert.equal(button.listeners.size, 0);
  assert.equal(runtimeRef.current.busStopLayer, null);
  assert.deepEqual(runtimeRef.current.bikeStationOverlays, ["preserved"]);
  clearBusStopOverlays(runtimeRef);
});

test("recreating a bus layer after map creation or checkbox toggle does not retain old markers", () => {
  const f = fixture(), runtimeRef = { current: {} };
  for (let i = 0; i < 3; i++) {
    clearBusStopOverlays(runtimeRef);
    runtimeRef.current.busStopLayer = createBusStopLayer({ ...f, map: {}, stops: [stop], bounds, onSelect: () => {} });
    assert.equal(f.overlays.filter((overlay) => overlay.map).length, 1);
  }
  clearBusStopOverlays(runtimeRef);
  assert.equal(f.overlays.filter((overlay) => overlay.map).length, 0);
});

test("map-wide cleanup also removes buses and scope, preserving unrelated runtime state", () => {
  const component = readFileSync(new URL("../components/TiaResearchBuilder.jsx", import.meta.url), "utf8");
  const source = component.slice(component.indexOf("function clearMapOverlays("), component.indexOf("function clearBikeStationOverlays("));
  let removed = false;
  const context = vm.createContext({ clearBusStopOverlays, clearSurveyCandidateOverlays: () => {}, clearBikeStationOverlays: () => {} });
  vm.runInContext(source, context);
  const runtime = { current: { busScope: bounds, scopeBounds: {}, map: "keep", busStopLayer: { destroy: () => { removed = true; } } } };
  context.clearMapOverlays(runtime);
  assert.equal(removed, true);
  assert.equal(runtime.current.busScope, null);
  assert.equal(runtime.current.map, "keep");
  assert.match(component, /\[busStops, showBusStopsOnMap, mapRevision\]/);
  assert.match(component, /setMapRevision\(\(revision\) => revision \+ 1\)/);
});
