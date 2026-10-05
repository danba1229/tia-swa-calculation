import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import proj4 from 'proj4';
import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { TAAS_URL, validateAccidentQuery, parseRadiusResult, radiusQualityWarnings } from './accidentSurvey.js';

const EPSG5181 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs';
const cache = new Map();
let running = false;

export async function surveyTaas(input) {
  const query = validateAccidentQuery(input), key = JSON.stringify(query);
  const saved = cache.get(key);
  if (saved?.expires > Date.now()) return { ...saved.result, cached: true };
  if (running) throw new Error('다른 TAAS 조사가 진행 중입니다. 잠시 후 다시 조회해 주세요.');
  running = true;
  let browser, page, stage = '연결';
  const alerts = [];
  try {
    browser = await playwright.launch(process.platform === 'win32'
      ? { channel: 'msedge', headless: true }
      : { args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('dialog', async d => {
      alerts.push(d.message());
      if (d.type() === 'confirm' && d.message().trim() === '업로드 하시겠습니까?') await d.accept();
      else await d.dismiss();
    });
    await page.goto(TAAS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.getByRole('link', { name: '사고 반경분석', exact: true }).click();
    stage = '검색 조건 설정';
    // TAAS populates these options asynchronously after the panel opens.
    await page.locator('#ptsRdeYearStart option').first().waitFor({ state: 'attached' });
    const years = await page.locator('#ptsRdeYearStart option').evaluateAll(es => es.map(e => e.value));
    if (!years.includes(String(query.year))) throw new Error(`TAAS에서 ${query.year}년 자료를 제공하지 않습니다.`);
    await page.locator('#ptsRdeYearStart').selectOption(String(query.year));
    await page.locator('#ptsRdeYearEnd').selectOption(String(query.year));
    await page.getByRole('group', { name: '검색어', exact: true }).getByRole('textbox').fill(String(query.radius));
    const severity = page.locator('input[name="ACDNT_GAE_CODE"]:visible');
    if (await severity.count() !== 4) throw new Error('TAAS 사고 심각도 설정 화면이 변경되었습니다.');
    for (const checkbox of await severity.all()) await checkbox.check();
    await page.locator('#ptsRdeSimpleCondition').selectOption({ all: '00', pedestrian: '38', bicycle: '33' }[query.type]);
    const marker = `TIA_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const xy = proj4('EPSG:4326', EPSG5181, [query.lng, query.lat]).map(n => Math.round(n * 100) / 100);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['장소', 'X좌표', 'Y좌표'], [marker, ...xy]]), '조사지점');
    stage = '좌표 업로드';
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('link', { name: '엑셀 업로드', exact: true }).click();
    await (await chooserPromise).setFiles({ name: 'tia-radius.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    await page.getByText(/파일명\s*:\s*tia-radius\.xlsx/).waitFor();
    stage = '반경 조회';
    await page.locator('.btn-search2:visible').click();
    const card = page.locator('li.iStyle_R').filter({ hasText: marker });
    await card.waitFor({ state: 'visible', timeout: 65000 });
    const evidence = await card.innerText();
    const counts = parseRadiusResult(evidence, marker, xy);
    const result = { query, counts, qualityWarnings: radiusQualityWarnings(counts), source: '한국도로교통공단 TAAS 사고 반경분석', sourceUrl: TAAS_URL, retrievedAt: new Date().toISOString(), coordinateSystem: 'EPSG:5181', projectedCoordinate: xy, evidence, alerts, cached: false };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { result, expires: Date.now() + 3600000 });
    return result;
  } catch (error) {
    // Do not return stack traces, request URLs, or browser internals to clients.
    if (/TAAS|환경변수/.test(error.message) && !error.message.includes('Call log:')) throw error;
    throw new Error(`TAAS ${stage}에 실패했습니다. 잠시 후 다시 시도해 주세요. 실패한 조사는 0건으로 처리하지 않습니다.`);
  } finally { await browser?.close().catch(() => {}); running = false; }
}
