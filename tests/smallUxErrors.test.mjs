import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { groupReportNotes } from '../lib/accidentReport.js';

// Load the real route with its imports resolved, as the other route tests do.
async function subwayRoute() {
  const require = createRequire(import.meta.url);
  let source = readFileSync(new URL('../app/api/subway/route.js', import.meta.url), 'utf8');
  source = source.replace('"next/server"', JSON.stringify(pathToFileURL(require.resolve('next/server.js')).href));
  for (const name of ['subway', 'seoulBusSnapshot']) source = source.replace(`"../../../lib/${name}.js"`, JSON.stringify(new URL(`../lib/${name}.js`, import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const post = async body => (await subwayRoute()).POST(new Request('http://localhost/api/subway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));

test('subway API answers bad input with 400 and a subway message, not 502', async () => {
  for (const body of ['{}', JSON.stringify({ center: { lat: 37.5, lng: 127 }, width: 0, height: 0 })]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.match(data.message, /지하철역 조사 범위/);
    assert.doesNotMatch(data.message, /버스정류장/);
  }
  const broken = await post('{not json');
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).message, /요청 형식/);
});

test('signs step says it loads when opened instead of claiming to load while hidden', () => {
  const source = readFileSync(new URL('../components/TrafficSignsStep.jsx', import.meta.url), 'utf8');
  assert.match(source, /visible \? '서울 표지판을 조회하고 있습니다…' : '표지판 단계를 열면 서울 표지판을 조회합니다\.'/);
});

test('identical accident notes are printed once with every affected item', () => {
  const fallback = 'TAAS 반경분석 실패로 공간분석(WFS)으로 대체 조회했습니다.';
  const notes = ['교차로 중심 반경 내 전체 사고입니다.', `2023년: ${fallback}`, `2023년 차대차: ${fallback}`, `2024년 차대차: ${fallback}`, '2023년 철길건널목: 사고 0건', `2025년: 다른 내용`];
  assert.deepEqual(groupReportNotes(notes), [
    '교차로 중심 반경 내 전체 사고입니다.',
    `2023년, 2023년 차대차, 2024년 차대차 (3개 항목): ${fallback}`,
    '2023년 철길건널목: 사고 0건',
    '2025년: 다른 내용',
  ]);
  assert.deepEqual(groupReportNotes(['A', 'A']), ['A'], 'unlabelled duplicates collapse too');
});
