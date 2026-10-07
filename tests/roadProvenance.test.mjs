import test from 'node:test';
import assert from 'node:assert/strict';
import { roadProvenance, roadRetrievedDate, roadDateSummary, roadEndpointSummary, roadWidthSummary } from '../lib/roadProvenance.js';

test('missing road source date is never inferred from retrieval time', () => {
  const row = roadProvenance({ retrievedAt: '2026-10-06T15:30:00Z' });
  assert.equal(row.sourceReferenceDate, '');
  assert.equal(roadDateSummary(row), '자료 기준일: 미확인 / 조회일: 2026-10-07');
});

test('source date precision and original reference date survive draft JSON', () => {
  for (const sourceReferenceDate of ['2023', '2023-09', '2023-09-18']) {
    const row = JSON.parse(JSON.stringify(roadProvenance({ sourceReferenceDate, retrievedAt: '2026-10-07T00:00:00Z' })));
    assert.equal(row.sourceReferenceDate, sourceReferenceDate);
    assert.match(roadDateSummary(row), new RegExp(`자료 기준일: ${sourceReferenceDate}`));
  }
});

test('legacy, manually added and invalid retrieval dates stay unknown', () => {
  assert.equal(roadDateSummary({ name: '기존 도로' }), '자료 기준일: 미확인 / 조회일: 조회일 미기록');
  for (const value of [undefined, null, '', 'invalid', 0]) assert.equal(roadRetrievedDate(value), '조회일 미기록');
  assert.equal(roadProvenance().retrievedAt, '');
});

test('road name metadata never becomes endpoint or width evidence', () => {
  const row = roadProvenance({ source: '카카오', sourceReferenceDate: '2026-09', retrievedAt: '2026-10-07T00:00:00Z' });
  assert.equal(row.endpointReferenceDate, '');
  assert.equal(row.widthReferenceDate, '');
  assert.match(roadEndpointSummary(row), /기종점 출처: 미확인/);
  assert.match(roadEndpointSummary(row), /기점: 수동 조사필요/);
  assert.match(roadWidthSummary(row), /전체폭\(보도 포함\): 수동 조사필요/);
  assert.match(roadWidthSummary(row), /차도폭: 수동 조사필요/);
  assert.doesNotMatch(roadEndpointSummary(row), /카카오|2026-09/);
});

test('manual endpoints and both widths retain separate evidence through JSON backup', () => {
  const row = JSON.parse(JSON.stringify(roadProvenance({
    startAddress: '시점 원문', endAddress: '종점 원문',
    endpointSource: '도로명 고시', endpointReferenceDate: '2024',
    totalWidth: '20~25', carriagewayWidth: '14',
    widthSource: '현장조사 구간 A', widthReferenceDate: '2026-10',
  })));
  assert.match(roadEndpointSummary(row), /시점 원문/);
  assert.match(roadEndpointSummary(row), /기종점 자료 기준일: 2024/);
  assert.match(roadEndpointSummary(row), /자동검증 미수행/);
  assert.match(roadWidthSummary(row), /20~25m \(수동 입력값\)/);
  assert.match(roadWidthSummary(row), /차도폭: 14m/);
  assert.match(roadWidthSummary(row), /폭원 자료 기준일: 2026-10/);
});

test('legacy values are not silently certified and missing widths never become zero', () => {
  assert.match(roadEndpointSummary({ startAddress: '이전 입력' }), /자동검증 미수행/);
  for (const totalWidth of [undefined, null, '', '  ']) {
    assert.match(roadWidthSummary({ totalWidth }), /전체폭\(보도 포함\): 수동 조사필요/);
    assert.doesNotMatch(roadWidthSummary({ totalWidth }), /0m/);
  }
});
