import test from 'node:test';
import assert from 'node:assert/strict';
import { signScope, selectSigns, layoutSignLabels } from '../lib/trafficSigns.js';
import { loadSignSnapshot, querySeoulSigns } from '../lib/server/seoulSigns.js';
import { classifySign, signRoadviewUrl, visibleSigns } from '../lib/signClassification.js';
import { POLICE_SIGN_CODES } from '../lib/policeSignCodes.js';
import { SEOUL_SIGN_CODE_MAPPINGS } from '../lib/seoulSignCodeMappings.js';

test('sixteen user-approved codes map regardless of remarks while retaining original records', () => {
  const expected = {
    '205-2': '205의2', '206-2': '206의2', '309-2': '309의2', '320-2': '320의2',
    '320-3': '320의3', '320-4': '320의4', '321-2': '321의2', '415-2': '415의2',
    '220-1': '224', '220-2': '224', '220-3': '224', '220-4': '224',
    '220-5': '224', '220-6': '224', '220-7': '224', '220-8': '224',
  };
  assert.deepEqual(SEOUL_SIGN_CODE_MAPPINGS, expected);
  for (const [code, target] of Object.entries(expected)) {
    for (const remark of ['', '30', '40', '직진및유턴', '보행자주의', '소방차 출동시']) {
      const point = { id: 'S:one', source: 'S', label: 'one', sourceIndex: code, lat: 37.48, lng: 127.03, remark };
      const original = structuredClone(point);
      const result = classifySign(point);
      assert.equal(result.label, target);
      assert.equal(result.policeCode, target);
      assert.ok(POLICE_SIGN_CODES.includes(target));
      assert.equal(result.mappingBasis, 'user');
      assert.match(result.reason, /사용자 지정 매핑.*추가 확인/);
      assert.equal(result.sourceIndex, code);
      assert.ok(result.sourceCodeRemark.endsWith(code));
      assert.equal(result.managementId, 'one');
      assert.equal(result.color, '#2563eb');
      assert.equal(result.roadviewUrl, 'https://map.kakao.com/link/roadview/37.48,127.03');
      assert.deepEqual(point, original);
      assert.equal(classifySign({ ...point, source: 'R' }).policeCode, null);
    }
  }
});

test('user mapping changes exactly 10213 existing safety records and leaves other codes alone', async () => {
  const { rows } = await loadSignSnapshot();
  let mapped = 0, speedMapped = 0;
  for (const [id, lat, lng, sourceIndex] of rows) {
    const source = id.slice(0, 1);
    const result = classifySign({ id, source, label: id.slice(2), lat, lng, sourceIndex });
    if (Object.hasOwn(SEOUL_SIGN_CODE_MAPPINGS, sourceIndex) && source === 'S') {
      mapped++;
      if (result.policeCode === '224') speedMapped++;
    }
    else assert.equal(result.policeCode, source === 'S' && POLICE_SIGN_CODES.includes(sourceIndex) ? sourceIndex : null);
  }
  assert.equal(mapped, 10213);
  assert.equal(speedMapped, 9860);
});

test('chart number equality never verifies meaning or invents codes for unknown/road signs', () => {
  const base = { id: 'S:one', source: 'S', label: 'one', lat: 37.48, lng: 127.03 };
  assert.equal(POLICE_SIGN_CODES.length, 144);
  for (const code of ['220', '224', '219', '322', '428', '110의2']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, code);
    assert.equal(result.color, '#2563eb');
    assert.equal(result.managementId, 'one');
  }
  for (const code of ['220-0', '220-9', '220-10', '110-2', '309-3', '415-3', '751', '704', '513', '999', '', 'toString', '__proto__']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, '?');
    assert.equal(result.policeCode, null);
  }
  assert.equal(classifySign({ ...base, source: 'R', sourceIndex: '219' }).label, '?');
});

test('Seoul codes remain verbatim in notes and every source uses the same color', () => {
  for (const [source, code] of [['S', '220-1'], ['S', '751'], ['S', '219'], ['R', '3방향표지']]) {
    const point = { id: `${source}:one`, source, label: 'one', sourceIndex: code, lat: 37.48, lng: 127.03 };
    const result = classifySign(point);
    assert.equal(result.sourceIndex, code);
    assert.ok(result.sourceCodeRemark.endsWith(code));
    assert.equal(result.color, '#2563eb');
    assert.equal(result.roadviewUrl, 'https://map.kakao.com/link/roadview/37.48,127.03');
    assert.equal(result.managementId, 'one');
    assert.equal(Object.hasOwn(result, 'verified'), false, 'Color does not communicate verification');
  }
});

test('roadview links use latitude then longitude and reject absent or invalid coordinates', () => {
  assert.equal(signRoadviewUrl({ lat: 37.483625, lng: 127.032683 }), 'https://map.kakao.com/link/roadview/37.483625,127.032683');
  for (const patch of [{ lat: null }, { lat: '' }, { lng: undefined }, { lng: ' ' }, { lat: Infinity }, { lng: 'javascript:bad' }, { lat: 91 }, { lng: 181 }]) assert.equal(signRoadviewUrl({ lat: 37.48, lng: 127.03, ...patch }), null);
});

test('Seocho display excludes 704 and maps the actual 751 remark without guessing composites', async () => {
  const result = await querySeoulSigns({ lat: 37.483625, lng: 127.032683, width: 500, height: 500 });
  assert.equal(result.points.length, 119);
  const classified = visibleSigns(result.points);
  assert.equal(classified.length, 118);
  assert.ok(classified.every(p => p.color === '#2563eb'));
  assert.ok(classified.every(p => p.sourceCodeRemark.includes(p.sourceIndex)));
  assert.equal(classified.filter(p => p.mappingBasis === 'code-match').length, 95);
  const mapped = classified.filter(p => p.mappingBasis === 'user');
  assert.equal(mapped.length, 6);
  assert.equal(mapped.filter(p => p.sourceIndex === '220-1' && p.policeCode === '224').length, 5);
  assert.equal(mapped.find(p => p.sourceIndex === '751').sourceRemark, '30/LED');
  assert.equal(classified.filter(p => p.policeCode).length, 101);
  assert.equal(classified.filter(p => p.label === '?').length, 17);
});

test('751 remark rules retain multi-code releases and ignore only LED installation notation', () => {
  const base = { source: 'S', sourceIndex: '751', label: 'one', lat: 37.5, lng: 127 };
  for (const [sourceRemark, codes] of [
    ['30', ['224']], ['30/LED', ['224']], ['30 / LED', ['224']],
    ['30 해제', ['224', '427']], ['30해제 / LED', ['224', '427']],
    ['여기부터 속도를 줄이시오', ['415']], ['여기부터 속도를줄이시오 / LED', ['415']],
    ['어린이보호구역 해제', ['324', '427']],
  ]) {
    const result = classifySign({ ...base, sourceRemark });
    assert.deepEqual(result.policeCodes, codes);
    assert.equal(result.label, codes.join(', '));
    assert.equal(result.ignored, false);
    assert.equal(result.sourceRemark, sourceRemark);
    assert.equal(result.mappingBasis, 'user');
  }
  for (const sourceRemark of ['LED', ' led / ']) assert.equal(visibleSigns([{ ...base, sourceRemark }]).length, 0);
  for (const sourceRemark of ['', '40', '우회전시', '어린이보호구역/30', '어린이보호구역해제/30해제', '30 주의']) {
    const result = classifySign({ ...base, sourceRemark });
    assert.equal(result.label, '?');
    assert.equal(result.ignored, false);
  }
  assert.equal(classifySign({ ...base, source: 'R', sourceRemark: '30 해제' }).label, '?');
});

test('ignored source codes are removed from display only, not raw records or other sources', () => {
  const points = ['704', '750', '232', '712-1', '751'].map(sourceIndex => ({ source: 'S', sourceIndex, label: sourceIndex }));
  const original = structuredClone(points);
  assert.deepEqual(visibleSigns(points).map(p => p.sourceIndex), ['751']);
  assert.deepEqual(points, original);
  assert.equal(visibleSigns(points.map(p => ({ ...p, source: 'R' }))).length, 5);
});

test('751 raw remark ingestion reconciles all records with exact mapping and exclusion totals', async () => {
  const { rows } = await loadSignSnapshot();
  const counts = {};
  for (const [id, lat, lng, sourceIndex, , , sourceRemark] of rows) {
    if (id[0] !== 'S' || sourceIndex !== '751') continue;
    const p = classifySign({ source: 'S', sourceIndex, sourceRemark, lat, lng });
    const key = p.ignored ? 'ignored' : p.label;
    counts[key] = (counts[key] || 0) + 1;
  }
  assert.deepEqual(counts, { '224': 3440, '415': 1505, '224, 427': 1027, '324, 427': 414, ignored: 640, '?': 14522 });
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
