import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { loadSignSnapshot } from '../lib/server/seoulSigns.js';
import { classifySign } from '../lib/signClassification.js';

const output = new URL('../docs/sign-code-verification/', import.meta.url);
const { rows } = await loadSignSnapshot();
const totals = {}, codes = new Map(), remarks = new Map(), pending = [], labels = [];
for (const [id, lat, lng, code, , , rawRemark] of rows) {
  const source = id[0], remark = rawRemark || '';
  const result = classifySign({ id, label: id.slice(2), source, lat, lng, sourceIndex: code, sourceRemark: remark });
  const state = result.ignored ? 'excluded' : result.displayOnly ? 'text' : result.policeCode ? result.mappingBasis : 'unmapped';
  const key = `${source}:${state}`;
  totals[key] = (totals[key] || 0) + 1;
  const record = [code, id.slice(2), remark, lat, lng, result.roadviewUrl];
  if (source === 'S' && state === 'text') labels.push(record);
  if (source !== 'S' || state !== 'unmapped') continue;
  pending.push(record);
  if (!codes.has(code)) codes.set(code, { code, count: 0, blank: 0, remarks: new Map() });
  const group = codes.get(code);
  group.count++;
  if (!remark.trim()) group.blank++;
  group.remarks.set(remark, (group.remarks.get(remark) || 0) + 1);
  const remarkKey = JSON.stringify([code, remark]);
  if (!remarks.has(remarkKey)) remarks.set(remarkKey, { code, remark, count: 0, sample: record });
  remarks.get(remarkKey).count++;
}
assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), rows.length);
const groups = [...codes.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
const remarkGroups = [...remarks.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || b.count - a.count);
assert.equal(groups.reduce((sum, g) => sum + g.count, 0), pending.length);
assert.equal(remarkGroups.reduce((sum, g) => sum + g.count, 0), pending.length);
const descriptions = new Map();
const review = await readFile(new URL('500-series-review.md', output), 'utf8');
for (const line of review.split('\n')) {
  const cells = line.split('|').slice(1, -1).map(s => s.trim());
  if (cells.length === 5 && /^5\d\d(?:-\d+)*$/.test(cells[0])) descriptions.set(cells[0], cells[4]);
}
const special = {
  '751': '승인된 보호구역·속도·거리·감속·해제 조합과 명시된 중량/높이는 처리했다. 자전거·횡단보도는 보류하며 기타 미지정 복합 문구, 시설명, 운영 조건 등이 남았다.',
  '513': '승인된 두 문구 외의 기록. 버튼 작동 안내 문장·주차금지·자전거주의·직진 후 좌회전 등이 혼재해 비고별 판단이 필요하다.',
  '521': '93건 공란. 시간X, 250ㅡ 각 1건은 거리·구간·방향 유형을 결정할 근거가 부족하다.',
  '538': '9건 공란. 목동교방향 70m 1건은 좌우 화살표 방향이나 단순 거리판 여부가 미확인이다.',
  '563': '3건 공란. 막다른길진입금지, 교차로내 주차금지 각 1건은 거리·방향 안내와 다른 내용이다.',
  '701': '여기부터·거리·휴교일 제외 등 서로 다른 보조 문구가 섞여 있다. 521 계열 규칙을 임의 확대하지 않았다.',
  '413-Z': '버스전용 차선·운영시간·요일 예외 등이 기록되어 있다. 숫자 413과의 유사성만으로 일람표 413에 연결하지 않았다.',
  '222-Z': '34건 중 33건 비고 공란, 1건 경적금지. Z를 제거해 222에 연결할 근거가 없다.',
  '226-Z': '13건 중 10건 비고 공란, 3건 보행금지. 코드 전체를 일괄 지정할지 결정이 필요하다.',
  '410-Z': '버스전용·좌회전전용·속도 해제 등이 혼재한다. 단일 기상상태 표지로 연결할 수 없다.',
  '414-Z': '중앙버스 전용차로 끝 1건. 차량한정 414와 동일하다고 확인되지 않았다.',
  '413-1': '버스전용 및 첨두시간 문구 1건. 시간/차종 조건의 처리 규칙이 필요하다.',
  '706': '8건 중 7건 비고 공란, 1건 자전거전용도로해제. 코드 전체의 의미 확정은 보류했다.',
  '712': '비고 공란 1건. 제외된 712-1과 별개 코드다.',
  '719': '어린이보호구역/여기부터 1건. 보호구역과 구간 시작 문구의 복합 처리 미지정.',
  '732': '2건 모두 비고 공란으로 내용 확인이 필요하다.',
  '611': '내부순환로 10t 이상 화물차 진입금지 2건. 차종 제한과 중량 조건이 결합되어 있다.',
  '613': '올림픽대로 10톤 이상 화물차량 통행제한 및 07:00~09:00 조건 1건.',
  '617': '서울시설공단·동대문구청 방향 안내 1건. 안전표지 일람표와의 대응 여부 확인이 필요하다.',
  '623': '마장IC·동대문구청·청계천로 지명 안내 1건. 일람표 대응 유형 미확인.',
  '426': '직진신호시좌회전가능 1건. 현재 일람표에 426이 없으며 동작과 신호 조건을 함께 검토해야 한다.',
  '': '서울시 코드가 비어 있어 코드 기준 매핑이 불가능하다. 비고 단독 분류는 별도 지정되지 않았다.',
};
function reason(code) { return special[code] || descriptions.get(code) || '원본 비고와 현장 도안의 추가 확인이 필요하다.'; }
function category(remark) {
  if (/\d/.test(remark) && /속도[를]?\s*줄|속도를줄/.test(remark)) return '숫자(속도·거리)와 감속 문구';
  if (/보호구역|어린이보호|노인보호/.test(remark)) return '보호구역 관련';
  if (/주차|전용|\d\d:\d\d|요일|공휴일|평일/.test(remark)) return '주차·전용·시간 조건';
  if (/높이|중량|화물|톤|차량|\d\s*[tT]/.test(remark)) return '차량·높이·중량 조건';
  if (/전방|여기|앞부터|[mM]|회전|방향/.test(remark)) return '거리·방향·동작 안내';
  return '그 밖의 안내·주의 문구';
}
const categoryCounts = Object.fromEntries(['숫자(속도·거리)와 감속 문구', '보호구역 관련', '주차·전용·시간 조건', '차량·높이·중량 조건', '거리·방향·동작 안내', '그 밖의 안내·주의 문구'].map(key => [key, 0]));
for (const g of remarkGroups.filter(g => g.code === '751')) categoryCounts[category(g.remark)] = (categoryCounts[category(g.remark)] || 0) + g.count;
const esc = text => String(text).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
const n = value => value.toLocaleString('ko-KR');
const summary = [
  ['안전표지 S 전체', rows.filter(r => r[0][0] === 'S').length],
  ['사용자 지정 번호', totals['S:user']], ['번호 일치 후보', totals['S:code-match']],
  ['사용자 지정 문구 일방(번호 없음)', labels.length], ['표시 제외', totals['S:excluded']],
  ['추가 결정이 필요한 미연결 기록', pending.length], ['도로안내표지 R(별도)', totals['R:unmapped']],
];
const codeRows = groups.map(g => [g.code, g.count, g.blank, reason(g.code), [...g.remarks].sort((a, b) => b[1] - a[1]).filter(([r]) => r).slice(0, 5).map(([r, count]) => `${r} (${count})`).join(' / ')]);
const remarkRows = remarkGroups.map(g => [g.code, g.remark, g.count, g.sample[1], g.sample[3], g.sample[4], g.sample[5], reason(g.code)]);
const headers = {
  codes: ['서울시 코드', '미연결 건수', '비고 공란', '내용·남은 판단', '비고 예시(건수)'],
  remarks: ['서울시 코드', '원본 비고', '건수', '대표 관리번호', '위도', '경도', '로드뷰', '내용·남은 판단'],
  records: ['서울시 코드', '관리번호', '원본 비고', '위도', '경도', '로드뷰'],
};
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
for (const [name, header, data] of [['집계', ['구분', '건수'], summary], ['코드별 잔여', headers.codes, codeRows],
  ['비고별 잔여', headers.remarks, remarkRows], ['지점별 잔여', headers.records, pending], ['일방 표시', headers.records, labels]]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(header); sheet.addRows(data);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.length + 1, column: header.length } };
  sheet.columns.forEach((column, index) => { column.width = /비고|판단|예시/.test(header[index]) ? 62 : /로드뷰/.test(header[index]) ? 65 : 24; });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18314B' } };
}
const xlsx = new URL('remaining-mappings-2026-10-13.xlsx', output);
await workbook.xlsx.writeFile(fileURLToPath(xlsx));
const check = new ExcelJS.Workbook(); await check.xlsx.readFile(fileURLToPath(xlsx));
assert.equal(check.getWorksheet('지점별 잔여').rowCount - 1, pending.length);
assert.equal(check.getWorksheet('비고별 잔여').rowCount - 1, remarkRows.length);
const lines = ['# 잔여 매핑 상세 — 2026-10-13 최신 규칙 적용', '',
  '751 외의 남은 미매핑 안전표지를 표시 제외했다. 기존 번호 연결과 526 일방 문구는 유지하며, 승인된 751 복합 문구를 추가 연결하고 지정 시간 안내는 제외했다. 거리 숫자 없는 여기부터 단독/LED도 표시 제외했다. 그 밖의 미지정 문구는 추가 결정을 기다린다. 원본 232,095행의 실제 분류 함수 결과를 집계했으며 원본은 삭제하지 않았다.', '',
  '## 현재 집계', '', '| 구분 | 건수 |', '|---|---:|', ...summary.map(([label, count]) => `| ${label} | ${n(count)} |`), '',
  `추가 결정 대상은 **${n(pending.length)}건**이다. 코드가 있는 자료는 **${groups.filter(g => g.code).length}종·${n(pending.filter(r => r[0]).length)}건**, 코드 공란은 **${n((codes.get('')?.count || 0))}건**이다. 526·751의 방향 미확인 일방통행 **${n(labels.length)}건**은 요청대로 ‘일방’이라고 표시하는 별도 처리 완료 항목이며 일람표 번호가 생긴 것은 아니다. 따라서 숫자 번호가 없는 표시 대상은 두 항목을 합친 ${n(pending.length + labels.length)}건이다.`, '',
  '일람표와 번호가 같은 후보도 의미 검증 완료를 뜻하지 않는다. 도로안내표지 R은 경찰청 안전표지 매핑 대상과 분리했다. 현재 PR 작업이며 main/운영 반영 전이다.', '',
  '## 이번 규칙과 적용 범위', '',
  '- 서울시 코드 751에 승인된 문구 규칙을 확장했다. 기존 고정 코드 및 514·513·526·521·538·563 규칙과 도로안내표지 R은 유지한다.',
  '- 노인보호구역/노인보호 323, 어린이보호구역/어린이보호 324. 속도가 함께 있으면 224, 감속 문구면 415, 해제면 427을 조합한다. 속도 후보는 기존 1~130 범위를 유지한다. 두 보호구역이나 여러 속도가 섞이면 임의로 하나를 고르지 않는다.',
  '- 여기부터/여기서부터 + 거리 + 속도를 줄이시오는 거리 숫자와 무관하게 사용자 지정 418, 415. 거리 없는 여기부터 부분은 무시하되 함께 있는 속도/보호구역/감속 내용은 유지한다. 단독 여기부터는 제외한다. 감속 없이 여기부터+거리만 있으면 기존 거리 유형 402, 전방 포함 거리+앞부터는 401이다.',
  '- 공백·쉼표·슬래시·괄호·LED 및 여기서부터 표기 차이를 정리한다. 숫자끼리의 구분자를 지워 30/40을 3040으로 합치지 않는다. 명시된 →/←/↑는 각각 420/421/422로 함께 표시한다. 일방통행의 화살표는 326/327/328, 방향 없으면 일방 문구다.',
  '- 차량 중량은 220, 명시된 높이는 221. 둘 다 있으면 220, 221이며 숫자값과 관계없이 적용한다. 높이 표시 없는 m 수치는 높이로 추정하지 않는다. 길이·폭·차종·시간 조건은 원본 비고로 보존하며 상세에 중량/높이만 번호화했음을 알린다. 제한 해제 문구는 이 규칙으로 처리하지 않는다.',
  '- 제외: 내용 없는 통합표지 단독, 버스전용(운영시간 등 포함), 시간/요일 안내 단독, 사고잦은곳/사고많은곳/사고가잦은곳 단독. 사고 문구에 감속이 함께 있으면 감속 415는 유지한다. 통합이라는 단어만 보고 내용이 있는 다른 복합 표지까지 삭제하지 않는다.',
  '- 자전거·횡단보도가 포함된 751 비고는 보류한다. 기존에 이미 연결된 다른 코드까지 해제하는 규칙은 아니다. [자전거 사진 검토](bicycle-caution-review-2026-10-13.md), [여기부터 사진 검토](here-from-roadview-2026-10-13.md)를 참고한다.',
  '- 승인된 성분 전체가 설명되는 복합 문구만 연결한다. 알 수 없는 지명·주차·운영·철거·이설 조건 등은 단순 키워드로 부분 분류하지 않는다. 명시된 중량/높이 추출은 위의 사용자 지정 예외다. 원본 자료는 삭제하지 않는다.', '',
  '## 751 잔여 상세', '',
  '아래 분류는 원문 검토 순서를 위한 집계이며 공식 표지 종류나 자동 매핑 결과가 아니다. 키워드가 겹치면 위에서 먼저 해당하는 항목에 넣어 중복 집계하지 않았다.', '',
  '| 검토 묶음 | 건수 |', '|---|---:|', ...Object.entries(categoryCounts).map(([label, count]) => `| ${label} | ${n(count)} |`), '',
  '자전거·횡단보도 보류 자료와 승인 규칙으로 설명되지 않는 복합 문구·시간/주차 조건·시설명 등이 남았다. 한 번호로 줄일지, 복수 번호를 조합할지, 표시 제외할지의 판단이 필요하다. 아래 원문은 표기 차이를 합치지 않은 실제 비고다.', '',
  '| 원본 비고 | 건수 |', '|---|---:|', ...[...remarks.values()].filter(g => g.code === '751').sort((a, b) => b.count - a.count).slice(0, 25).map(g => `| ${esc(g.remark)} | ${n(g.count)} |`), '',
  '## 코드별 상세', '',
  `전체 ${remarkRows.length}개 코드·비고 조합과 ${n(pending.length)}개 지점은 엑셀에 빠짐없이 수록했다. 아래는 각 코드의 내용, 공란 수, 빈도 상위 원문 5개다. 제시한 내용은 공식 코드명이 아니라 원본 비고의 관찰이다.`, ''];
for (const g of groups) {
  lines.push(`### ${g.code || '코드 공란'} — ${n(g.count)}건`, '', reason(g.code), '', `비고 공란: ${n(g.blank)}건.`, '', '| 원본 비고 | 건수 |', '|---|---:|');
  for (const [remark, count] of [...g.remarks].sort((a, b) => b[1] - a[1]).slice(0, 5)) lines.push(`| ${esc(remark || '(공란)')} | ${n(count)} |`);
  lines.push('');
}
lines.push('## 전체 파일', '', '[엑셀: 집계·코드별·비고별·지점별·일방 표시](remaining-mappings-2026-10-13.xlsx) · [코드별 CSV](remaining-mappings-2026-10-13.csv) · [비고별 전체 CSV](remaining-remarks-2026-10-13.csv)', '',
  '출처: 앱 채택 서울시 안전표지 원본 RMK·좌표와 경찰청 일람표 2023.12 시행판. 관리번호와 로드뷰 링크는 재확인용이며 현재 시설 상태를 보증하지 않는다.');
await writeFile(new URL('remaining-mappings-2026-10-13.md', output), lines.join('\n') + '\n');
console.log(JSON.stringify({ totals, pending: pending.length, codes: groups.filter(g => g.code).length, remarkGroups: remarkRows.length, categories751: categoryCounts, filesVerified: true }, null, 2));
