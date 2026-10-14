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
const output = '.preview-test-results/bus-stop-popup';
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
const outputPopup = output;
let releaseDetails;
const detailsReady = new Promise(resolve => { releaseDetails = resolve; });
const routes = [{ busRouteId: '1001', routeName: '470', routeType: '간선' }, { busRouteId: '1002', routeName: '서초08', routeType: '마을' }];
const stops = [
  { stationId: '1', stationName: '서초구청', arsId: '22863', latitude: 37.4847, longitude: 127.0327, distanceMeters: 123.4, routes: routes.map(r => ({ ...r, routeType: '수동 확인 필요' })) },
  { stationId: '2', stationName: '확인필요정류장', arsId: '00123', latitude: 37.486, longitude: 127.035, distanceMeters: 300, routes: [], routeError: '공식 파일에 연결된 노선 없음' },
];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  const send = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  try {
    if (url.origin === origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/geocode') {
      if (url.pathname === '/api/seoul-bus') return await send({ success: true, busStops: stops, summary: { returnedCount: 2 }, source: '테스트 공식자료 형식', sourceDate: '2026-10-14' });
      if (url.pathname === '/api/seoul-bus/details') {
        await detailsReady;
        return await send({ success: true, updates: routes.map(r => ({ busRouteId: r.busRouteId, detail: { ...r, startStation: '기점', endStation: '종점' }, stationTimes: [] })) });
      }
      if (url.pathname === '/api/subway' || url.pathname === '/api/seoul-bike') return await send({ success: true, stations: [], summary: { returnedCount: 0 } });
      if (url.pathname === '/api/address-suggestions') return await send({ success: true, suggestions: [] });
      if (url.pathname.startsWith('/api/traffic-volume')) return await send({ months: [] });
      return await send({ success: false, message: '관련 없는 API 격리' });
    }
    const response = url.origin === origin
      ? await (url.pathname === '/api/geocode' ? upstream : local).fetch((url.pathname === '/api/geocode' ? origin : base) + url.pathname + url.search,
        { method: req.method(), data: req.postData() || undefined, headers: { 'content-type': 'application/json' } })
      : await upstream.fetch(req);
    if (url.origin === origin && url.pathname === '/') {
      const body = (await response.text()).replaceAll('\\"kakaoJsKey\\":\\"\\"', `\\"kakaoJsKey\\":\\"${publicKey}\\"`);
      await route.fulfill({ response, body });
    } else await route.fulfill({ response });
  } catch { await route.abort(); }
});
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  await page.getByRole('navigation', { name: '조사 항목' }).getByRole('button').nth(5).click();
  const input = page.getByRole('combobox', { name: '주소지', exact: true });
  await input.fill('서울 서초구 남부순환로 2584');
  await page.getByLabel('가로 범위(m)', { exact: true }).fill('1000');
  await page.getByLabel('세로 범위(m)', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '조사 시작', exact: true }).click();
  const marker = page.getByRole('button', { name: '서초구청 버스정류장 정보 보기', exact: true });
  await marker.click();
  console.log('Marker opened');
  const popup = page.getByRole('region', { name: '선택한 버스정류장 정보' });
  await popup.getByRole('heading', { name: '서초구청(22863)' }).waitFor();
  assert.match(await popup.innerText(), /수동확인필요/);
  releaseDetails();
  await popup.getByText('470(간선), 서초08(마을)', { exact: true }).waitFor();
  assert.deepEqual(await popup.locator('dt').allTextContents(), ['경유버스:', '정차노선수:', '사업지와 거리:']);
  assert.deepEqual(await popup.locator('dd').allTextContents(), ['470(간선), 서초08(마을)', '2', '123m']);
  assert.equal(await page.locator('.bus-stop-table').count(), 0);
  await page.getByRole('heading', { name: '버스노선표', exact: true }).waitFor();
  async function checkInsideMap() {
    const map = await page.locator('#scope-map').boundingBox(), card = await popup.boundingBox();
    assert.ok(card && map && card.x >= map.x && card.y >= map.y && card.x + card.width <= map.x + map.width + 1 && card.y + card.height <= map.y + map.height + 1);
  }
  await checkInsideMap();
  await page.screenshot({ path: `${outputPopup}/desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '지도 크게 보기', exact: true }).click();
  await checkInsideMap();
  await page.screenshot({ path: `${outputPopup}/expanded.png` });
  await page.getByRole('button', { name: '버스정류장 정보 닫기' }).click();
  assert.equal(await popup.count(), 0);
  await marker.focus();
  await page.keyboard.press('Enter');
  await popup.waitFor();
  await page.getByRole('button', { name: '버스정류장 정보 닫기' }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await popup.count(), 0);
  await page.getByRole('button', { name: '확인필요정류장 버스정류장 정보 보기', exact: true }).click();
  assert.deepEqual(await popup.locator('dd').allTextContents(), ['수동확인필요', '수동확인필요', '300m']);
  await page.getByLabel('버스정류장 표시', { exact: true }).uncheck();
  assert.equal(await popup.count(), 0);
  assert.equal(await page.locator('.bus-stop-button').count(), 0);
  await page.getByLabel('버스정류장 표시', { exact: true }).check();
  await marker.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkInsideMap();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${outputPopup}/mobile-expanded.png` });
  await page.getByRole('button', { name: '기본 화면으로', exact: true }).click();
  await checkInsideMap();
  await page.screenshot({ path: `${outputPopup}/mobile.png`, fullPage: true });
  await input.fill('서울 강남구 테헤란로 152');
  await page.waitForFunction(() => !document.querySelector('.bus-stop-map-popup'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, fixtureBusData: true, realKakaoMap: true, popupInsideMap: true, liveDetailUpdate: true, keyboardAndClose: true, toggleClearsSelection: true, addressChangeClearsSelection: true, mobile: true, errors }, null, 2));
} catch (error) {
  console.log(String(error));
  await page.screenshot({ path: `${outputPopup}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${outputPopup}/failure.txt`, await page.locator('body').innerText()).catch(() => {});
  throw error;
} finally { releaseDetails(); await browser.close(); await local.dispose(); await upstream.dispose(); }
