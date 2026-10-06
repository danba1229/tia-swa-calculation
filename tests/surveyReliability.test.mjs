import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTiaBusinessPeriod } from '../lib/tiaBusinessSync.js';
import { assessStoredCoverage, mergeStoredAndLive } from '../lib/tiaCoverage.js';
import { judgeReflection } from '../lib/judgeReflection.js';
import { kosisAreaM2, verifyKosisRows } from '../lib/kosisArea.js';
import { guardedAccidentSurvey } from '../lib/accidentGuard.js';
import { readDraft, writeDraft, validateDraftBackup } from '../lib/draftStorage.js';
import { investigationStates } from '../lib/surveyStatus.js';

test('review completion is not construction completion', () => {
  for (const reviewResult of ['심의완료', '교통영향평가 심의완료']) assert.equal(judgeReflection({ reviewResult }, 100, 1000).reflectionStatus, '반영검토');
  assert.equal(judgeReflection({ reviewResult: '준공완료' }, 100, 1000).reflectionStatus, '제외후보');
  assert.notEqual(judgeReflection({ reviewResult: '준공완료 예정' }, 100, 1000).reflectionStatus, '제외후보');
});

test('sync retries missing pages and never marks partial, duplicate or unknown totals complete', async () => {
  const original = globalThis.fetch, names = ['DATA_GO_KR_SERVICE_KEY', 'TIA_SYSTEM_API_BASE_URL', 'TIA_SYSTEM_API_OPERATION_PATH'];
  const old = names.map(n => process.env[n]);
  process.env.DATA_GO_KR_SERVICE_KEY = 'test'; process.env.TIA_SYSTEM_API_BASE_URL = 'https://example.invalid/'; process.env.TIA_SYSTEM_API_OPERATION_PATH = 'businessSearch';
  try {
    for (const mode of ['missing', 'retry', 'duplicate', 'unknown', 'valid']) {
      const calls = new Map();
      globalThis.fetch = async url => {
        const page = Number(new URL(url).searchParams.get('pageNo')); calls.set(page, (calls.get(page) || 0) + 1);
        if (page === 2 && (mode === 'missing' || (mode === 'retry' && calls.get(page) === 1))) throw new Error('timeout');
        return Response.json({ totalCount: mode === 'unknown' ? null : 3, items: [{ bsnsNo: String(mode === 'duplicate' ? 1 : page), bsnsNm: 'sample' }] });
      };
      const result = await collectTiaBusinessPeriod({ startDate: '2026-10-01', endDate: '2026-10-31' });
      assert.equal(result.complete, ['retry', 'valid'].includes(mode), mode);
      if (mode === 'missing') { assert.deepEqual(result.failedPages, [2]); assert.equal(calls.get(2), 2); }
    }
  } finally { globalThis.fetch = original; names.forEach((n, i) => { if (old[i] == null) delete process.env[n]; else process.env[n] = old[i]; }); }
});

test('stored coverage needs new collector, freshness and every requested day', () => {
  const now = Date.parse('2026-10-06T01:00:00Z'), criteria = { startYear: 2026, endYear: 2026 };
  const row = { collector_version: 2, complete: true, status: 'SUCCESS', start_date: '2026-01-01', end_date: '2026-10-31', synced_at: '2026-10-06T00:00:00Z' };
  assert.equal(assessStoredCoverage([row], criteria, now), true);
  for (const patch of [{ start_date: '2026-02-01' }, { collector_version: 1 }, { complete: false }, { synced_at: '2026-09-01' }]) assert.equal(assessStoredCoverage([{ ...row, ...patch }], criteria, now), false);
  assert.deepEqual(mergeStoredAndLive([{ id: '1', reviewResult: 'old' }], [{ id: '1', reviewResult: 'new' }, { id: '2' }]), [{ id: '1', reviewResult: 'new' }, { id: '2' }]);
});

test('KOSIS units, year and administration are verified before report mapping', () => {
  for (const [unit, factor] of [['㎡', 1], ['천㎡', 1000], ['km²', 1000000], ['ha', 10000]]) assert.equal(kosisAreaM2({ DT: '1.25', UNIT_NM: unit }), 1.25 * factor);
  assert.equal(kosisAreaM2({ DT: '-' }), null);
  assert.equal(kosisAreaM2({ DT: '0', UNIT_NM: 'm2' }), 0);
  assert.throws(() => kosisAreaM2({ DT: '12' }), /단위/);
  assert.equal(kosisAreaM2({ DT: '12', UNIT_NM: '㎡필지', ITM_ID: '13103874596T1', ITM_NM: '면적' }), 12);
  assert.throws(() => kosisAreaM2({ DT: '12', UNIT_NM: '㎡필지', ITM_ID: 'other', ITM_NM: '필지' }), /단위/);
  const row = { PRD_DE: '2024', C2: 'region', DT: '2', UNIT_NM: '천㎡' };
  const options = { year: 2024, regionField: 'C2', regionCode: 'region' };
  assert.equal(verifyKosisRows([row], options)[0].conversion.m2, 2000);
  assert.throws(() => verifyKosisRows([{ ...row, PRD_DE: '2023' }], options), /연도/);
  assert.throws(() => verifyKosisRows([{ ...row, C2: 'other' }], options), /행정구역/);
});

test('accident guard serializes workers, caches success and releases failed jobs', async () => {
  let locked = false, permits = 0, releases = 0, loads = 0;
  const cache = new Map(), store = { read: async k => cache.get(k), permit: async () => permits++,
    claim: async () => { if (locked) return false; locked = true; return true; },
    save: async (k,v) => cache.set(k,v), release: async () => { locked = false; releases++; } };
  const request = new Request('https://example.org/api/accidents/radius');
  let finish;
  const pending = guardedAccidentSurvey(request, 'radius', { year: 2024 }, async () => { loads++; await new Promise(r => { finish = r; }); return { counts: { accidents: 1 } }; }, store);
  while (!finish) await new Promise(r => setTimeout(r, 0));
  await assert.rejects(guardedAccidentSurvey(request, 'radius', { year: 2024 }, async () => {}, store), e => e.status === 429);
  finish(); await pending;
  assert.equal((await guardedAccidentSurvey(request, 'radius', { year: 2024 }, async () => { loads++; }, store)).cached, true);
  assert.equal(loads, 1); assert.equal(permits, 1);
  await assert.rejects(guardedAccidentSurvey(request, 'radius', { year: 2023 }, async () => { throw new Error('upstream'); }, store));
  assert.equal(releases, 2); assert.equal(locked, false);
  await assert.rejects(guardedAccidentSurvey(new Request(request, { headers: { origin: 'https://other.example' } }), 'radius', {}, async () => {}, store), e => e.status === 403);
});

test('unavailable browser storage is reported; fallback and old drafts remain readable', async () => {
  const original = globalThis.localStorage;
  try {
    globalThis.localStorage = { setItem: () => { throw new Error('quota'); }, getItem: () => null };
    assert.equal(await writeDraft('test', { count: 3 }), 'failed');
    const data = new Map(); globalThis.localStorage = { setItem: (k,v) => data.set(k,v), getItem: k => data.get(k) };
    assert.equal(await writeDraft('test', { count: 3 }), 'fallback');
    assert.deepEqual(await readDraft('test'), { count: 3 });
    data.set('old', JSON.stringify({ count: 2 })); assert.deepEqual(await readDraft('old'), { count: 2 });
    assert.throws(() => validateDraftBackup({}), /백업/);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test('unknown, partial and failed steps are not displayed as completed', () => {
  const states = investigationStates({ mapPhase: 'idle', development: {}, transport: {}, accident: 'idle', pointCount: 0 });
  assert.equal(states[1], 'idle'); assert.equal(states[4], 'idle'); assert.equal(states[7], 'manual');
  const gyeonggi = investigationStates({ development: {}, transport: { searched: true, transportRegion: 'gyeonggi', error: '따릉이는 서울 지역만 지원합니다.' } });
  assert.equal(gyeonggi[5], 'complete'); assert.equal(gyeonggi[6], 'partial');
  assert.equal(investigationStates({ development: {}, transport: { searched: true, subwayStations: [{ error: '시간표 확인 필요' }] } })[5], 'partial');
  assert.equal(investigationStates({ ...{}, mapPhase: 'complete', development: { searched: true, complete: true, warnings: 'partial' }, transport: { searched: true, busError: 'failed' }, accident: 'stale', pointCount: 0 })[4], 'partial');
});
