// Local build, isolated browser draft, genuine public production geocoding/SDK.
// The browser-visible map key is reused in memory under its authorized origin.
// No production files, drafts or application state are written.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, request } from 'playwright-core';
import serverChromium from '@sparticuz/chromium';
import { visibleSigns } from '../lib/signClassification.js';
const base = process.argv[2] || 'http://127.0.0.1:3017';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const origin = 'https://tia-support.vercel.app';
const output = '.preview-test-results/sign-versions';
await mkdir(output, { recursive: true });
const upstream = await request.newContext({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const local = await request.newContext();
const html = await upstream.get(origin).then(r => r.text());
const publicKey = /\\"kakaoJsKey\\":\\"([^"\\]+)\\"/.exec(html)?.[1];
assert.ok(publicKey, 'Published browser-visible map key is available');
const browser = await chromium.launch({ args: serverChromium.args.filter(arg => arg !== '--single-process'), executablePath: await serverChromium.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1400 } });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [];
let signRequests = 0, signData;
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  try {
    const response = url.origin === origin
      ? await (['/api/geocode', '/api/address-suggestions', '/api/traffic-volume'].includes(url.pathname) ? upstream : local)
        .fetch((['/api/geocode', '/api/address-suggestions', '/api/traffic-volume'].includes(url.pathname) ? origin : base) + url.pathname + url.search,
          { method: req.method(), data: req.postData() || undefined, headers: { 'content-type': 'application/json' } })
      : await upstream.fetch(req);
    if (url.pathname === '/api/seoul-signs') { signRequests++; signData = await response.json(); }
    if (url.origin === origin && url.pathname === '/') {
      const body = (await response.text()).replaceAll('\\"kakaoJsKey\\":\\"\\"', `\\"kakaoJsKey\\":\\"${publicKey}\\"`);
      await route.fulfill({ response, body });
    } else await route.fulfill({ response });
  } catch { await route.abort(); }
});
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  const nav = page.getByRole('navigation', { name: '조사 항목' });
  await nav.getByRole('button').nth(9).click();
  const versions = page.getByRole('group', { name: '표지판 표시 기준' });
  await page.getByRole('combobox', { name: '주소지' }).fill('서울 서초구 남부순환로 2584');
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('500');
  await page.getByLabel('세로 범위(m)', { exact: true }).fill('500');
  await page.locator('.signs-status').filter({ hasText: '500 × 500m' }).waitFor();
  await page.locator('.signs-callout').first().waitFor();
  const rawCount = signData.points.length, policeCount = visibleSigns(signData.points).length;
  assert.equal(rawCount, 119); assert.equal(policeCount, 101);
  await page.waitForFunction(count => document.querySelectorAll('.signs-dot').length === count, policeCount);
  await page.waitForFunction(() => [...document.querySelectorAll('.signs-map img')].filter(n => n.complete && n.naturalWidth > 0).length > 5);
  await page.waitForFunction(() => document.querySelector('.police-chart img')?.naturalWidth === 3136);
  const requestsBefore = signRequests;
  await page.evaluate(() => { window.__signMapChild = document.querySelector('.signs-map').firstElementChild; });
  await page.screenshot({ path: `${output}/police.png`, fullPage: true });
  await versions.getByRole('button', { name: '서울시 기준', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.signs-dot').length === count, rawCount);
  assert.equal(await page.getByRole('complementary', { name: '서울시 원본 코드 목록' }).count(), 1);
  assert.equal(await page.getByRole('complementary', { name: '경찰청 교통안전시설 일람표' }).count(), 0);
  assert.ok(await page.evaluate(() => window.__signMapChild === document.querySelector('.signs-map').firstElementChild), 'Map instance survives switching');
  const sourcePoint = signData.points.find(p => p.sourceIndex === '751');
  await page.locator('.signs-detail select').selectOption(sourcePoint.id);
  assert.match(await page.locator('.signs-detail strong').textContent(), /서울시 원본 코드 751/);
  assert.equal(await page.locator('.signs-roadview-link').getAttribute('href'), `https://map.kakao.com/link/roadview/${sourcePoint.lat},${sourcePoint.lng}`);
  assert.ok((await page.locator('.signs-detail').textContent()).includes(sourcePoint.sourceRemark));
  assert.match(await page.locator('.signs-map-legend').textContent(), /서울시 원본 코드/);
  await page.getByRole('button', { name: '조사 범위에 맞추기', exact: true }).click();
  await page.screenshot({ path: `${output}/seoul.png`, fullPage: true });
  await versions.getByRole('button', { name: '경찰청 일람표 기준', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.signs-dot').length === count, policeCount);
  assert.equal(await page.locator('.signs-detail select').inputValue(), '');
  assert.equal(signRequests, requestsBefore, 'Version switch does not fetch a new scope');
  const types = page.getByRole('group', { name: '표지판 종류' });
  await types.getByRole('button', { name: /^도로표지/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.signs-dot').length === 11);
  await versions.getByRole('button', { name: '서울시 기준', exact: true }).click();
  assert.equal(await page.locator('.signs-detail option').count(), 12);
  await types.getByRole('button', { name: /^전체 표지판/ }).click();
  await page.waitForFunction(count => document.querySelectorAll('.signs-dot').length === count, rawCount);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/seoul-mobile.png`, fullPage: true });
  await versions.getByRole('button', { name: '경찰청 일람표 기준', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await nav.getByRole('button').nth(5).click();
  assert.equal(await page.getByRole('region', { name: 'STEP 9 교통 표지판' }).isVisible(), false);
  assert.equal(await page.locator('.police-chart').count(), 0);
  await nav.getByRole('button').nth(9).click();
  await page.locator('.signs-callout').first().waitFor();
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('0');
  await page.locator('.signs-status').filter({ hasText: '1~10,000m' }).waitFor();
  assert.equal(await page.locator('.signs-overlay').count(), 0);
  await versions.getByRole('button', { name: '서울시 기준', exact: true }).click();
  assert.equal(await page.locator('.signs-detail').count(), 0);
  assert.deepEqual(errors, []);
  const evidence = { rawCount, policeCount, requestsBefore, signRequests, errors, checks: ['real Kakao tiles', 'two versions', 'raw details and Roadview link', 'map instance retained', 'no refetch on toggle', 'source filter', 'mobile width', 'step isolation', 'invalid scope clears data'] };
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ errors, status: await page.locator('.signs-status').textContent().catch(() => ''), mapError: await page.locator('.signs-map-message').textContent().catch(() => '') }));
  throw error;
} finally { await browser.close(); await local.dispose(); await upstream.dispose(); }
