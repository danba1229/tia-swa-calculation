import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import c from '@sparticuz/chromium';
const base = process.argv[2] || 'http://127.0.0.1:3019';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ args: c.args.filter(a => a !== '--single-process'), executablePath: await c.executablePath(), headless: true });
const errors = [], requests = [];
async function open(saved) {
  const context = await browser.newContext();
  if (saved) await context.addInitScript(data => localStorage.setItem('tia-research-builder-next-v3-kosis', JSON.stringify(data)), saved);
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data = { success: false, message: 'Unrelated fixture' };
    if (path === '/api/geocode') data = { success: true, latitude: 37.483625, longitude: 127.032683, matchedAddress: '서울 서초구 남부순환로 2584' };
    if (path === '/api/address-suggestions') data = { success: true, suggestions: [] };
    if (path === '/api/local-statistics') {
      requests.push(route.request().postDataJSON());
      data = { extraction: { status: 'DATA_NOT_FOUND', message: '연도 전달 검증용 응답' } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  await page.getByRole('navigation', { name: '조사 항목' }).getByRole('button').nth(3).click();
  return { context, page, year: page.getByRole('combobox', { name: '기준연도', exact: true }) };
}
try {
  const fresh = await open();
  assert.equal(await fresh.year.inputValue(), '2025');
  await fresh.page.getByRole('combobox', { name: '주소지', exact: true }).fill('서울 서초구 남부순환로 2584');
  await fresh.page.getByRole('button', { name: 'KOSIS 자료 추출', exact: true }).click();
  await fresh.page.getByText('연도 전달 검증용 응답', { exact: true }).first().waitFor();
  assert.equal(requests.at(-1).year, '2025');
  await fresh.year.selectOption('2023');
  assert.equal(await fresh.year.inputValue(), '2023');
  await fresh.page.locator('.draft-status').first().getByText('이 브라우저에 저장됨', { exact: true }).waitFor();
  const backup = fresh.page.waitForEvent('download');
  await fresh.page.getByRole('button', { name: '조사 백업', exact: true }).first().click();
  const downloaded = await backup;
  const content = await import('node:fs/promises').then(fs => downloaded.path().then(path => fs.readFile(path, 'utf8')));
  const stored = JSON.parse(content).drafts['tia-research-builder-next-v3-kosis'];
  assert.equal(stored.statisticsYear, '2023');
  assert.equal(stored.statisticsYearMode, 'manual');
  await fresh.page.reload();
  await fresh.page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  assert.equal(await fresh.year.inputValue(), '2023');
  await fresh.page.getByRole('button', { name: '전체 초기화', exact: true }).click();
  assert.equal(await fresh.year.inputValue(), '2025');
  for (const label of ['서울 샘플', '경기도 샘플']) {
    await fresh.page.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await fresh.year.inputValue(), '2025');
  }
  await fresh.context.close();
  const manual = await open(stored);
  assert.equal(await manual.year.inputValue(), '2023');
  await manual.context.close();
  const empty = await open({ statisticsYear: '2024' });
  assert.equal(await empty.year.inputValue(), '2025');
  await empty.context.close();
  const saved = await open({ statisticsYear: '2024', landuseAreas: { 전: '123' }, landuseBaseYear: '2024', researchSchemaVersion: 2 });
  assert.equal(await saved.year.inputValue(), '2024');
  assert.ok(await saved.page.locator('input[value="123"]').count());
  await saved.page.getByRole('combobox', { name: '주소지', exact: true }).fill('서울 서초구 남부순환로 2584');
  assert.equal(await saved.year.inputValue(), '2025');
  assert.equal(await saved.page.locator('input[value="123"]').count(), 0);
  await saved.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, latestDefault: '2025', apiYear: requests[0].year, manualChoicePersists: true, resetAndSamples: true, emptyLegacyDraftMigrated: true, savedDataYearPreserved: true, newAddressUsesLatest: true, errors }, null, 2));
} finally { await browser.close(); }
