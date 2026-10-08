import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, request } from 'playwright-core';
import serverChromium from '@sparticuz/chromium';
const base = process.argv[2] || 'http://127.0.0.1:3010';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const production = 'https://tia-support.vercel.app';
// Render the local build under the owner's existing authorized map origin.
// All application assets and sign requests are still fulfilled by the local server.
// This does not publish or modify the production application.
const appOrigin = process.argv.includes('--production-origin') ? production : base;
const output = '.preview-test-results/step9';
await mkdir(output, { recursive: true });
// Node's API transport uses the cloud CA and proxy. The browser receives genuine
// upstream SDK/tiles; no fake map, geocode, or sign response is used in screenshots.
const transport = await request.newContext({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const local = await request.newContext();
const browser = await chromium.launch({ args: serverChromium.args.filter(arg => arg !== '--single-process'), executablePath: await serverChromium.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1600 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [], requests = [], failures = [];
let pendingImages = 0;
async function waitForMapImages() {
  for (let i = 0; i < 100 && pendingImages; i++) await page.waitForTimeout(200);
  assert.equal(pendingImages, 0, "Map image responses completed");
  await page.waitForTimeout(700);
}
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname === '/api/seoul-signs') requests.push(req.url());
  const imageRequest = req.resourceType() === 'image';
  if (imageRequest) pendingImages++;
  try {
    let response;
    if (url.origin === appOrigin) {
      response = ['/api/geocode', '/api/address-suggestions', '/api/traffic-volume'].includes(url.pathname)
        ? await transport.fetch(production + url.pathname + url.search, { method: req.method(), data: req.postData() || undefined, headers: { 'content-type': 'application/json' } })
        : await local.fetch(base + url.pathname + url.search, { method: req.method(), data: req.postData() || undefined, headers: req.headers() });
    } else response = await transport.fetch(req);
    if (response.status() >= 400) failures.push({ host: url.hostname, path: url.pathname, status: response.status() });
    await route.fulfill({ response });
  } catch (e) { failures.push({ host: url.hostname, path: url.pathname, error: e.message.split('\n')[0] }); await route.abort(); }
  finally { if (imageRequest) pendingImages--; }
});
try {
  await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  const nav = page.getByRole('navigation', { name: '조사 항목' });
  await nav.getByRole('button').nth(9).click();
  const signs = page.getByRole('region', { name: 'STEP 9 교통 표지판' });
  assert.ok(await signs.isVisible());
  assert.equal(await page.locator('.project-panel').isVisible(), false);
  assert.equal(requests.length, 0);
  await page.getByRole('combobox', { name: '주소지' }).fill('서울 서초구 남부순환로 2584');
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('500');
  await page.getByLabel('세로 범위(m)', { exact: true }).fill('500');
  await page.locator('.signs-status').filter({ hasText: '500 × 500m' }).waitFor();
  await page.locator('.signs-overlay .signs-callout').first().waitFor();
  await page.waitForTimeout(2500);
  const mapInfo = await page.evaluate(() => ({ address: document.querySelector('.site-location-status').textContent, summary: document.querySelector('.signs-status').textContent, callouts: [...document.querySelectorAll('.signs-callout text')].map(n => n.textContent), mapImages: [...document.querySelectorAll('.signs-map img')].filter(n => n.complete && n.naturalWidth > 0).length }));
  assert.ok(mapInfo.summary.includes('119건'));
  assert.ok(mapInfo.mapImages > 5, 'Real Kakao map tiles loaded');
  assert.ok(mapInfo.callouts.every(text => text.length > 4), 'Official management identifiers, not sequential labels');
  await page.getByRole('heading', { name: '교통 표지판 위치도', exact: true }).click();
  await waitForMapImages();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/step9-seocho-500m.png` });
  await page.locator('.signs-callout').first().click();
  assert.ok(await page.locator('.signs-detail strong').textContent());
  await page.getByRole('group', { name: '표지판 종류' }).getByRole('button', { name: /^도로표지/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.signs-dot').length === 11);
  await page.getByRole('group', { name: '표지판 종류' }).getByRole('button', { name: /^전체 표지판/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.signs-dot').length === 119);
  const requestCount = requests.length;
  await nav.getByRole('button').nth(5).click();
  assert.equal(await signs.isVisible(), false);
  assert.ok(await page.locator('.project-panel').isVisible());
  await nav.getByRole('button').nth(0).click();
  assert.equal(await signs.isVisible(), false);
  assert.equal(await page.locator('.workspace-results > .step-section:visible').count(), 8);
  assert.equal(requests.length, requestCount, 'No signs request outside Step 9');
  await nav.getByRole('button').nth(9).click();
  await page.locator('.signs-callout').first().waitFor();
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('0');
  await page.locator('.signs-status').filter({ hasText: '1~10,000m' }).waitFor();
  assert.equal(await page.locator('.signs-overlay').count(), 0, 'Invalid scope clears stale map');
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('500');
  await page.locator('.signs-callout').first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '조사 범위에 맞추기', exact: true }).click();
  await page.waitForTimeout(2500);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile has no horizontal overflow');
  await waitForMapImages();
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: `${output}/step9-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1800, height: 1600 });
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('2300');
  await page.getByLabel('세로 범위(m)', { exact: true }).fill('3200');
  await page.locator('.signs-status').filter({ hasText: '3,735건' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.signs-dot').length === 3735);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${output}/step9-seocho-default.png`, fullPage: true });
  assert.deepEqual(errors, []);
  const evidence = { mapInfo, requestCount: requests.length, errors, failures };
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (e) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ errors, failures, text: (await page.locator('.signs-status').textContent().catch(() => '')), mapError: await page.locator('.signs-map-message').textContent().catch(() => '') }));
  throw e;
} finally { await browser.close(); await transport.dispose(); await local.dispose(); }
