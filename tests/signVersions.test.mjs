import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleSigns } from '../lib/signClassification.js';
import { querySeoulSigns } from '../lib/server/seoulSigns.js';

test('Seoul mode preserves raw codes and every record without leaking police mappings or exclusions', () => {
  const points = ['220-1', '415', '751', '427', '', '309-2'].map((sourceIndex, i) => ({
    id: `S:${i}`, label: `관리-${i}`, source: 'S', sourceIndex, sourceRemark: '원본 비고', lat: 37.5, lng: 127,
  }));
  points.push({ id: 'R:one', label: '도로관리번호', source: 'R', sourceIndex: '3방향표지', sourceRemark: '' });
  const original = structuredClone(points);
  const police = visibleSigns(points);
  assert.equal(police.length, 4);
  const seoul = visibleSigns(points, 'seoul');
  assert.equal(seoul.length, points.length);
  for (let i = 0; i < points.length; i++) {
    assert.equal(seoul[i].label, points[i].sourceIndex || '?');
    assert.equal(seoul[i].managementId, points[i].label);
    assert.equal(seoul[i].sourceRemark, points[i].sourceRemark);
    assert.equal(seoul[i].ignored, false);
    assert.equal(seoul[i].mappingBasis, 'source');
    assert.deepEqual(seoul[i].policeCodes, []);
  }
  assert.deepEqual(visibleSigns(points, 'police'), police);
  assert.deepEqual(points, original);
});

test('Seocho versions share the same scope and record coordinates while applying independent display policies', async () => {
  const result = await querySeoulSigns({ lat: 37.483625, lng: 127.032683, width: 500, height: 500 });
  const before = structuredClone(result);
  const seoul = visibleSigns(result.points, 'seoul'), police = visibleSigns(result.points, 'police');
  assert.equal(seoul.length, 119);
  assert.equal(police.length, 101);
  assert.ok(seoul.some(p => p.label === '751'));
  assert.ok(seoul.some(p => p.label === '220-1'));
  assert.ok(police.some(p => p.sourceIndex === '220-1' && p.label === '224'));
  for (const p of police) {
    const raw = seoul.find(s => s.id === p.id);
    assert.deepEqual([raw.lat, raw.lng, raw.sourceRemark, raw.managementId], [p.lat, p.lng, p.sourceRemark, p.managementId]);
  }
  assert.deepEqual(result, before);
});
