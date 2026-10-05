import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { annualGrowth, buildAccidentReport, reportCell } from '../lib/accidentReport.js';
import { buildReportWorkbook } from '../lib/accidentReportExcel.js';

const snapshot = { year: '2024', years: '3', radius: '500', address: '서울특별시 노원구 중계로', intersections: [{ name: '가 교차로', radius: '100' }, { name: '나 교차로', radius: '100' }] };
const radius = (year, type, extra = {}) => ({ kind: 'radius', query: { year, type }, state: 'success', data: { counts: { accidents: 10, deaths: 1, serious: 2, minor: 8, reported: 0, casualties: 12 }, qualityWarnings: ['원문 합계 확인 필요'] }, ...extra });
const official = (year, accidents) => ({ kind: 'official', query: { year }, state: 'success', data: { sections: { statistics: { status: 'success', rows: [{ std_year: year, acc_cl_nm: '전체사고', sido_sgg_nm: '서울특별시 노원구', acc_cnt: accidents, dth_dnv_cnt: '0', injpsn_cnt: '1,234' }, { std_year: year, acc_cl_nm: '보행자사고', sido_sgg_nm: '서울특별시 노원구', acc_cnt: 999 }] } } } });
const records = [official(2022, 100), official(2023, 110), official(2024, 121), radius(2024, 'all'), radius(2024, 'pedestrian'), radius(2024, 'bicycle'), radius(2024, 'all', { intersection: 1, data: { counts: { accidents: 0, deaths: 0, serious: 0, minor: 0, reported: 0 } } }), radius(2024, 'all', { intersection: 2, state: 'error', message: 'TAAS 연결 실패' })];

test('report follows source columns, keeps annual scope separate and uses only overall statistics', () => {
  const tables = buildAccidentReport(records, snapshot);
  const annual = tables[0];
  assert.equal(annual.title, '서울특별시 노원구 교통사고 발생현황');
  assert.deepEqual(annual.rows[0].values, ['2022년', 100, 0, 1234]);
  assert.equal(reportCell(annual.rows.at(-1).values[1], true), '10.00%');
  assert.equal(annual.rows.at(-1).values[2], null);
  const nearby = tables.find(t => t.id === 'nearby');
  assert.deepEqual(nearby.rows.at(-1).values, ['2024년', 10, 1, 2, 8, 0, '미수집', '미수집', '미수집']);
  assert.equal(nearby.headers.find(h => h.label === '사고유형(건)').colSpan, 3);
  assert.equal(tables.filter(t => t.id.startsWith('vulnerable')).length, 3);
  assert.ok(nearby.notes.some(s => s.includes('원문 합계 확인')));
});

test('missing years, no data and API failure never become zero or a computable growth rate', () => {
  const tables = buildAccidentReport([official(2022, 100), official(2024, 121)], snapshot);
  assert.deepEqual(tables[0].rows[1].values, ['2023년', null, null, null]);
  assert.equal(tables[0].rows.at(-1).values[1], null);
  assert.equal(annualGrowth([0, 1], [2023, 2024]), null);
  assert.equal(annualGrowth([100], [2024]), null);
  assert.equal(annualGrowth([100, 0], [2023, 2024]), -1);
  assert.equal(reportCell(null, true), '산정 불가');
  assert.ok(buildAccidentReport([], snapshot)[0].notes.some(s => s.includes('미조회')));
});

test('verified zero intersections become footnotes while failed intersections stay visible', () => {
  const table = buildAccidentReport(records, snapshot).find(t => t.id === 'intersections');
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.rows[0].values.slice(0, 3), ['②', '나 교차로', null]);
  assert.ok(table.notes.some(s => s.includes('① 가 교차로') && s.includes('조회 완료 0건')));
  assert.ok(table.notes.some(s => s.includes('② 나 교차로') && s.includes('TAAS 연결 실패')));
  assert.ok(!table.notes.some(s => s.startsWith('주 :') && s.includes('나 교차로')));
});

test('duplicate and wrong-year municipal statistics are not silently chosen', () => {
  const duplicate = official(2024, 10);
  duplicate.data.sections.statistics.rows.push({ ...duplicate.data.sections.statistics.rows[0] });
  const table = buildAccidentReport([duplicate], { ...snapshot, years: '1' })[0];
  assert.equal(table.rows[0].values[1], null);
  assert.ok(table.notes.some(s => s.includes('중복 통계')));
});

test('export round trip preserves report merges, numeric cells, rate formulas, styles, print area and raw evidence', async () => {
  const tables = buildAccidentReport(records, snapshot);
  const raw = new Map([['사업지 주변', [{ 사고건수: 10, '사상자(TAAS 표기)': 12, 원문검산: '원문 합계 확인 필요', 상태: 'success' }]]]);
  const book = buildReportWorkbook(ExcelJS, tables, raw);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await book.xlsx.writeBuffer());
  assert.equal(loaded.worksheets[0].name, '보고서_지역별');
  const annual = loaded.getWorksheet('보고서_지역별');
  assert.equal(annual.getCell('B5').value, 100);
  assert.ok(annual.getCell('B8').value.formula.includes('COUNT(B5:B7)=3'));
  assert.ok(Math.abs(annual.getCell('B8').value.result - .1) < 1e-10);
  assert.equal(annual.getCell('B8').numFmt, '0.00%');
  assert.equal(annual.getCell('C8').value, '산정 불가');
  const nearby = loaded.getWorksheet('보고서_사업지주변');
  assert.equal(nearby.getCell('I4').master.address, 'G4');
  assert.equal(nearby.getCell('A5').master.address, 'A4');
  assert.equal(nearby.getCell('B8').value, 10);
  assert.equal(nearby.getCell('G8').value, '미수집');
  assert.equal(nearby.getCell('B4').fill.fgColor.argb, 'FFF0F0F0');
  assert.equal(nearby.getCell('B8').border.bottom.style, 'thin');
  assert.ok(nearby.pageSetup.printArea.startsWith('A1:I'));
  assert.equal(loaded.getWorksheet('사업지 주변').getCell('B2').value, 12);
});
