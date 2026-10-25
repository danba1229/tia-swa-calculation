import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDUSE_OTHER_CATEGORIES, LANDUSE_OTHER_NOTE, ZONING_SOURCE_NOTE } from '../lib/landuseNotes.js';

// 2025 서초통계연보 「토지지목별 현황」 2024년 (㎡, 자료: 토지관리과).
const seocho2024 = {
  전: 2171230, 답: 1543487, 과수원: 8018, 목장용지: 388, 임야: 17814903, 대: 13132852, 철도용지: 2338, 제방: 206282,
  하천: 2491084, 구거: 276588, 유지: 85537, 수도용지: 73672, 공원: 1057796, 공장용지: 0, 학교용지: 910065, 주차장: 35684,
  주유소용지: 56712, 창고용지: 7540, 도로: 6310354, 체육용지: 4065, 유원지: 6336, 종교용지: 36362, 사적지: 0, 묘지: 16854, 잡종지: 717474,
};

test('기타 lists the 20 cadastral categories outside the eight reported ones', () => {
  const reported = ['전', '답', '임야', '대', '도로', '하천', '학교용지', '공원'];
  assert.equal(LANDUSE_OTHER_CATEGORIES.length + reported.length, 28);
  assert.equal(new Set([...LANDUSE_OTHER_CATEGORIES, ...reported]).size, 28);
  for (const name of Object.keys(seocho2024)) assert.ok(reported.includes(name) || LANDUSE_OTHER_CATEGORIES.includes(name), name);
  assert.match(LANDUSE_OTHER_NOTE, /잡종지/);
});

test('the listed categories add up to the app 기타 for 서초구 2024', () => {
  const other = LANDUSE_OTHER_CATEGORIES.reduce((sum, name) => sum + (seocho2024[name] || 0), 0);
  // App (KOSIS) 기타 for 서초구 2024 = 1,533,850.3㎡; the yearbook rounds to whole ㎡.
  assert.equal(other, 1533850);
  const total = Object.values(seocho2024).reduce((a, b) => a + b, 0);
  assert.equal(total, 46965621);
});

test('the zoning note names KOSIS and warns that district yearbooks can differ', () => {
  assert.match(ZONING_SOURCE_NOTE, /KOSIS 도시계획현황/);
  assert.match(ZONING_SOURCE_NOTE, /통계연보.*다를 수 있습니다/);
});
