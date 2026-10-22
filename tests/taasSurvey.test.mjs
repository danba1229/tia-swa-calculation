import test from 'node:test';
import assert from 'node:assert/strict';
import { surveyTaas } from '../lib/taasSurvey.js';
import { surveyQuality, SPATIAL_COLLECTION_METHOD } from '../lib/accidentSurvey.js';

const query = { lat: 37.5665, lng: 126.978, radius: 300, year: 2024, type: 'all' };
const spatial = async q => ({ query: q, counts: { accidents: 3, casualties: 4, deaths: 0, serious: 1, minor: 2, reported: 1 }, collectionMethod: SPATIAL_COLLECTION_METHOD, cached: false });
const failRadius = message => async () => { throw new Error(message); };

test('radius results are returned without touching the spatial fallback', async () => {
  const result = await surveyTaas(query, { breaker: {}, radiusImpl: async q => ({ query: q, counts: {}, collectionMethod: 'direct' }), spatialImpl: () => assert.fail('fallback used') });
  assert.equal(result.collectionMethod, 'direct');
  assert.equal(result.fallback, undefined);
});

test('a failed radius survey falls back to WFS and records why', async () => {
  const result = await surveyTaas(query, { breaker: {}, radiusImpl: failRadius('TAAS 반경 조회에 실패했습니다.'), spatialImpl: spatial });
  assert.equal(result.collectionMethod, SPATIAL_COLLECTION_METHOD);
  assert.deepEqual(result.fallback, { from: 'radius', reason: 'TAAS 반경 조회에 실패했습니다.' });
  assert.match(surveyQuality(result).notes[0], /공간분석\(WFS\)으로 대체.*반경 조회에 실패/);
  assert.match(result.qualityNotes[0], /대체/);
});

test('browser internals are not exposed in the fallback reason', async () => {
  const result = await surveyTaas(query, { breaker: {}, radiusImpl: failRadius('locator.waitFor: Timeout\nCall log: https://x'), spatialImpl: spatial });
  assert.equal(result.fallback.reason, 'TAAS 반경분석에 실패했습니다.');
});

test('an unsupported year never falls back, because WFS would read it as zero accidents', async () => {
  const error = Object.assign(new Error('TAAS에서 2024년 자료를 제공하지 않습니다.'), { noFallback: true });
  await assert.rejects(surveyTaas(query, { breaker: {}, radiusImpl: async () => { throw error; }, spatialImpl: () => assert.fail('fallback used') }), e => e.expose && /제공하지 않습니다/.test(e.message));
});

test('when both sources fail the visible message names both failures', async () => {
  await assert.rejects(
    surveyTaas(query, { breaker: {}, radiusImpl: failRadius('TAAS 반경 조회에 실패했습니다.'), spatialImpl: async () => { throw new Error('TAAS 공간분석 서버 조회에 실패했습니다.'); } }),
    e => e.expose && /반경 조회에 실패.*대체 조회도 실패.*공간분석 서버/.test(e.message),
  );
});

test('surveys over 500m keep using WFS directly and expose its sanitized errors', async () => {
  const wide = { ...query, radius: 600 };
  assert.equal((await surveyTaas(wide, { breaker: {}, radiusImpl: () => assert.fail('radius used'), spatialImpl: spatial })).fallback, undefined);
  await assert.rejects(surveyTaas(wide, { breaker: {}, spatialImpl: async () => { throw new Error('TAAS 공간분석 응답 형식 오류'); } }), e => e.expose && /형식 오류/.test(e.message));
});

test('after a radius failure, later queries skip radius until the pause ends', async () => {
  const breaker = {};
  let clock = 0, calls = 0;
  const radiusImpl = async () => { calls++; throw new Error('TAAS 반경 조회에 실패했습니다.'); };
  const options = { breaker, radiusImpl, spatialImpl: spatial, now: () => clock };
  await surveyTaas(query, options);
  const skipped = await surveyTaas(query, options);
  assert.equal(calls, 1);
  assert.match(skipped.fallback.reason, /건너뛰었습니다.*반경 조회에 실패/);
  clock = 10 * 60 * 1000 + 1;
  await surveyTaas(query, options);
  assert.equal(calls, 2);
});
