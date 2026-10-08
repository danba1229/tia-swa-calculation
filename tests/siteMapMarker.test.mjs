import test from "node:test";
import assert from "node:assert/strict";
import { createSiteMapMarker } from "../lib/siteMapMarker.js";

test("site marker is a centered dot without an address balloon", () => {
  const map = {};
  const position = {};
  class CustomOverlay {
    constructor(options) { this.options = options; }
    setMap(nextMap) { this.options.map = nextMap; }
  }
  const marker = createSiteMapMarker({ CustomOverlay }, map, position);
  assert.equal(marker.options.map, map);
  assert.equal(marker.options.position, position);
  assert.equal(marker.options.xAnchor, 0.5);
  assert.equal(marker.options.yAnchor, 0.5);
  assert.match(marker.options.content, /class="site-center-dot"/);
  assert.match(marker.options.content, /role="img" aria-label=".+"/);
  assert.match(marker.options.content, /></);
  assert.doesNotMatch(marker.options.content, /title=|<div|<p/);
  marker.setMap(null);
  assert.equal(marker.options.map, null);
});
