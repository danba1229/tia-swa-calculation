'use client';

import { useEffect, useRef, useState } from 'react';
import { ACCIDENT_TYPES, TAAS_URL, validateAccidentQuery } from '../lib/accidentSurvey';

const STORAGE_KEY = 'tia-accident-survey-v1';
const countLabels = { accidents: '사고건수', casualties: '사상자(TAAS 표기)', deaths: '사망', serious: '중상', minor: '경상', reported: '부상신고' };
const initial = { address: '', lat: '', lng: '', radius: '500', year: String(new Date().getFullYear() - 1), years: '3', intersections: [] };
const endpoint = { radius: '/api/accidents/radius', official: '/api/accidents/official' };
async function requestJson(url, body, signal) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버 응답을 받지 못했습니다. 다시 조회해 주세요.'); }
  if (!response.ok || !data.success) throw new Error(data.message || '조회 실패');
  return data;
}

export default function TrafficAccidentStep({ basics, visible }) {
  const [form, setForm] = useState(initial), [results, setResults] = useState([]), [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [ready, setReady] = useState(false);
  const controller = useRef(null), run = useRef(0);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if (saved?.form) { setForm({ ...initial, ...saved.form }); setResults(saved.results || []); setSnapshot(saved.snapshot || null); } } catch { /* Unavailable storage does not prevent investigation. */ }
    setReady(true);
    return () => { run.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, results, snapshot })); } catch { /* Results remain downloadable. */ } }, [form, results, snapshot, ready]);
  const stale = snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const intersectionUpdate = (index, key, value) => setForm(f => ({ ...f, intersections: f.intersections.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  async function geocode(index) {
    const address = index == null ? form.address : form.intersections[index].address;
    const id = ++run.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setStatus('주소 좌표 확인 중…');
    try {
      const data = await requestJson('/api/geocode', { address }, abort.signal);
      if (run.current !== id) return;
      if (index == null) setForm(f => ({ ...f, lat: String(data.latitude), lng: String(data.longitude) }));
      else setForm(f => ({ ...f, intersections: f.intersections.map((r, i) => i === index ? { ...r, lat: String(data.latitude), lng: String(data.longitude) } : r) }));
      setStatus(`주소 확인: ${data.matchedAddress}`);
    } catch (e) { if (run.current === id) setStatus(e.message); } finally { if (run.current === id) setBusy(false); }
  }
  async function investigate() {
    let jobs;
    try {
      const count = Number(form.years);
      if (!Number.isInteger(count) || count < 1 || count > 5 || form.intersections.length > 10) throw new Error('조사 기간은 1~5년, 교차로는 최대 10개입니다.');
      const base = validateAccidentQuery({ ...form, type: 'all' });
      jobs = [];
      for (let i = count - 1; i >= 0; i--) {
        const year = base.year - i;
        validateAccidentQuery({ ...base, year });
        jobs.push({ kind: 'official', name: '시군구 통계·다발지역', query: { ...base, year } });
        for (const type of Object.keys(ACCIDENT_TYPES)) jobs.push({ kind: 'radius', name: form.address || '사업지', query: { ...base, year, type } });
      }
      for (let i = 0; i < form.intersections.length; i++) {
        const row = form.intersections[i];
        jobs.push({ kind: 'radius', intersection: i + 1, name: row.name || `교차로 ${i + 1}`, query: validateAccidentQuery({ ...row, year: base.year, type: 'all' }) });
      }
    } catch (e) { setStatus(e.message); return; }
    const id = ++run.current;
    controller.current = new AbortController();
    const collected = [];
    setBusy(true); setResults([]); setSnapshot(JSON.parse(JSON.stringify(form)));
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (run.current !== id) break;
        const job = jobs[i];
        setStatus(`${i + 1}/${jobs.length} · ${job.query.year}년 ${job.name} ${job.kind === 'radius' ? ACCIDENT_TYPES[job.query.type] : ''} 조회 중…`);
        let record;
        try { record = { ...job, state: 'success', data: await requestJson(endpoint[job.kind], job.query, controller.current.signal) }; }
        catch (e) { if (controller.current.signal.aborted) break; record = { ...job, state: 'error', message: e.message }; }
        if (run.current !== id) break;
        collected.push(record); setResults([...collected]);
      }
      if (run.current === id) {
        const errors = collected.filter(r => r.state === 'error' || Object.values(r.data?.sections || {}).some(s => s.status === 'error')).length;
        const warnings = collected.filter(r => r.data?.qualityWarnings?.length).length;
        setStatus(`조사 종료 · ${collected.length}/${jobs.length}개 처리${errors ? ` · ${errors}개 조회에 확인할 오류가 있습니다.` : ''}${warnings ? ` · ${warnings}개 결과의 원문 합계 확인이 필요합니다.` : ''}`);
      }
    } finally { if (run.current === id) setBusy(false); }
  }
  function stop() { run.current++; controller.current?.abort(); setBusy(false); setStatus('조사를 중단했습니다. 완료된 결과만 표시합니다. 진행 중인 서버 조회는 종료까지 잠시 걸릴 수 있습니다.'); }
  async function download() {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new(), sheets = new Map();
    const add = (name, row) => { if (!sheets.has(name)) sheets.set(name, []); sheets.get(name).push(row); };
    for (const r of results) {
      const common = { 년도: r.query.year, 지점: r.name, 위도: r.query.lat, 경도: r.query.lng, 반경m: r.query.radius, 상태: r.state, 조회일시: r.data?.retrievedAt || '', 오류: r.message || '', 원문검산: r.data?.qualityWarnings?.join(' ') || '' };
      if (r.kind === 'radius') {
        const sheet = r.intersection ? `교차로사고(${r.intersection})` : { all: '사업지 주변', pedestrian: '보행자사고', bicycle: '자전거사고' }[r.query.type];
        add(sheet, { ...common, 사고구분: ACCIDENT_TYPES[r.query.type], ...Object.fromEntries(Object.entries(countLabels).map(([k, v]) => [v, r.data?.counts?.[k] ?? null])), 출처: TAAS_URL, 원문: r.data?.evidence || '' });
      } else if (r.data) {
        for (const [key, section] of Object.entries(r.data.sections)) {
          const name = { statistics: '년도별 사고', bicycle: '자전거 다발지역 참고', pedestrian: '보행자 다발지역 참고' }[key];
          if (!section.rows?.length) add(name, { ...common, 행정구역: r.data.region.name, 상태: section.status, 오류: section.message || '', 비고: '자료없음·조회실패를 사고 0건으로 해석하지 않음' });
          for (const row of section.rows || []) add(name, { ...common, 행정구역: r.data.region.name, ...row });
        }
      } else add('조회오류', common);
    }
    add('조사조건·출처', { 항목: '조사조건', 내용: JSON.stringify(snapshot) });
    add('조사조건·출처', { 항목: '처리 현황', 내용: `${results.length}/${Number(snapshot.years) * 4 + snapshot.intersections.length}개 처리. 중단된 조사는 완료된 조회만 포함합니다. 각 표의 오류·자료 없음 상태를 확인하세요.` });
    add('조사조건·출처', { 항목: '범위', 내용: '사업지 주변·보행자·자전거: TAAS 반경 내 사고 집계. 교차로: 지정 중심 반경 내 전체 사고이며 도로형태별 교차로 사고와 다름. 반경이 겹치면 교차로별 건수를 합산하지 말 것.' });
    add('조사조건·출처', { 항목: 'API', 내용: 'https://opendata.koroad.or.kr/ · 시군구 전체 통계와 사고다발지역 참고자료. 다발지역은 반경 내 전체 사고를 대체하지 않음.' });
    for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
    XLSX.writeFile(workbook, `교통사고조사_${snapshot.year}.xlsx`);
  }
  return <section id="step-8" className="panel accident-survey" hidden={!visible}>
    <div className="section-heading"><div><p className="eyebrow">Step.8</p><h2>교통사고 자동 조사</h2></div></div>
    <p>주소 또는 좌표와 반경·연도를 지정하면 TAAS에서 사업지 주변, 보행자, 자전거, 교차로별 사고를 조사합니다.</p>
    <fieldset disabled={busy} className="accident-fields">
      <div className="accident-actions"><button type="button" className="secondary-button" onClick={() => setForm(f => ({ ...f, address: basics.siteAddress || '', lat: String(basics.centerLat || ''), lng: String(basics.centerLng || '') }))}>사업지 정보 가져오기</button></div>
      <div className="accident-address"><label>조사 주소<input value={form.address} onChange={e => update('address', e.target.value)} placeholder="도로명·건물번호 또는 지번 주소" /></label><button type="button" className="secondary-button" onClick={() => geocode(null)}>주소로 좌표 찾기</button></div>
      <div className="accident-grid">{[['lat', '위도'], ['lng', '경도'], ['radius', '사업지 반경(m)'], ['year', '기준 연도']].map(([key, label]) => <label key={key}>{label}<input type="number" step={key === 'lat' || key === 'lng' ? 'any' : '1'} value={form[key]} onChange={e => update(key, e.target.value)} /></label>)}<label>조사 기간<select value={form.years} onChange={e => update('years', e.target.value)}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>기준 연도까지 {n}년</option>)}</select></label></div>
      <details><summary>교차로 조사 지점 ({form.intersections.length}개)</summary><p>교차로 중심점과 반경을 입력합니다. 기준 연도 1년을 조회하며, 반경이 겹치는 결과는 합산하지 않습니다.</p>
        {form.intersections.map((r, i) => <div className="accident-intersection" key={i}><div className="accident-grid">{[['name', '교차로명'], ['address', '인접 상세 주소'], ['lat', '위도'], ['lng', '경도'], ['radius', '반경(m)']].map(([key, label]) => <label key={key}>{i + 1}. {label}<input value={r[key]} onChange={e => intersectionUpdate(i, key, e.target.value)} /></label>)}</div><div className="accident-actions"><button type="button" className="mini-button" onClick={() => geocode(i)}>주소로 좌표 찾기</button><button type="button" className="mini-button" onClick={() => update('intersections', form.intersections.filter((_, j) => j !== i))}>삭제</button></div></div>)}
        <button type="button" className="secondary-button" disabled={form.intersections.length >= 10} onClick={() => update('intersections', [...form.intersections, { name: '', address: '', lat: '', lng: '', radius: '100' }])}>교차로 추가</button>
      </details>
      <p className="muted">좌표와 조사 조건은 조회를 위해 TAAS·카카오에 전송됩니다. TAAS 자료 제공 연도 내에서 조사하며, 외부 서비스 상태에 따라 수 분 걸릴 수 있습니다.</p>
      <button type="button" className="primary-button" onClick={investigate}>자동 조사 시작</button>
    </fieldset>
    <div className="accident-actions">{busy && <button type="button" className="secondary-button" onClick={stop}>조사 중단</button>}<button type="button" className="secondary-button" disabled={!results.length || busy || !!stale} onClick={download}>결과 엑셀 다운로드</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {stale && <p className="accident-warning">조건이 변경되었습니다. 아래는 이전 조건의 결과입니다. 다시 조사해 주세요.</p>}
    <div className={stale ? 'accident-stale' : ''}>
      {results.filter(r => r.data?.qualityWarnings?.length).map((r, i) => <p className="accident-warning" key={i}>{r.query.year}년 {r.name} · {ACCIDENT_TYPES[r.query.type]}: {r.data.qualityWarnings.join(' ')}</p>)}
      {!!results.length && <><h3>반경 내 사고 집계</h3><div className="table-wrap"><table><thead><tr><th>연도</th><th>지점·반경</th><th>구분</th>{Object.values(countLabels).map(v => <th key={v}>{v}</th>)}<th>조회 상태</th></tr></thead><tbody>{results.filter(r => r.kind === 'radius').map((r, i) => <tr key={i}><td>{r.query.year}</td><td>{r.name} · {r.query.radius}m</td><td>{r.intersection ? '교차로 주변 전체' : ACCIDENT_TYPES[r.query.type]}</td>{Object.keys(countLabels).map(k => <td key={k}>{r.data?.counts?.[k] ?? '—'}</td>)}<td>{r.state === 'error' ? r.message : r.data.cached ? '완료 (1시간 내 저장자료)' : '완료'}</td></tr>)}</tbody></table></div>
      <h3>시군구 전체 사고 통계</h3><p>사업지가 속한 시군구 전체 통계입니다. 위의 사업지 반경 통계와 범위가 다릅니다.</p><div className="table-wrap"><table><thead><tr><th>연도</th><th>지역</th><th>구분</th><th>사고</th><th>사망</th><th>부상</th></tr></thead><tbody>{results.filter(r => r.kind === 'official').flatMap((r, i) => r.data?.sections.statistics.rows?.length ? r.data.sections.statistics.rows.filter(s => ['전체사고', '보행자사고', '자전거사고'].includes(s.acc_cl_nm)).map(s => <tr key={`${i}-${s.acc_cl_nm}`}><td>{s.std_year}</td><td>{s.sido_sgg_nm}</td><td>{s.acc_cl_nm}</td><td>{s.acc_cnt}</td><td>{s.dth_dnv_cnt}</td><td>{s.injpsn_cnt}</td></tr>) : <tr key={i}><td>{r.query.year}</td><td colSpan="5">{r.message || r.data?.sections.statistics.message || '해당 연도 자료 없음'}</td></tr>)}</tbody></table></div>
      <details><summary>보행자·자전거 사고다발지역 참고자료</summary><p>선정 기준에 해당하는 다발지역 중 중심점이 지정 반경 안에 있는 지점입니다. 전체 사고 건수로 사용하지 않습니다. 보행자 자료는 최근 3년 기준이므로 1년 반경 조회와 직접 비교할 수 없습니다.</p>{results.filter(r => r.kind === 'official').map((r, i) => <div key={i}><h4>{r.query.year}년 요청 · {r.data?.region.name || r.name}</h4>{['pedestrian', 'bicycle'].map(key => { const s = r.data?.sections[key]; return <div key={key}><strong>{ACCIDENT_TYPES[key]} 다발지역</strong><p>{s?.message || r.message || (s?.status === 'no_data' ? '공단 제공자료 없음' : `${s?.rows?.length ?? 0}개 지점`)}</p>{s?.rows?.map((row, j) => <p key={j}>{row.spot_nm} · 중심점 거리 {Math.round(row.distance)}m · 다발지역 사고 {row.occrrnc_cnt}건</p>)}</div>; })}</div>)}</details></>}
    </div>
    <p className="muted">출처: <a href={TAAS_URL} target="_blank" rel="noreferrer">한국도로교통공단 TAAS</a> · <a href="https://opendata.koroad.or.kr/" target="_blank" rel="noreferrer">공단 Open API</a>. 조회 실패·자료 미제공은 0건으로 처리하지 않습니다. 반경 조회는 집계 결과이며 개별 사고 원자료는 포함하지 않습니다.</p>
  </section>;
}
