// Run against a local Next server: node scripts/check_workspace_ui.mjs http://127.0.0.1:3002
// Uses an isolated browser profile; downloads and screenshots stay in the ignored results directory.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import serverChromium from '@sparticuz/chromium';
import * as XLSX from 'xlsx';

const base = process.argv[2] || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a local server; this check edits an isolated survey draft.');
const output = '.preview-test-results';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: serverChromium.args.filter(arg => arg !== '--single-process'), executablePath: await serverChromium.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
const key = 'tia-research-builder-next-v3-kosis';
const nav = page.getByRole('navigation', { name: '조사 항목' });
const chooseStep = index => nav.getByRole('button').nth(index).click();
const views = page.getByRole('group', { name: '작업 화면 보기' });
async function noPageOverflow(label) {
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(sizes.scroll <= sizes.width + 1, `${label}: page overflow ${JSON.stringify(sizes)}`);
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  assert.equal(await nav.getByRole('button').count(), 10);
  await page.getByRole('button', { name: '조사 시작', exact: true }).click();
  await page.getByText('주소지를 먼저 입력해 주세요.', { exact: true }).waitFor();
  checks.push('Empty-address validation still runs from the primary action');

  await chooseStep(1);
  const roadInput = page.getByPlaceholder('예: 경수대로').first();
  await roadInput.fill('디자인 회귀검증 도로');
  const originalRows = await page.locator('.road-table tbody tr').count();
  await page.getByRole('button', { name: '도로 추가', exact: true }).click();
  assert.equal(await page.locator('.road-table tbody tr').count(), originalRows + 1);
  await page.locator('.road-table tbody tr').last().getByRole('button', { name: '삭제', exact: true }).click();
  assert.equal(await page.locator('.road-table tbody tr').count(), originalRows);
  checks.push('Road editing, add and delete preserve the original rows');

  for (let index = 1; index <= 8; index++) {
    await chooseStep(index);
    assert.equal(await nav.getByRole('button').nth(index).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.workspace-results > .step-section:visible').count(), 1, `Step ${index} isolation`);
    await noPageOverflow(`step ${index}`);
  }
  await chooseStep(0);
  assert.equal(await page.locator('.workspace-results > .step-section:visible').count(), 8);
  assert.equal(await roadInput.inputValue(), '디자인 회귀검증 도로');
  checks.push('All eight steps and all-results navigation preserve entered data');

  // DOM identity matters: replacing the map node would destroy SDK layers and selection.
  await page.evaluate(() => { window.__workspaceMapNode = document.getElementById('scope-map'); });
  const splitWidth = (await page.locator('.workspace-results').boundingBox()).width;
  await views.getByRole('button', { name: '표 넓게 보기', exact: true }).click();
  assert.equal(await page.locator('.project-panel').isVisible(), false);
  assert.ok((await page.locator('.workspace-results').boundingBox()).width > splitWidth + 200);
  await views.getByRole('button', { name: '분할 보기', exact: true }).click();
  assert.equal(await page.locator('#scope-map').isVisible(), true);
  await page.getByLabel('버스정류장 표시', { exact: true }).uncheck();
  await views.getByRole('button', { name: '지도 보기', exact: true }).click();
  await page.getByRole('button', { name: '기본 화면으로', exact: true }).waitFor();
  assert.equal(await page.locator('.workspace-results').isVisible(), false);
  const bounds = await page.locator('.project-panel').boundingBox();
  assert.ok(bounds.width >= 1598 && bounds.height >= 1048);
  await page.keyboard.press('Escape');
  await page.locator('.workspace-results').waitFor();
  assert.equal(await page.getByLabel('버스정류장 표시', { exact: true }).isChecked(), false);
  assert.ok(await page.evaluate(() => window.__workspaceMapNode === document.getElementById('scope-map')));
  assert.equal(await roadInput.inputValue(), '디자인 회귀검증 도로');
  checks.push('Split/table/full-map modes, Escape, map DOM identity and layer toggles');

  await chooseStep(3);
  await page.getByPlaceholder('면적 입력').first().fill('1234.5');
  await page.getByLabel('토지이용 출처', { exact: true }).fill('브라우저 회귀검증 예시');
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '엑셀 출력', exact: true }).click();
  const xlsx = await xlsxDownload;
  const xlsxPath = `${output}/workspace-export.xlsx`;
  await xlsx.saveAs(xlsxPath);
  const workbook = XLSX.read(await readFile(xlsxPath));
  assert.equal(workbook.SheetNames.length, 4);
  const cells = XLSX.utils.sheet_to_json(workbook.Sheets['지목별 토지이용현황'], { header: 1 });
  assert.ok(cells.some(row => row.includes(1234.5)));
  assert.ok(cells.some(row => row.includes('브라우저 회귀검증 예시')));
  checks.push('Real XLSX export contains the edited area, source and four sheets');

  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '조사 백업', exact: true }).click();
  const backup = await backupDownload;
  const backupPath = `${output}/workspace-backup.json`;
  await backup.saveAs(backupPath);
  const saved = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(saved.drafts[key].roads[0].name, '디자인 회귀검증 도로');
  assert.equal(Number(saved.drafts[key].landuseAreas['전']), 1234.5);
  await chooseStep(1);
  await roadInput.fill('복원 전 수정값');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('조사 백업 복원', { exact: true }).setInputFiles(backupPath);
  await page.waitForFunction(() => document.querySelector('input[placeholder="예: 경수대로"]')?.value === '디자인 회귀검증 도로');
  await page.waitForFunction(async (draftKey) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tia-survey-drafts', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise(resolve => { const r = db.transaction('drafts').objectStore('drafts').get(draftKey); r.onsuccess = () => resolve(r.result?.value?.roads?.[0]?.name === '디자인 회귀검증 도로'); r.onerror = () => resolve(false); }); } finally { db.close(); }
  }, key);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('input[placeholder="예: 경수대로"]')?.value === '디자인 회귀검증 도로');
  checks.push('JSON backup, confirmed restore and IndexedDB persistence after reload');

  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await chooseStep(step);
      await noPageOverflow(`${width}px, step ${step}`);
    }
    await chooseStep(2);
    await page.evaluate(() => window.scrollTo(0, 0));
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/workspace-${width}.png`, fullPage: true });
  }
  checks.push('Seven desktop/tablet/mobile widths × eight steps without page overflow');

  await page.setViewportSize({ width: 390, height: 844 });
  await views.getByRole('button', { name: '지도 보기', exact: true }).click();
  await page.getByRole('button', { name: '기본 화면으로', exact: true }).click();
  assert.equal(await views.isVisible(), true);
  await page.goto(`${base}/embed`, { waitUntil: 'networkidle' });
  await noPageOverflow('mobile embed');
  await views.getByRole('button', { name: '표 넓게 보기', exact: true }).click();
  assert.equal(await page.locator('.project-panel').isVisible(), false);
  await views.getByRole('button', { name: '지도 보기', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.workspace-results').isVisible(), true);
  checks.push('Mobile and embedded map fullscreen/return and table mode');

  await page.goto(`${base}/indicator`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.research-workspace').count(), 0);
  await page.getByRole('button', { name: '로그인', exact: true }).first().waitFor();
  await noPageOverflow('calculator login');
  assert.deepEqual(errors, []);
  checks.push('Calculator login stays separate; no uncaught browser errors');
  await writeFile(`${output}/workspace-ui-validation.json`, JSON.stringify({ passed: true, base, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
