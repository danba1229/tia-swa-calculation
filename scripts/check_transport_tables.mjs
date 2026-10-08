// Isolated browser check of transport display and actual CSV download.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import c from '@sparticuz/chromium';
import * as XLSX from 'xlsx';
const base = process.argv[2] || 'http://127.0.0.1:3006';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
await mkdir('.preview-test-results', { recursive: true });
const browser = await chromium.launch({ args: c.args.filter(arg => arg !== '--single-process'), executablePath: await c.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
const route = { busRouteId: '100000001', routeName: '470', routeType: '간선', startStation: '기점', endStation: '종점', originFirstBusTime: '2026-10-02 04:30:00', originLastBusTime: '2026-10-02 23:10:00', terminalFirstBusTime: '05:00', terminalLastBusTime: '25:10', endpointTimeBasis: '서울 노선 기점 · 일치 종점 정류소 운행시간(요일 구분 미제공)' };
const stops = [
  { id: 'a', arsId: '22863', stationId: '1', stationName: '서초구청', distanceMeters: 10, latitude: 37.4, longitude: 127.1, location: '37.4, 127.1', routes: [], routeError: '공식 파일에 연결된 노선 없음 · 수동 확인 필요' },
  { id: 'b', arsId: '00123', stationId: '2', stationName: '서울역', distanceMeters: 20, routes: [route] },
  { id: 'c', arsId: '00234', stationId: '3', stationName: '시청', distanceMeters: 30, routes: [route] },
];
const stations = [
  { id: 's1', stationName: '시청역', line: '1호선', distanceMeters: 10, status: 'SUCCESS', subwayStationId: 'S1', schedules: [{ day: '평일', direction: '상행', destination: '소요산', trainType: '미제공', firstTime: '05:30', lastTime: '익일 01:15' }] },
  { id: 's2', stationName: '코드누락역', line: '2호선', distanceMeters: 20, status: 'MANUAL_REQUIRED', codeStatus: 'NOT_FOUND', error: '일치하는 공식 역·노선 코드 없음 · 수동 확인 필요', schedules: [] },
];
const errors = [];
try {
  await context.route('**/api/**', async intercepted => {
    const path = new URL(intercepted.request().url()).pathname;
    const send = data => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/geocode') return send({ success: true, x: 127.03, y: 37.48, latitude: 37.48, longitude: 127.03, matchedAddress: '서울특별시 서초구 남부순환로 2584' });
    if (path === '/api/address-suggestions') return send({ success: true, suggestions: [] });
    if (path === '/api/seoul-bus') return send({ success: true, busStops: stops, summary: { returnedCount: 3 }, source: '서울시 공식 파일', sourceDate: '2026-09-02' });
    if (path === '/api/seoul-bus/details') return send({ success: true, updates: [{ busRouteId: route.busRouteId, detail: route, stationTimes: [], fetchedAt: '2026-10-08' }] });
    if (path === '/api/subway') return send({ success: true, stations, source: '국토교통부 TAGO' });
    if (path === '/api/seoul-bike') return send({ success: true, stations: [], summary: { returnedCount: 0 } });
    if (path.startsWith('/api/traffic-volume')) return send({ months: [] });
    return send({ success: false, message: 'Unrelated fixture' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: '주소지', exact: true }).fill('서울특별시 서초구 남부순환로 2584');
  await page.getByRole('navigation', { name: '조사 항목' }).getByRole('button').nth(5).click();
  await page.getByRole('button', { name: '교통시설 조회', exact: true }).click();
  const stopTable = page.locator('.bus-stop-table');
  await stopTable.getByText('서초구청(22863)', { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '교통시설 조회' && !button.disabled));
  assert.deepEqual(await stopTable.locator('th').allTextContents(), ['정류장명(정류장번호)', '거리', '정차노선수', '정류장명(정류장번호)', '거리', '정차노선수']);
  assert.equal(await stopTable.locator('tbody tr').count(), 2);
  assert.deepEqual(await stopTable.locator('tbody tr').first().locator('td').allTextContents(), ['서초구청(22863)', '10m', '수동확인필요', '서울역(00123)', '20m', '1']);
  assert.equal(await stopTable.locator('tbody tr').last().locator('td[colspan="3"]').count(), 1);
  const busSection = page.locator('.subpanel').filter({ has: page.getByRole('heading', { name: '버스정류장', exact: true }) });
  assert.match(await busSection.locator('.subpanel-header').innerText(), /공식 파일에 연결된 노선 없음/);
  assert.doesNotMatch(await stopTable.innerText(), /위도|경도|공식 파일|37\.4/);
  const routesSection = page.locator('.subpanel').filter({ has: page.getByRole('heading', { name: '정류장별 경유 버스노선', exact: true }) });
  const routeCells = await routesSection.locator('tbody tr').nth(1).locator('td').allTextContents();
  assert.deepEqual(routeCells.slice(4, 6), ['04:30', '23:10']);
  assert.equal(routeCells[8], '25:10');
  assert.doesNotMatch(await routesSection.locator('tbody').innerText(), /2026-10-02|수동 확인/);
  const subway = page.locator('.subpanel').filter({ has: page.getByRole('heading', { name: '지하철역 · 운행일/행선지별 첫차·막차', exact: true }) });
  assert.match(await subway.locator('.subpanel-header').innerText(), /공식 역·노선 코드 없음/);
  assert.doesNotMatch(await subway.locator('tbody').innerText(), /수동 확인|미제공/);
  assert.match(await subway.locator('tbody').innerText(), /익일 01:15/);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.step-section:visible').getByRole('button', { name: 'CSV 다운로드', exact: true }).click();
  const download = await downloadPromise;
  const file = '.preview-test-results/transport-tables.csv';
  await download.saveAs(file);
  const content = await readFile(file, 'utf8');
  const workbook = XLSX.read(content, { type: 'string', raw: true });
  const csv = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, blankrows: true });
  const start = csv.findIndex(row => row[0] === '정류장명(정류장번호)');
  assert.deepEqual(csv[start], ['정류장명(정류장번호)', '거리', '정차노선수']);
  assert.deepEqual(csv.slice(start + 1, start + 4).map(row => row[0]), ['서초구청(22863)', '서울역(00123)', '시청(00234)']);
  assert.ok(csv.slice(start + 1, start + 4).every(row => row.length === 3));
  assert.ok(content.includes('04:30') && !content.includes('2026-10-02'));
  assert.ok(content.includes('공식 파일에 연결된 노선 없음'));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await stopTable.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `.preview-test-results/transport-tables-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, pairedStops: true, oddStopPadding: true, missingReasonsInHeaders: true, timesOnly: true, oneStopPerCsvRow: true, mobileNoPageOverflow: true, fixtures: true };
  await writeFile('.preview-test-results/transport-tables-validation.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
