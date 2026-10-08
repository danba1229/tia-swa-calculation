import test from 'node:test';
import assert from 'node:assert/strict';
import { signScope, selectSigns, layoutSignLabels } from '../lib/trafficSigns.js';
import { loadSignSnapshot, querySeoulSigns } from '../lib/server/seoulSigns.js';
import { classifySign } from '../lib/signClassification.js';
import { POLICE_SIGN_CODES } from '../lib/policeSignCodes.js';

test('chart number equality never verifies meaning or invents codes for unknown/road signs', () => {
  const base = { id: 'S:one', source: 'S', label: 'one', lat: 37.48, lng: 127.03 };
  assert.equal(POLICE_SIGN_CODES.length, 144);
  for (const code of ['220', '224', '219', '322', '428', '110의2']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, code);
    assert.equal(result.verified, false);
    assert.equal(result.color, '#dc2626');
    assert.equal(result.managementId, 'one');
  }
  for (const code of ['220-1', '110-2', '751', '704', '513', '999', '']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, '?');
    assert.equal(result.policeCode, null);
    assert.equal(result.verified, false);
  }
  assert.equal(classifySign({ ...base, source: 'R', sourceIndex: '219' }).label, '?');
});

test('blue status requires individual evidence bound to this exact source record', () => {
  const point = { id: 'S:one', source: 'S', label: 'one', sourceIndex: '220-1', lat: 37.48, lng: 127.03 };
  // Synthetic review fixture, never included in production review data.
  const review = { sourceIndex: '220-1', lat: 37.48, lng: 127.03, policeCode: '224', evidence: 'TEST FIXTURE: reviewed sign photo', reviewedAt: '2026-10-08' };
  const result = classifySign(point, { 'S:one': review });
  assert.equal(result.verified, true);
  assert.equal(result.color, '#2563eb');
  assert.equal(result.label, '224');
  for (const patch of [{ id: 'S:another' }, { lat: 37.49 }, { lng: 127.04 }, { sourceIndex: '220' }, { source: 'R' }]) assert.equal(classifySign({ ...point, ...patch }, { 'S:one': review }).verified, false);
  for (const patch of [{ evidence: '' }, { reviewedAt: '' }, { policeCode: '751' }]) assert.equal(classifySign(point, { 'S:one': { ...review, ...patch } }).verified, false);
});

test('Seocho example remains 119 unverified points, with 95 chart candidates and 24 unknowns', async () => {
  const result = await querySeoulSigns({ lat: 37.483625, lng: 127.032683, width: 500, height: 500 });
  const classified = result.points.map(p => classifySign(p));
  assert.equal(classified.length, 119);
  assert.equal(classified.filter(p => p.verified).length, 0);
  assert.equal(classified.filter(p => p.policeCode).length, 95);
  assert.equal(classified.filter(p => p.label === '?').length, 24);
});

test('labels avoid reserved legend area without discarding any points', () => {
  const points = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: '219', number: i, x: 610 + i * 8, y: 370 + i * 5 }));
  const legend = { x: 664, y: 354, w: 228, h: 222 };
  const result = layoutSignLabels(points, 900, 600, '0', [legend]);
  assert.equal(result.points.length, points.length);
  assert.ok(result.labels.length > 0);
  for (const { box: b } of result.labels) assert.ok(b.x + b.w <= legend.x || b.x >= legend.x + legend.w || b.y + b.h <= legend.y || b.y >= legend.y + legend.h);
});

test('sign scope rejects missing, non-finite, oversized and non-Seoul coordinates', () => {
  const input = { lat: 37.48, lng: 127.03, width: 500, height: 800 };
  for (const patch of [{ lat: '' }, { lng: null }, { width: 0 }, { height: 10001 }, { lat: 35.1 }, { width: Infinity }]) assert.throws(() => signScope({ ...input, ...patch }));
  const scope = signScope(input);
  assert.ok(Math.abs((scope.north - scope.south) * 111320 - 800) < 1e-6);
  assert.ok(Math.abs((scope.east - scope.west) * 111320 * Math.cos(input.lat * Math.PI / 180) - 500) < 1e-6);
});

test('rectangular selection includes edges, preserves official identifiers and deterministically sorts', () => {
  const scope = { north: 2, south: 1, west: 1, east: 2 };
  const a = ['S:04-0000000001', 2, 1, '322', '', '001'];
  const b = ['R:공식-서울-1', 1, 2, '3방향표지', '', ''];
  const outside = ['S:outside', 2.000001, 1, '', '', ''];
  const result = selectSigns([b, outside, a], scope);
  assert.deepEqual(result.map(p => p.label), ['04-0000000001', '공식-서울-1']);
  assert.deepEqual(result, selectSigns([a, outside, b], scope));
  assert.throws(() => selectSigns([a, b], scope, 1), /범위를 줄여/);
});

test('official snapshot counts reconcile, identifiers unique and coordinates valid', async () => {
  const { rows, manifest } = await loadSignSnapshot();
  assert.equal(rows.length, 232095);
  assert.equal(new Set(rows.map(r => r[0])).size, rows.length);
  assert.ok(rows.every(r => Number.isFinite(r[1]) && Number.isFinite(r[2])));
  assert.equal(manifest.sources[0].rawCount - 720 - 20, manifest.counts.S);
  assert.equal(manifest.sources[1].rawCount - 8 - 4, manifest.counts.R);
  const result = await querySeoulSigns({ lat: 37.483, lng: 127.034, width: 500, height: 500 });
  assert.ok(result.points.length > 0);
  assert.ok(result.points.every(p => p.lat >= result.scope.south && p.lat <= result.scope.north && p.lng >= result.scope.west && p.lng <= result.scope.east));
});

test('callouts retain real point locations and never overlap or clip official labels', () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ id: `S:${i}`, label: `04-${String(i).padStart(10, '0')}`, number: i + 1, x: 250 + i % 3, y: 230 + i % 5 }));
  const original = structuredClone(points);
  const { labels, points: visible } = layoutSignLabels(points, 900, 600, 'S:39');
  assert.deepEqual(points, original);
  assert.equal(visible.length, 40);
  assert.equal(labels[0].id, 'S:39', 'Selected coincident point receives priority');
  assert.ok(labels.length > 0 && labels.length < points.length, 'Dense points remain while labels are selectively shown');
  for (const p of labels) {
    assert.ok(p.box.x >= 8 && p.box.x + p.box.w <= 858 && p.box.y >= 8 && p.box.y + p.box.h <= 564);
    for (const q of labels) if (p !== q) assert.ok(p.box.x + p.box.w <= q.box.x || q.box.x + q.box.w <= p.box.x || p.box.y + p.box.h <= q.box.y || q.box.y + q.box.h <= p.box.y);
  }
});
