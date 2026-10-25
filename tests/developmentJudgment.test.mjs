import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeReflection } from '../lib/judgeReflection.js';
import { normalizeProject } from '../lib/tiaApi.js';
import { formatProjectPeriod } from '../lib/projectPeriod.js';
import { summarizeProjects } from '../lib/tiaScope.js';

// Shapes of real production records (서소문 10지구, 2026-10-25): the MOLIT dataset has no stage column.
const liveRaw = { 사업명: '서소문 10지구 도시정비형 재개발사업 교통영향평가', 사업기간: 48, 사업구분코드명: '복합용도건축물', 위치: '서울특별시 중구 서소문로 100(서소문동)', 조사일: '2022-04-15', 기준년도: 2021 };
const dbRaw = { ...liveRaw, 사업위치: liveRaw.위치, 사업기간: '48', 심의결과: '', 등록일: '2022-04-15' };

test('the same project gets the same verdict from the live API and the stored DB copy', () => {
  const live = judgeReflection(normalizeProject(liveRaw, 0, 'TIA_PROJECT_API'), 100, 2000);
  const stored = judgeReflection(normalizeProject(dbRaw, 0, 'TIA_DB'), 100, 2000);
  assert.equal(live.reflectionStatus, '판정불가');
  assert.equal(stored.reflectionStatus, '판정불가', 'an empty 심의결과 column must not read as 심의');
  assert.match(stored.reflectionReason, /추진단계·심의결과 정보가 없어.*2022-04-15/);
});

test('project names and field names are not treated as stage evidence', () => {
  const project = normalizeProject({ 사업명: '반포아파트 지구단위계획 교통영향평가 착공', 위치: '서울특별시 서초구' }, 0, 'TIA_PROJECT_API');
  assert.equal(judgeReflection(project, 100, 2000).reflectionStatus, '판정불가');
});

test('stage fields still drive the verdict when the source provides them', () => {
  for (const [value, status] of [['착공', '반영'], ['심의완료', '반영검토'], ['계획수립', '참고'], ['준공완료', '제외후보'], ['보류', '참고']]) {
    assert.equal(judgeReflection(normalizeProject({ ...liveRaw, 심의결과: value }, 0, 'TIA_DB'), 100, 2000).reflectionStatus, status, value);
    assert.equal(judgeReflection(normalizeProject({ ...liveRaw, 추진단계: value }, 0, 'X'), 100, 2000).reflectionStatus, status, value);
  }
  assert.equal(judgeReflection({ geocodeStatus: 'failed' }, null, 2000).reflectionStatus, '제외후보');
  assert.equal(judgeReflection({ reviewResult: '착공' }, 3000, 2000).reflectionStatus, '제외후보');
});

test('goal years are kept apart from the project period', () => {
  const system = normalizeProject({ bsnsNm: '복합개발사업', bsnsLc: '충남 당진시', goalYySrtpd: '2028', goalYyLngtr: '2033' }, 0, 'TIA_SYSTEM_API');
  assert.equal(system.projectPeriod, '');
  assert.equal(system.targetYear, '단기 2028 / 장기 2033');
  assert.equal(formatProjectPeriod(system), '목표연도 단기 2028 / 장기 2033');
  assert.equal(formatProjectPeriod(normalizeProject(liveRaw, 0, 'TIA_PROJECT_API')), '48개월(추정)');
  assert.equal(formatProjectPeriod({ projectPeriod: '2022~2026' }), '2022~2026');
  assert.equal(formatProjectPeriod({}), '');
});

test('summary counts unjudged projects separately from 참고', () => {
  const results = ['판정불가', '판정불가', '참고', '반영검토'].map(reflectionStatus => ({ reflectionStatus, withinScope: true }));
  const summary = summarizeProjects(4, results);
  assert.equal(summary.unjudgedCount, 2);
  assert.equal(summary.referenceCount, 1);
});
