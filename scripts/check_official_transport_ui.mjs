// Compiled UI and real local GITS endpoint; location/subway responses use recorded public fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import c from '@sparticuz/chromium';
const base = process.argv[2] || 'http://127.0.0.1:3022';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = '.preview-test-results/official-transport'; await mkdir(out, { recursive: true });
const schedule = JSON.parse(await readFile('tests/fixtures/official-transport/suin-result.json', 'utf8'));
const station = { id: 'test-suwon', stationName: '수원시청역 수인분당선', subwayStationId: 'MTRKRK1K243', line: '수인분당선', distanceMeters: 100, latitude: 37.261, longitude: 127.031, status: 'PENDING', schedules: [] };
const browser = await chromium.launch({ args: c.args.filter(a => a !== '--single-process'), executablePath: await c.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], checks = {};
page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message));
await context.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname;
  const send = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/api/traffic-volume/gyeonggi/official') return route.continue();
  if (path === '/api/traffic-volume/gyeonggi') return send({ months: [{ month: '2024-12', points: [] }], warning: '기존 자료 확인용 fixture', sync: [] });
  if (path === '/api/geocode') return send({ success: true, x: 127.028, y: 37.263, latitude: 37.263, longitude: 127.028, matchedAddress: '경기 수원시 팔달구 효원로 241' });
  if (path === '/api/address-suggestions') return send({ success: true, suggestions: [] });
  if (path === '/api/gyeonggi-bus') return send({ success: true, busStops: [], summary: { returnedCount: 0 } });
  if (path === '/api/subway') return send({ success: true, stations: [station], source: '공식자료 기록 응답 · UI 검증용' });
  if (path === '/api/subway/details') { const body = route.request().postDataJSON(); return send({ ...schedule, success: true, stationId: station.subwayStationId, slots: schedule.slots.filter(s => body.slots.includes(s.key)) }); }
  return send({ success: false, message: 'Unrelated UI fixture' });
});
try {
  await page.goto(base, { waitUntil: 'networkidle' }); await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  const nav = page.getByRole('navigation', { name: '조사 항목' });
  await nav.getByRole('button').nth(2).click();
  await page.getByRole('combobox', { name: '주소지', exact: true }).fill('수원시 팔달구 효원로 241');
  await page.getByRole('button', { name: '별도 참고지점 직접 선택', exact: true }).click();
  await page.getByRole('combobox', { name: '교통량 분석 지점', exact: true }).selectOption('0134-00');
  const summary = page.getByLabel('주간 교통량 분석 요약'); await summary.waitFor();
  assert.match(await summary.innerText(), /12\/22.*12\/28/s);
  assert.match(await summary.innerText(), /12\/26/);
  checks.actualGitsWeek = true;
  const csvPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '분석표 CSV', exact: true }).click();
  const csv = await csvPromise; await csv.saveAs(`${out}/gits.csv`);
  assert.match(await readFile(`${out}/gits.csv`, 'utf8'), /경기도 교통정보센터/); checks.csv = true;
  const jsonPromise = page.waitForEvent('download'); await page.getByRole('link', { name: '선택 지점·월 원자료 JSON 다운로드', exact: true }).click();
  const json = await jsonPromise; await json.saveAs(`${out}/gits-month.json`);
  const source = JSON.parse(await readFile(`${out}/gits-month.json`, 'utf8'));
  assert.equal(source.rows.length, 62); assert.ok(source.rows.every(r => r.SPOT_NO_INFO === '0134-00')); checks.stationMonthDownload = true;
  await page.screenshot({ path: `${out}/gits.png`, fullPage: true });
  await page.getByRole('combobox', { name: '경기 교통량 출처', exact: true }).selectOption('legacy');
  await page.getByText('기존 자료 확인용 fixture', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('교통량 자료 월', { exact: true }).inputValue(), '2024-12');
  assert.equal(await summary.count(), 0); checks.sourceSwitchClearsResult = true;
  await nav.getByRole('button').nth(5).click(); await page.getByRole('button', { name: '교통시설 조회', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '교통시설 조회' && !b.disabled));
  const subway = page.locator('.subpanel').filter({ has: page.getByRole('heading', { name: '지하철역 · 운행일/행선지별 첫차·막차', exact: true }) });
  assert.equal(await subway.locator('tbody tr').filter({ hasText: '토요일' }).count(), 6);
  assert.match(await subway.innerText(), /2026-08-22/); assert.match(await subway.innerText(), /토·일·공휴일은 공식 휴일 시트/);
  assert.equal(await subway.getByRole('link', { name: '운영사 공식 시간표' }).count(), 1); checks.subwayProvenance = true;
  await page.screenshot({ path: `${out}/subway.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 1050 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390); checks.mobileNoOverflow = true;
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []); console.log(JSON.stringify(checks));
} catch (error) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }); console.error(error); process.exitCode = 1; }
finally { await writeFile(`${out}/summary.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
