// Local build, isolated browser draft, genuine public production geocoding/SDK.
// The browser-visible map key is reused in memory under its authorized origin.
// No production files, drafts or application state are written.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, request } from 'playwright-core';
import serverChromium from '@sparticuz/chromium';
const base = process.argv[2] || 'http://127.0.0.1:3017';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const origin = 'https://tia-support.vercel.app';
const output = '.preview-test-results/survey-address';
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
const catalogCalls = [], matchedAddresses = [], gitsQueries = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  try {
    if (url.origin === origin && url.pathname.startsWith('/api/') && !['/api/geocode', '/api/address-suggestions', '/api/traffic-volume', '/api/traffic-volume/gyeonggi', '/api/gyeonggi-survey'].includes(url.pathname)) {
      return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: '격리된 UI 검증: 관련 없는 API 미실행' }) });
    }
    if (url.pathname === '/api/geocode' && req.postDataJSON().address === '서울 존재하지않는주소999999') {
      return await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: '검색 결과가 없습니다.' }) });
    }
    const response = url.origin === origin
      ? await (['/api/geocode', '/api/address-suggestions', '/api/traffic-volume', '/api/traffic-volume/gyeonggi'].includes(url.pathname) ? upstream : local)
        .fetch((['/api/geocode', '/api/address-suggestions', '/api/traffic-volume', '/api/traffic-volume/gyeonggi'].includes(url.pathname) ? origin : base) + url.pathname + url.search,
          { method: req.method(), data: req.postData() || undefined, headers: { 'content-type': 'application/json' } })
      : await upstream.fetch(req);
    if (url.pathname.startsWith('/api/traffic-volume')) catalogCalls.push(url.pathname);
    if (url.pathname === '/api/geocode') matchedAddresses.push((await response.json()).matchedAddress);
    if (url.pathname === '/api/gyeonggi-survey') gitsQueries.push(req.postDataJSON().address);
    if (url.origin === origin && url.pathname === '/') {
      const body = (await response.text()).replaceAll('\\"kakaoJsKey\\":\\"\\"', `\\"kakaoJsKey\\":\\"${publicKey}\\"`);
      await route.fulfill({ response, body });
    } else await route.fulfill({ response });
  } catch { await route.abort(); }
});
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  await page.getByRole('navigation', { name: '조사 항목' }).getByRole('button').nth(2).click();
  const input = page.getByRole('combobox', { name: '주소지', exact: true });
  await input.fill('서초구 남부순환로 2584');
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('500');
  await page.getByLabel('세로 범위(m)', { exact: true }).fill('500');
  await page.getByRole('heading', { name: '서울 TOPIS 최근접 3지점', exact: true }).waitFor();
  assert.equal(await input.inputValue(), '서초구 남부순환로 2584');
  await page.waitForFunction(() => document.querySelectorAll('.survey-recommendation-block .survey-recommendation-card').length === 3, null, { timeout: 240000 });
  const seoulCards = await page.locator('.survey-recommendation-block .survey-recommendation-card h3').allTextContents();
  assert.ok(catalogCalls.includes('/api/traffic-volume'));
  assert.equal(matchedAddresses[0], '서울 서초구 남부순환로 2584');
  await page.getByRole('button', { name: '조사 시작', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.survey-point-overlay').length === 3);
  const markers = await page.locator('.survey-point-overlay').allTextContents();
  await page.waitForFunction(() => [...document.querySelectorAll('#scope-map img')].filter(img => img.complete && img.naturalWidth > 100).length >= 5);
  await page.screenshot({ path: `${output}/seoul.png`, fullPage: true });
  console.log(JSON.stringify({ stage: 'seoul', input: await input.inputValue(), seoulCards, markers }));

  await input.fill('수원시 팔달구 효원로 241');
  await page.getByRole('heading', { name: '경기 GITS 최근접 3지점', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '서울 TOPIS 최근접 3지점', exact: true }).count(), 0);
  assert.ok(matchedAddresses.some(a => a?.startsWith('경기 수원시')));
  await page.waitForFunction(() => document.querySelector('[aria-label="경기 사전조사지점 첨두분석 연결"]'));
  assert.equal(await page.locator('.survey-point-overlay').count(), 0);
  const gitsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/gyeonggi-survey', { timeout: 120000 });
  await page.getByRole('button', { name: '조사 시작', exact: true }).click();
  await gitsResponse;
  assert.ok(gitsQueries.length > 0, 'Road survey requested GITS candidates');
  assert.ok(gitsQueries.every(a => a.startsWith('경기 수원시')));
  await page.screenshot({ path: `${output}/gyeonggi.png`, fullPage: true });

  await input.fill('서울 존재하지않는주소999999');
  await page.locator('.site-location-status').filter({ hasText: '검색 결과가 없습니다.' }).waitFor();
  assert.equal(await page.locator('.survey-recommendation-block').count(), 0);
  assert.equal(await page.locator('.survey-point-overlay').count(), 0);
  assert.equal(await page.locator('#weekly-traffic-analysis').count(), 0);
  await input.fill('');
  await page.waitForFunction(() => !document.querySelector('.survey-recommendation-block'));
  assert.deepEqual(errors, []);
  const evidence = { seoulCards, markers, matchedAddresses, gitsQueries, errors,
    checks: ['actual geocoded address controls survey region', 'original input retained', 'Seoul recommendations and map markers', 'Gyeonggi source switch and canonical API address', 'failed address clears candidates and analysis', 'empty input clears region'] };
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await local.dispose(); await upstream.dispose(); }
