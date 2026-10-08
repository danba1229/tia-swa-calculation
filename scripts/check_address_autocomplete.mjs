// Local, isolated browser verification. API responses are deterministic fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import c from '@sparticuz/chromium';

const base = process.argv[2] || 'http://127.0.0.1:3002';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
await mkdir('.preview-test-results', { recursive: true });
const browser = await chromium.launch({ args: c.args.filter(arg => arg !== '--single-process'), executablePath: await c.executablePath(), headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const queries = [], geocodes = [], errors = [], checks = [];
const options = [
  { address: '서울특별시 중구 세종대로 110', roadAddress: '서울특별시 중구 세종대로 110', landAddress: '서울특별시 중구 태평로1가 31', name: '서울시청', type: '도로명' },
  { address: '서울특별시 중구 세종대로 99', roadAddress: '서울특별시 중구 세종대로 99', landAddress: '서울특별시 중구 정동 5-1', name: '덕수궁', type: '도로명' },
];
let finishSlow;
const slow = new Promise(resolve => { finishSlow = resolve; });
let markSlowStarted;
const slowStarted = new Promise(resolve => { markSlowStarted = resolve; });
async function fixtures(context) {
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/address-suggestions') {
      queries.push(body.query);
      if (body.query === '서울 느린') {
        markSlowStarted();
        await slow;
        return send({ success: true, suggestions: [{ ...options[0], address: '이전 검색 결과 주소' }] });
      }
      if (body.query === '없는주소') return send({ success: true, suggestions: [] });
      if (body.query === '오류주소') return send({ success: false, suggestions: [] }, 502);
      return send({ success: true, suggestions: options });
    }
    if (path === '/api/geocode') {
      geocodes.push(body.address);
      return send({ success: true, latitude: 37.5665, longitude: 126.978, matchedAddress: body.address });
    }
    if (path.startsWith('/api/traffic-volume')) return send({ months: [] });
    return send({ success: false, message: 'UI test: unrelated provider not called' }, 503);
  });
}

try {
  await fixtures(desktop);
  const page = await desktop.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  const input = page.getByRole('combobox', { name: '주소지', exact: true });
  const items = page.getByRole('listbox', { name: '주소 후보' }).getByRole('option');
  await input.fill('서');
  await page.waitForTimeout(450);
  assert.equal(queries.length, 0);
  await input.fill('');
  // Dispatch a single rapid typing burst without host scheduling pauses between
  // characters (a real pause longer than the debounce correctly starts a search).
  await input.evaluate(element => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const value of ['서울', '서울 세종', '서울 세종대로']) {
      setValue.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await items.first().waitFor();
  assert.deepEqual(queries, ['서울 세종대로']);
  assert.equal(await input.getAttribute('aria-expanded'), 'true');
  await input.press('ArrowDown');
  assert.equal(await items.first().getAttribute('aria-selected'), 'true');
  assert.equal(await input.getAttribute('aria-activedescendant'), await items.first().getAttribute('id'));
  await input.press('ArrowDown');
  await input.press('Enter');
  assert.equal(await input.inputValue(), options[1].address);
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  await page.waitForFunction(address => document.querySelector('.site-location-status')?.textContent.includes(`주소 확인: ${address}`), options[1].address);
  assert.ok(geocodes.includes(options[1].address));
  checks.push('Minimum length, debounce, arrow selection, Enter and existing precise geocoding');

  await input.fill('서울 새검색');
  await items.first().waitFor();
  await input.press('Escape');
  assert.equal(await items.count(), 0);
  assert.equal(await input.inputValue(), '서울 새검색');
  await input.fill('서울 클릭');
  await items.first().waitFor();
  await items.first().click();
  assert.equal(await input.inputValue(), options[0].address);
  await input.fill('서울 밖클릭');
  await items.first().waitFor();
  await page.getByLabel('가로 범위(m)', { exact: true }).click();
  assert.equal(await items.count(), 0);
  checks.push('Escape, mouse choice and outside-click dismissal preserve manual input');

  const slowRequest = page.waitForRequest(request => request.url().endsWith('/api/address-suggestions') && request.postDataJSON()?.query === '서울 느린');
  await input.fill('서울 느린');
  await slowRequest;
  await slowStarted;
  assert.ok(queries.includes('서울 느린'));
  await input.fill('서울 최신');
  await items.first().waitFor();
  finishSlow();
  await page.waitForTimeout(200);
  assert.equal(await items.filter({ hasText: '이전 검색 결과 주소' }).count(), 0);
  await input.fill('');
  assert.equal(await items.count(), 0);
  checks.push('Late superseded responses cannot replace the latest results; clearing closes suggestions');

  const previous = queries.length;
  await input.dispatchEvent('compositionstart');
  await input.fill('한글 조합');
  await page.waitForTimeout(450);
  assert.equal(queries.length, previous);
  await input.dispatchEvent('compositionend');
  await items.first().waitFor();
  assert.equal(queries.at(-1), '한글 조합');
  checks.push('Korean IME composition waits for completion before searching');

  await input.fill('없는주소');
  await page.getByText('검색 결과가 없습니다. 도로명·번지 또는 건물명을 더 입력해 주세요.', { exact: true }).waitFor();
  await input.fill('오류주소');
  await page.getByText('자동완성을 불러오지 못했습니다. 주소를 직접 입력할 수 있습니다.', { exact: true }).waitFor();
  await input.fill('직접 입력한 상세 주소');
  assert.equal(await input.inputValue(), '직접 입력한 상세 주소');
  checks.push('Empty results and provider failures remain explicit and manual entry stays usable');

  await input.fill('서울 시청');
  await items.first().waitFor();
  await page.screenshot({ path: '.preview-test-results/address-autocomplete-desktop.png' });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fixtures(mobile);
  const phone = await mobile.newPage();
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`${base}/embed`, { waitUntil: 'networkidle' });
  await phone.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  const phoneInput = phone.getByRole('combobox', { name: '주소지', exact: true });
  await phoneInput.fill('서울 시청');
  const phoneItems = phone.getByRole('listbox', { name: '주소 후보' }).getByRole('option');
  await phoneItems.first().waitFor();
  await phone.screenshot({ path: '.preview-test-results/address-autocomplete-mobile.png', fullPage: false });
  await phoneItems.first().tap();
  assert.equal(await phoneInput.inputValue(), options[0].address);
  assert.equal(await phoneInput.getAttribute('aria-expanded'), 'false');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('Mobile touch selection and embedded layout without horizontal overflow');
  await mobile.close();
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, fixtures: true };
  await writeFile('.preview-test-results/address-autocomplete-validation.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { finishSlow(); await desktop.close(); await browser.close(); }
