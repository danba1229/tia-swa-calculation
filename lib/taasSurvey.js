import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import proj4 from 'proj4';
import * as XLSX from 'xlsx';
import { randomUUID } from 'node:crypto';
import { TAAS_URL, COLLISION_TYPES, collisionFilterValues, validateAccidentQuery, parseRadiusResult, radiusQuality } from './accidentSurvey.js';
import { createTaasBrowserSession, taasErrorDetail, taasRuntimeStats } from './taasBrowser.js';

const EPSG5181 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs';
const cache = new Map();
let running = false;
const instanceId = randomUUID().slice(0, 8);

export async function surveyTaas(input) {
  const query = validateAccidentQuery(input), key = JSON.stringify(query);
  const saved = cache.get(key);
  if (saved?.expires > Date.now()) return { ...saved.result, cached: true };
  if (running) throw new Error('다른 TAAS 조사가 진행 중입니다. 잠시 후 다시 조회해 주세요.');
  running = true;
  let session, page, stage = '브라우저 실행';
  const traceId = randomUUID().slice(0, 8), started = Date.now();
  const trace = (event, extra = {}) => {
    const entry = JSON.stringify({ event: `taas.${event}`, instanceId, traceId, stage, year: query.year, type: query.type, radius: query.radius, elapsedMs: Date.now() - started, ...taasRuntimeStats(), ...extra });
    if (event === 'error' || event === 'cleanup-error') console.error(entry); else console.log(entry);
  };
  let resourceFailure = null;
  const alerts = [];
  try {
    trace('start');
    session = await createTaasBrowserSession({ playwright, chromium, onCleanupError: error => trace('cleanup-error', taasErrorDetail(error)) });
    stage = '조회 화면 생성';
    page = await session.context.newPage();
    page.on('requestfailed', request => {
      if (/ERR_INSUFFICIENT_RESOURCES|ENOSPC/.test(request.failure()?.errorText || '')) resourceFailure = 'RESOURCE_EXHAUSTED';
    });
    page.setDefaultTimeout(25000);
    page.on('dialog', async d => {
      alerts.push(d.message());
      if (d.type() === 'confirm' && d.message().trim() === '업로드 하시겠습니까?') await d.accept();
      else await d.dismiss();
    });
    stage = '첫 화면 접속';
    const response = await page.goto(TAAS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response && !response.ok()) throw new Error(`TAAS 첫 화면 HTTP ${response.status()}`);
    stage = '반경분석 메뉴 열기';
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
    await page.locator('#ptsRdeSimpleCondition').selectOption({ pedestrian: '38', bicycle: '33' }[query.type] || '00');
    let selectedCollisionCodes = null;
    if (Object.hasOwn(COLLISION_TYPES, query.type)) {
      stage = `${COLLISION_TYPES[query.type]} 사고유형 설정`;
      await page.locator('#ptsRde-ACDNT_CODE > a').click();
      const options = page.locator('#ptsRdeCh2AccidentType input[name="ACDNT_CODE"]');
      await options.first().waitFor({ state: 'visible' });
      selectedCollisionCodes = collisionFilterValues(await options.evaluateAll(es => es.map(e => ({ value: e.value, title: e.title }))), query.type);
      // TAAS propagates parent toggles to children and expands historical codes on search.
      await page.locator('#ptsRde-ACDNT_CODE .btn-cancle').click();
      for (const code of selectedCollisionCodes) await page.locator(`#ptsRdeCh2AccidentType input[name="ACDNT_CODE"][value="${code}"]`).check();
      const checked = await options.evaluateAll(es => es.filter(e => e.checked).map(e => e.value).sort());
      if (JSON.stringify(checked) !== JSON.stringify([...selectedCollisionCodes].sort())) throw new Error('TAAS 사고유형 선택 검증 실패');
      await page.locator('#ptsRde-ACDNT_CODE .btn-ok').click();
    }
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
    const quality = radiusQuality(counts);
    const result = { query, counts, qualityWarnings: quality.warnings, qualityNotes: quality.notes, calculatedInjuries: quality.injuries, calculatedCasualties: quality.total, selectedCollisionCodes, source: '한국도로교통공단 TAAS 사고 반경분석', sourceUrl: TAAS_URL, retrievedAt: new Date().toISOString(), coordinateSystem: 'EPSG:5181', projectedCoordinate: xy, evidence, alerts, cached: false };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { result, expires: Date.now() + 3600000 });
    trace('success');
    return result;
  } catch (error) {
    const detail = taasErrorDetail(error);
    trace('error', { ...detail, category: resourceFailure || detail.category });
    // Do not return stack traces, request URLs, or browser internals to clients.
    if (/TAAS|환경변수/.test(error.message) && !error.message.includes('Call log:')) throw error;
    throw new Error(`TAAS ${stage}에 실패했습니다. 잠시 후 다시 시도해 주세요. 실패한 조사는 0건으로 처리하지 않습니다.`);
  } finally {
    try { await session?.close(); }
    finally { running = false; trace('closed'); }
  }
}
