// Layout reference: 260630 chapter 2, section 2.1.11. Values always come from the current survey.
export const REPORT_SOURCE = '자료 : 교통사고 통계분석, TAAS 교통사고분석시스템';
const severity = ['발생건수\n(건)', '사망자수\n(명)', '중상자수\n(명)', '경상자수\n(명)', '부상신고자수\n(명)'];
const metrics = ['accidents', 'deaths', 'serious', 'minor', 'reported'];
const circle = n => String.fromCodePoint(0x2460 + n - 1);
const count = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
export function annualGrowth(values, years) {
  if (values.length < 2 || values.some(v => v === null) || values[0] <= 0 || years.at(-1) <= years[0]) return null;
  return (values.at(-1) / values[0]) ** (1 / (years.at(-1) - years[0])) - 1;
}
export function reportCell(value, rate = false) {
  if (value === null || value === undefined) return rate ? '산정 불가' : '—';
  return typeof value === 'number' ? (rate ? `${(value * 100).toFixed(2)}%` : value.toLocaleString('ko-KR')) : value;
}
function headers(numbered, types) {
  const offset = numbered ? 2 : 1, rows = types ? 2 : 1;
  return [
    { label: '구 분', row: 0, col: 0, rowSpan: rows, colSpan: offset },
    ...severity.map((label, i) => ({ label, row: 0, col: offset + i, rowSpan: rows })),
    ...(types ? [{ label: '사고유형(건)', row: 0, col: offset + 5, colSpan: 3 }, ...['차대차', '차대사람', '차량단독'].map((label, i) => ({ label, row: 1, col: offset + 5 + i }))] : []),
  ];
}
function radiusValues(record, types = false) {
  const values = metrics.map(key => record?.state === 'success' ? count(record.data?.counts?.[key]) : null);
  // The current radius endpoint does not collect collision-type breakdowns, even for a zero total.
  return types ? [...values, '미수집', '미수집', '미수집'] : values;
}
function recordNote(record, label) {
  if (!record) return `${label}: 미조회 또는 조사 중단.`;
  if (record.state !== 'success') return `${label}: ${record.message || '조회 실패'}`;
  return record.data?.qualityWarnings?.length ? `${label}: ${record.data.qualityWarnings.join(' ')}` : null;
}
export function buildAccidentReport(results, snapshot) {
  if (!snapshot) return [];
  const years = Array.from({ length: Number(snapshot.years) }, (_, i) => Number(snapshot.year) - Number(snapshot.years) + 1 + i);
  const tables = [], official = results.filter(r => r.kind === 'official');
  const names = [...new Set(official.flatMap(r => (r.data?.sections?.statistics?.rows || []).filter(s => s.acc_cl_nm === '전체사고').map(s => s.sido_sgg_nm).filter(Boolean)))];
  for (const [index, name] of (names.length ? names : ['시군구']).entries()) {
    const notes = ['시군구 전체 통계이며 사업지 반경 내 통계와 범위가 다릅니다.', '시·도 전체 통계는 현재 수집하지 않아 별도 표에 포함하지 않습니다.'];
    const rows = years.map(year => {
      const record = official.find(r => Number(r.query.year) === year);
      const section = record?.data?.sections?.statistics;
      const matches = record?.state === 'success' && section?.status === 'success' ? section.rows.filter(r => r.acc_cl_nm === '전체사고' && r.sido_sgg_nm === name && Number(r.std_year) === year) : [];
      const row = matches.length === 1 ? matches[0] : null;
      if (!row) notes.push(`${year}년: ${record?.message || section?.message || (matches.length > 1 ? '중복 통계 확인 필요' : record ? '해당 지역 자료 없음' : '미조회 또는 조사 중단')}`);
      return { values: [`${year}년`, ...['acc_cnt', 'dth_dnv_cnt', 'injpsn_cnt'].map(k => count(row?.[k]))] };
    });
    const growth = [1, 2, 3].map(col => annualGrowth(rows.map(r => r.values[col]), years));
    rows.push({ values: ['연평균 증가율(%)', ...growth], rate: true });
    notes.push('연평균 증가율 = [(마지막 연도 / 첫 연도)^(1/연도 차이) − 1] × 100. 1개 연도·자료 누락·첫 연도 0은 산정 불가.');
    tables.push({ id: `annual-${index}`, sheet: `보고서_지역별${index ? index + 1 : ''}`, title: `${name} 교통사고 발생현황`, subtitle: `${years[0]}년~${years.at(-1)}년 · 전체사고`, widths: [25, 23, 23, 23], headerRows: 1, headers: ['구 분', '발생건수(건)', '사망자수(명)', '부상자수(명)'].map((label, col) => ({ label, row: 0, col })), rows, notes, years });
  }
  const nearbyNotes = ['사고유형(차대차·차대사람·차량단독)은 현재 반경 집계에서 미수집한 항목입니다.'];
  const nearby = years.map(year => {
    const record = results.find(r => r.kind === 'radius' && !r.intersection && r.query.type === 'all' && Number(r.query.year) === year);
    const note = recordNote(record, `${year}년`); if (note) nearbyNotes.push(note);
    return { values: [`${year}년`, ...radiusValues(record, true)] };
  });
  const scope = `${snapshot.address || '사업지'} · 반경 ${snapshot.radius}m`;
  tables.push({ id: 'nearby', sheet: '보고서_사업지주변', title: '사업지 주변 교통사고 발생현황', subtitle: scope, widths: [18, 13, 13, 13, 13, 16, 12, 12, 12], headerRows: 2, headers: headers(false, true), rows: nearby, notes: nearbyNotes });
  for (const year of years) {
    const notes = [];
    const rows = ['pedestrian', 'bicycle'].map((type, i) => {
      const label = type === 'pedestrian' ? '보행자 사고' : '자전거 사고';
      const record = results.find(r => r.kind === 'radius' && !r.intersection && r.query.type === type && Number(r.query.year) === year);
      const note = recordNote(record, label); if (note) notes.push(note);
      return { values: [circle(i + 1), label, ...radiusValues(record)] };
    });
    tables.push({ id: `vulnerable-${year}`, sheet: `보고서_보행자자전거_${year}`, title: `사업지 주변 자전거 및 보행자 사고 발생현황(${year}년)`, subtitle: scope, widths: [6, 24, 17, 17, 17, 17, 19], headerRows: 1, headers: headers(true, false), rows, notes });
  }
  const notes = ['교차로 중심 반경 내 전체 사고이며 도로형태별 교차로 사고와 다릅니다. 겹치는 반경의 사고건수는 합산하지 않습니다.', '사고유형은 현재 미수집한 항목입니다.'], zero = [];
  const rows = (snapshot.intersections || []).flatMap((site, i) => {
    const label = `${circle(i + 1)} ${site.name || `교차로 ${i + 1}`}`;
    const record = results.find(r => r.intersection === i + 1 && Number(r.query.year) === Number(snapshot.year));
    notes.push(`${label}: 반경 ${site.radius}m.`);
    const note = recordNote(record, label); if (note) notes.push(note);
    const values = radiusValues(record, true);
    if (values.slice(0, 5).every(v => v === 0)) { zero.push(label); return []; }
    return [{ values: [circle(i + 1), site.name || `교차로 ${i + 1}`, ...values] }];
  });
  if (zero.length) notes.push(`주 : ${zero.join(', ')}는 ${snapshot.year}년에 발생한 교통사고가 없음(조회 완료 0건).`);
  if (!snapshot.intersections?.length) notes.push('분석대상 교차로가 지정되지 않았습니다.');
  tables.push({ id: 'intersections', sheet: '보고서_교차로', title: `분석대상 교차로 내 교통사고 발생현황(${snapshot.year}년)`, subtitle: snapshot.address || '사업지', widths: [6, 27, 13, 13, 13, 13, 16, 12, 12, 12], headerRows: 2, headers: headers(true, true), rows, notes, empty: zero.length ? '조회한 교차로 모두 사고 없음(0건)' : '교차로 미지정' });
  return tables;
}
