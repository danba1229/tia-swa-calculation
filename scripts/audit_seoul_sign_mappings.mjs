import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { loadSignSnapshot } from '../lib/server/seoulSigns.js';
import { classifySign } from '../lib/signClassification.js';

const output = new URL('../docs/sign-code-verification/', import.meta.url);
const { rows } = await loadSignSnapshot();
const totals = {}, pending = [], labels = [], exclusions = new Map(), omitted = new Map(), dimensions = new Map();
const codes = new Map(), remarks = new Map();
for (const [id, lat, lng, code, , , rawRemark] of rows) {
  const source = id[0], remark = rawRemark || '';
  const result = classifySign({ id, label: id.slice(2), source, lat, lng, sourceIndex: code, sourceRemark: remark });
  const state = result.ignored ? 'excluded' : result.displayOnly ? 'text' : result.policeCode ? result.mappingBasis : 'unmapped';
  const key = `${source}:${state}`;
  totals[key] = (totals[key] || 0) + 1;
  if (source !== 'S') continue;
  const record = [code, id.slice(2), remark, lat, lng, result.roadviewUrl];
  if (state === 'text') labels.push(record);
  if (state === 'excluded') exclusions.set(code, (exclusions.get(code) || 0) + 1);
  for (const number of result.omittedPoliceCodes) omitted.set(number, (omitted.get(number) || 0) + 1);
  if (!result.ignored && result.policeCodes.some(number => ['220', '221', '222'].includes(number))) {
    dimensions.set(result.policeCode, (dimensions.get(result.policeCode) || 0) + 1);
  }
  if (state !== 'unmapped') continue;
  pending.push(record);
  codes.set(code, (codes.get(code) || 0) + 1);
  const remarkKey = JSON.stringify([code, remark]);
  if (!remarks.has(remarkKey)) remarks.set(remarkKey, { code, remark, count: 0, sample: record });
  remarks.get(remarkKey).count++;
}
assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), rows.length);
assert.equal([...exclusions.values()].reduce((a, b) => a + b, 0), totals['S:excluded']);
const numeric = (a, b) => a[0].localeCompare(b[0], 'en', { numeric: true });
const summary = [
  ['안전표지 S 전체', rows.filter(r => r[0][0] === 'S').length],
  ['사용자 지정 번호', totals['S:user'] || 0], ['번호 일치 후보', totals['S:code-match'] || 0],
  ['사용자 지정 문구 일방(번호 없음)', labels.length], ['표시 제외', totals['S:excluded'] || 0],
  ['표시 대상 미매핑 안전표지', pending.length], ['도로안내표지 R(별도)', totals['R:unmapped'] || 0],
];
const headers = {
  codes: ['서울시 코드', '미연결 건수'],
  remarks: ['서울시 코드', '원본 비고', '건수', '대표 관리번호', '위도', '경도', '로드뷰'],
  records: ['서울시 코드', '관리번호', '원본 비고', '위도', '경도', '로드뷰'],
};
const codeRows = [...codes].sort(numeric);
const remarkRows = [...remarks.values()].sort((a, b) => b.count - a.count).map(g => [g.code, g.remark, g.count, g.sample[1], g.sample[3], g.sample[4], g.sample[5]]);
const excludedRows = [...exclusions].sort(numeric), omittedRows = [...omitted].sort(numeric), dimensionRows = [...dimensions].sort(numeric);
async function csv(name, header, data) {
  const cell = value => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  await writeFile(new URL(name, output), '\uFEFF' + [header, ...data].map(row => row.map(cell).join(',')).join('\n') + '\n');
}
await csv('remaining-mappings-2026-10-13.csv', headers.codes, codeRows);
await csv('remaining-remarks-2026-10-13.csv', headers.remarks, remarkRows);
const workbook = new ExcelJS.Workbook();
const sheets = [
  ['집계', ['구분', '건수'], summary], ['코드별 잔여', headers.codes, codeRows],
  ['비고별 잔여', headers.remarks, remarkRows], ['지점별 잔여', headers.records, pending],
  ['일방 표시', headers.records, labels], ['코드별 제외', ['서울시 코드', '제외 지점수'], excludedRows],
  ['보조번호 생략', ['경찰청 번호', '생략 지점수(복합 중복 포함)'], omittedRows],
  ['중량 높이 폭', ['표시 번호', '지점수'], dimensionRows],
];
for (const [name, header, data] of sheets) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(header); sheet.addRows(data);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.length + 1, column: header.length } };
  sheet.columns.forEach((column, index) => { column.width = /비고|로드뷰/.test(header[index]) ? 62 : 28; });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18314B' } };
}
const xlsx = new URL('remaining-mappings-2026-10-13.xlsx', output);
await workbook.xlsx.writeFile(fileURLToPath(xlsx));
const check = new ExcelJS.Workbook(); await check.xlsx.readFile(fileURLToPath(xlsx));
for (const [name, , data] of sheets) assert.equal(check.getWorksheet(name).rowCount - 1, data.length, name);
const n = value => value.toLocaleString('ko-KR');
const lines = ['# 표지판 표시 규칙 및 잔여 집계 — 2026-10-13 최종 지정', '',
  '사용자가 중량·높이·폭 제한의 수치와 무관한 번호화, 나머지 미매핑 안전표지의 표시 제외, 해제·견인지역 외 보조표지의 기본 제외를 지정했다. 이전 보고서의 보류 판단보다 이 표시 규칙이 우선한다. 원본 자료는 삭제하지 않았다.', '',
  '## 현재 집계', '', '| 구분 | 건수 |', '|---|---:|', ...summary.map(([label, count]) => `| ${label} | ${n(count)} |`), '',
  `표시 대상의 미매핑 안전표지는 **${n(pending.length)}건**이다. 이는 모든 지점의 도안을 검증했다는 뜻이 아니다. 미확인 항목을 사용자 지시에 따라 표시 제외한 결과다. ‘일방’ ${n(labels.length)}건은 기존 승인 문구를 유지하며, 도로안내표지 R은 경찰청 안전표지와 별도이므로 ? 표시를 유지한다.`, '',
  '## 최종 표시 규칙', '',
  '- 차량 중량 220 / 높이 221 / 폭 222. 여러 항목이 명시되면 함께 표시한다. 제한 숫자는 종류 번호에 영향을 주지 않으며 실제 수치·서울시 코드·원본 비고를 보존한다. 220-1~220-8은 기존 서울시 속도 계열이므로 승인된 224 연결을 유지한다.',
  '- 단위 없는 수치나 높이/폭이 명시되지 않은 m 수치는 치수 종류로 추정하지 않는다. 도로폭·노폭·폭좁아짐은 차량 폭 제한으로 바꾸지 않는다.',
  '- 경찰청 일람표의 400번대 보조표지는 해제 427·견인지역 428만 유지한다. 407의4·415의2 같은 하위 번호도 제외 대상이다. 번호가 이미 연결되어 있던 보조표지에도 동일하게 적용한다.',
  '- 복합 표지는 제외 대상 보조번호만 제거한다. 예: 224,415 → 224 / 324,418,415 → 324 / 324,427 → 유지. 보조번호만 남은 판은 지점을 숨긴다.',
  '- 서울시 원본 비고에 명시된 해제·견인지역 문구는 예외 번호를 유지하고 나머지 미지정 성분을 추가 추정하지 않는다. 예: 주차금지,견인지역통합판 → 428. 무단주차시견인이라는 문구만으로 견인지역을 생성하지 않는다.',
  '- 그 밖의 미매핑 안전표지는 전부 표시 제외한다. 이 정책이 원본을 공식 보조표지로 재분류한다는 뜻은 아니다. 기존에 승인된 주의·규제·지시 번호와 일방 문구는 유지한다.',
  '- 공통 분류 결과를 지도·표·선택 목록에 적용하며, 모든 표시 지점은 파란색과 추가 확인 안내를 유지한다. 경찰청 일람표 원본은 참고자료로 계속 표시한다.', '',
  '## 중량·높이·폭 표시 집계', '', '| 표시 번호 | 지점수 |', '|---|---:|', ...dimensionRows.map(([code, count]) => `| ${code} | ${n(count)} |`), '',
  '## 생략한 보조번호', '', '복합 표지에 여러 보조번호가 있으면 각 번호에 중복 집계한다. 따라서 아래 합계는 제외된 지점 수와 다르다.', '',
  '| 경찰청 번호 | 생략 지점수 |', '|---|---:|', ...omittedRows.map(([code, count]) => `| ${code} | ${n(count)} |`), '',
  '## 전체 파일', '',
  '[엑셀: 집계·잔여·일방·코드별 제외·보조번호 생략·중량 높이 폭](remaining-mappings-2026-10-13.xlsx) · [잔여 코드 CSV](remaining-mappings-2026-10-13.csv) · [잔여 비고 CSV](remaining-remarks-2026-10-13.csv)', '',
  '잔여 0건이면 잔여 시트/CSV에는 헤더만 있다. 제외 수량과 종류는 엑셀의 별도 시트에 남긴다. 원본 지점은 data/signs/seoul-signs.json.gz에 보존한다.', '',
  '출처: 앱 채택 서울시 안전표지 원본과 경찰청 교통안전시설 일람표 2023.12 시행판. 사용자 지정 표시 정책이며 실제 표지의 추가 확인이 필요하다. 현재 PR 작업으로 main 병합·운영 배포 전이다.'];
await writeFile(new URL('remaining-mappings-2026-10-13.md', output), lines.join('\n') + '\n');
console.log(JSON.stringify({ totals, pending: pending.length, labels: labels.length, dimensions: Object.fromEntries(dimensions), filesVerified: true }, null, 2));
