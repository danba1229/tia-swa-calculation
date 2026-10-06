'use client';

import { useEffect, useRef, useState } from 'react';
import { ACCIDENT_TYPES, COLLISION_TYPES, surveyQuality, TAAS_URL, validateAccidentQuery } from '../lib/accidentSurvey';
import { buildAccidentReport } from '../lib/accidentReport';
import { buildReportWorkbook } from '../lib/accidentReportExcel';
import AccidentReportTables from './AccidentReportTables';
import { readDraft } from '../lib/draftStorage';
import useDraftPersistence from './useDraftPersistence';
import DraftStatus from './DraftStatus';

const STORAGE_KEY = 'tia-accident-survey-v1';
const countLabels = { accidents: '사고건수', casualties: '사상자 집계(집계방식 참조)', deaths: '사망', serious: '중상', minor: '경상', reported: '부상신고' };
const initial = { radius: '500', year: String(new Date().getFullYear() - 1), years: '3', intersections: [] };
const endpoint = { radius: '/api/accidents/radius', official: '/api/accidents/official' };
async function requestJson(url, body, signal, attempt = 0) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const delay = Number(response.headers.get('Retry-After'));
  if (response.status === 429 && delay > 0 && delay <= 15 && attempt < 24) {
    await new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('취소', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, delay * 1000);
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
    return requestJson(url, body, signal, attempt + 1);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('서버 응답을 받지 못했습니다. 다시 조회해 주세요.'); }
  if (!response.ok || !data.success) throw new Error(data.message || '조회 실패');
  return data;
}

export default function TrafficAccidentStep({ siteLocation, visible, autoRequest, onPhase, seed }) {
  const [settings, setForm] = useState(initial), [results, setResults] = useState([]), [snapshot, setSnapshot] = useState(null);
  const form = { ...settings, address: siteLocation.address, lat: siteLocation.lat, lng: siteLocation.lng };
  const siteKey = JSON.stringify([form.address, form.lat, form.lng]);
  const currentSite = useRef(siteKey);
  currentSite.current = siteKey;
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [ready, setReady] = useState(false);
  const controller = useRef(null), run = useRef(0);
  useEffect(() => {
    let cancelled = false;
    (seed ? Promise.resolve(seed) : readDraft(STORAGE_KEY)).then(saved => {
      if (!cancelled && saved?.form) { const { radius, year, years, intersections } = { ...initial, ...saved.form }; setForm({ radius, year, years, intersections }); setResults(saved.results || []); setSnapshot(saved.snapshot || null); }
      if (!cancelled) setReady(true);
    }).catch(() => { if (!cancelled) setStatus('저장된 사고조사를 읽지 못해 자동 저장을 중지했습니다. 상단 백업 복원 또는 전체 초기화를 사용해 주세요.'); });
    return () => { cancelled = true; run.current++; controller.current?.abort(); };
  }, []);
  const draftStatus = useDraftPersistence(STORAGE_KEY, { form: settings, results, snapshot }, ready);
  useEffect(() => {
    run.current++;
    controller.current?.abort();
    setBusy(false);
    setStatus('');
  }, [siteKey]);
  const stale = snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);
  const errors = results.some(r => r.state === 'error' || Object.values(r.data?.sections || {}).some(s => s.status === 'error'));
  const incomplete = results.length < Number(settings.years) * (1 + Object.keys(ACCIDENT_TYPES).length) + settings.intersections.length * 5;
  const qualityWarning = buildAccidentReport(results, snapshot).some(table => table.validationWarnings?.length);
  const invoke = useRef(null), handled = useRef(0);
  invoke.current = () => investigate();
  useEffect(() => {
    if (!autoRequest || handled.current === autoRequest.id || autoRequest.address !== siteLocation.address || !ready || siteLocation.status !== 'ready') return;
    handled.current = autoRequest.id;
    invoke.current();
  }, [autoRequest, siteLocation.address, siteLocation.status, ready]);
  useEffect(() => {
    onPhase?.(busy ? 'loading' : stale ? 'stale' : !results.length ? 'idle' : errors || incomplete || qualityWarning ? 'partial' : 'complete');
  }, [busy, stale, results.length, errors, incomplete, qualityWarning, onPhase]);
  const reportTables = buildAccidentReport(results, snapshot);
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const intersectionUpdate = (index, key, value) => setForm(f => ({ ...f, intersections: f.intersections.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  async function geocode(index) {
    const address = form.intersections[index].address;
    const id = ++run.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setStatus('주소 좌표 확인 중…');
    try {
      const data = await requestJson('/api/geocode', { address }, abort.signal);
      if (run.current !== id) return;
      if (currentSite.current !== siteKey) return;
      setForm(f => ({ ...f, intersections: f.intersections.map((r, i) => i === index ? { ...r, lat: String(data.latitude), lng: String(data.longitude) } : r) }));
      setStatus(`주소 확인: ${data.matchedAddress}`);
    } catch (e) { if (run.current === id) setStatus(e.message); } finally { if (run.current === id) setBusy(false); }
  }
  async function investigate(retryOnly = false) {
    let jobs;
    try {
      if (siteLocation.status !== 'ready') throw new Error('상단 주소지의 좌표 확인이 완료된 뒤 조사해 주세요.');
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
        for (const type of ['all', ...Object.keys(COLLISION_TYPES)]) jobs.push({ kind: 'radius', intersection: i + 1, name: row.name || `교차로 ${i + 1}`, query: validateAccidentQuery({ ...row, year: base.year, type }) });
      }
    } catch (e) { setStatus(e.message); return; }
    const id = ++run.current;
    controller.current?.abort();
    controller.current = new AbortController();
    const successful = retryOnly === true && !stale ? results.filter(r => r.state === 'success' && !Object.values(r.data?.sections || {}).some(s => s.status === 'error')) : [];
    const jobKey = job => JSON.stringify([job.kind, job.intersection, job.query]);
    const completed = new Set(successful.map(jobKey));
    const collected = [...successful];
    const totalJobs = jobs.length;
    jobs = jobs.filter(job => !completed.has(jobKey(job)));
    setBusy(true); setResults(collected); setSnapshot(JSON.parse(JSON.stringify(form)));
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (run.current !== id || currentSite.current !== siteKey) break;
        const job = jobs[i];
        setStatus(`${i + 1}/${jobs.length} · ${job.query.year}년 ${job.name} ${job.kind === 'radius' ? ACCIDENT_TYPES[job.query.type] : ''} 조회 중…`);
        let record;
        try { record = { ...job, state: 'success', data: await requestJson(endpoint[job.kind], job.query, controller.current.signal) }; }
        catch (e) { if (controller.current.signal.aborted) break; record = { ...job, state: 'error', message: e.message }; }
        if (run.current !== id || currentSite.current !== siteKey) break;
        collected.push(record); setResults([...collected]);
      }
      if (run.current === id) {
        const errors = collected.filter(r => r.state === 'error' || Object.values(r.data?.sections || {}).some(s => s.status === 'error')).length;
        const warnings = collected.filter(r => surveyQuality(r.data).warnings.length).length;
        const notes = collected.filter(r => surveyQuality(r.data).notes.length).length;
        const collisionWarnings = buildAccidentReport(collected, form).flatMap(table => table.validationWarnings || []).length;
        setStatus(`조사 종료 · ${collected.length}/${totalJobs}개 처리${errors ? ` · ${errors}개 조회에 확인할 오류가 있습니다.` : ''}${warnings ? ` · ${warnings}개 결과의 원문 합계 확인이 필요합니다.` : ''}${notes ? ` · ${notes}개 결과에 집계·표기 안내가 있습니다.` : ''}${collisionWarnings ? ` · ${collisionWarnings}개 사고유형에 확인이 필요합니다.` : ''}`);
      }
    } finally { if (run.current === id) setBusy(false); }
  }
  function stop() { run.current++; controller.current?.abort(); setBusy(false); setStatus('조사를 중단했습니다. 완료된 결과만 표시합니다. 진행 중인 서버 조회는 종료까지 잠시 걸릴 수 있습니다.'); }
  async function download() {
    try {
      const module = await import('exceljs');
      const ExcelJS = module.default || module;
      const sheets = new Map();
      const add = (name, row) => { if (!sheets.has(name)) sheets.set(name, []); sheets.get(name).push(row); };
      for (const r of results) {
        const quality = surveyQuality(r.data);
        const common = { 년도: r.query.year, 지점: r.name, 위도: r.query.lat, 경도: r.query.lng, 반경m: r.query.radius, 상태: r.state, 조회일시: r.data?.retrievedAt || '', 오류: r.message || '', 원문검산: quality.warnings.join(' '), 표기안내: quality.notes.join(' ') };
        if (r.kind === 'radius') {
          const sheet = r.intersection ? `교차로사고(${r.intersection})` : { all: '사업지 주변', pedestrian: '보행자사고', bicycle: '자전거사고' }[r.query.type] || '사고유형 원자료';
          add(sheet, { ...common, 사고구분: ACCIDENT_TYPES[r.query.type], 집계방식: r.data?.collectionMethod === 'spatial-records-v1' ? '공간분석 개별 사고 집계; 사상자=사망 포함 계산 합계' : r.data?.collectionMethod === 'individual-subtypes-v1' ? '세부유형 개별 조회 합산(계산)' : 'TAAS 직접 조회', ...Object.fromEntries(Object.entries(countLabels).map(([k, v]) => [v, r.data?.counts?.[k] ?? null])), '부상자 합계(계산)': quality.injuries, '사망 포함 합계(계산)': quality.total, 사고유형선택코드: r.data?.selectedCollisionCodes || '', 출처: r.data?.source || TAAS_URL, 출처링크: TAAS_URL, 원문: r.data?.evidence || '' });
          for (const row of r.data?.subtypeResults || []) add('세부유형 개별 원문', { ...common, 사고구분: ACCIDENT_TYPES[r.query.type], 세부유형코드: row.code, 세부유형: row.label, ...Object.fromEntries(Object.entries(countLabels).map(([k, v]) => [v, row.counts[k]])), 조회일시: row.retrievedAt, 출처: TAAS_URL, 원문: row.evidence });
          for (const row of r.data?.spatialRecords || []) add('공간분석 사고 원자료', { ...common, 사고구분: ACCIDENT_TYPES[r.query.type], 좌표계: 'EPSG:5179', 응답SHA256: r.data.sourceHash, 출처: TAAS_URL, ...row });
        } else if (r.data) {
          for (const [key, section] of Object.entries(r.data.sections)) {
            const name = { statistics: '년도별 사고', bicycle: '자전거 다발지역 참고', pedestrian: '보행자 다발지역 참고' }[key];
            if (!section.rows?.length) add(name, { ...common, 행정구역: r.data.region.name, 상태: section.status, 오류: section.message || '', 비고: '자료없음·조회실패를 사고 0건으로 해석하지 않음' });
            for (const row of section.rows || []) add(name, { ...common, 행정구역: r.data.region.name, ...row });
          }
        } else add('조회오류', common);
      }
      add('조사조건·출처', { 항목: '조사조건', 내용: JSON.stringify(snapshot) });
      add('조사조건·출처', { 항목: '처리 현황', 내용: `${results.length}/${Number(snapshot.years) * (1 + Object.keys(ACCIDENT_TYPES).length) + snapshot.intersections.length * (1 + Object.keys(COLLISION_TYPES).length)}개 처리. 중단된 조사는 완료된 조회만 포함합니다. 각 표의 오류·자료 없음 상태를 확인하세요.` });
      add('조사조건·출처', { 항목: '범위', 내용: '사업지 주변·보행자·자전거: TAAS 반경 내 사고 집계. 교차로: 지정 중심 반경 내 전체 사고이며 도로형태별 교차로 사고와 다름. 반경이 겹치면 교차로별 건수를 합산하지 말 것.' });
      add('조사조건·출처', { 항목: 'API', 내용: 'https://opendata.koroad.or.kr/ · 시군구 전체 통계와 사고다발지역 참고자료. 다발지역은 반경 내 전체 사고를 대체하지 않음.' });
      const workbook = buildReportWorkbook(ExcelJS, reportTables, sheets);
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = `교통사고조사_${snapshot.year}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setStatus('엑셀 파일을 만들지 못했습니다. 다시 다운로드해 주세요.'); }
  }
  return <section id="step-8" className="panel step-section accident-survey" hidden={!visible}>
    <DraftStatus status={draftStatus} />
    <div className="section-heading"><div><p className="eyebrow">Step.8</p><h2>교통사고 자동 조사</h2></div></div>
    <p>상단에 입력한 주소지와 자동 계산된 좌표를 사용합니다. 반경·연도를 정하면 TAAS에서 사업지 주변, 보행자, 자전거, 교차로별 사고를 조사합니다.</p>
    <div className="accident-site-summary">
      <strong>조사 주소</strong><p>{form.address || '상단에 주소지를 입력해 주세요.'}</p>
      {siteLocation.status === 'ready' ? <p>위도 <output aria-label="사업지 위도">{form.lat}</output> · 경도 <output aria-label="사업지 경도">{form.lng}</output></p> : <p role="status">{siteLocation.message}</p>}
    </div>
    <fieldset disabled={busy || !ready} className="accident-fields">
      <p className="muted">반경 10~500m는 반경분석, 501~1,000m는 공간분석 원자료 집계를 사용합니다. 사고유형은 세부유형 개별 조회 또는 개별 사고 코드로 집계합니다.</p>
      <div className="accident-grid">{[['radius', '사업지 반경(m)'], ['year', '기준 연도']].map(([key, label]) => <label key={key}>{label}<input type="number" step="1" min={key === 'radius' ? 10 : 2007} max={key === 'radius' ? 1000 : new Date().getFullYear() - 1} value={form[key]} onChange={e => update(key, e.target.value)} /></label>)}<label>조사 기간<select value={form.years} onChange={e => update('years', e.target.value)}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>기준 연도까지 {n}년</option>)}</select></label></div>
      <details><summary>교차로 조사 지점 ({form.intersections.length}개)</summary><p>교차로 중심점과 반경을 입력합니다. 기준 연도 1년을 조회하며, 반경이 겹치는 결과는 합산하지 않습니다.</p>
        {form.intersections.map((r, i) => <div className="accident-intersection" key={i}><div className="accident-grid">{[['name', '교차로명'], ['address', '인접 상세 주소'], ['lat', '위도'], ['lng', '경도'], ['radius', '반경(m)']].map(([key, label]) => <label key={key}>{i + 1}. {label}<input value={r[key]} onChange={e => intersectionUpdate(i, key, e.target.value)} /></label>)}</div><div className="accident-actions"><button type="button" className="mini-button" onClick={() => geocode(i)}>주소로 좌표 찾기</button><button type="button" className="mini-button" onClick={() => update('intersections', form.intersections.filter((_, j) => j !== i))}>삭제</button></div></div>)}
        <button type="button" className="secondary-button" disabled={form.intersections.length >= 10} onClick={() => update('intersections', [...form.intersections, { name: '', address: '', lat: '', lng: '', radius: '100' }])}>교차로 추가</button>
      </details>
      <p className="muted">좌표와 조사 조건은 조회를 위해 TAAS·카카오에 전송됩니다. TAAS 자료 제공 연도 내에서 조사하며, 외부 서비스 상태에 따라 수 분 걸릴 수 있습니다.</p>
      <button type="button" className="primary-button" disabled={siteLocation.status !== 'ready'} onClick={() => investigate()}>자동 조사 시작</button>
      {(errors || (results.length > 0 && incomplete)) && !stale && <button type="button" className="secondary-button" onClick={() => investigate(true)}>실패·미완료 항목 재시도</button>}
    </fieldset>
    <div className="accident-actions">{busy && <button type="button" className="secondary-button" onClick={stop}>조사 중단</button>}<button type="button" className="secondary-button" disabled={!results.length || busy || !!stale} onClick={download}>결과 엑셀 다운로드</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {stale && <p className="accident-warning">조건이 변경되었습니다. 아래는 이전 조건의 결과입니다. 다시 조사해 주세요.</p>}
    <div className={stale ? 'accident-stale' : ''}>
      {reportTables.flatMap(table => table.validationWarnings || []).map((message, i) => <p className="accident-warning" key={`collision-${i}`}>{message}</p>)}
      {results.filter(r => surveyQuality(r.data).warnings.length).map((r, i) => <p className="accident-warning" key={i}>{r.query.year}년 {r.name} · {ACCIDENT_TYPES[r.query.type]}: {surveyQuality(r.data).warnings.join(' ')}</p>)}
      {!!results.length && <><AccidentReportTables tables={reportTables} />
      <details><summary>조회 상태·원문 검증 내역</summary><p>보고서 표에서 —는 미조회·조회 실패·자료 없음입니다. 사고유형의 미수집은 0건을 뜻하지 않습니다.</p>
        <div className="table-wrap"><table><thead><tr><th>연도</th><th>조회 항목</th><th>조회 상태</th><th>사상자 집계(표기 안내 참조)</th><th>부상자 합계(계산)</th><th>사망 포함 합계(계산)</th><th>표기 안내</th><th>조회일시</th></tr></thead><tbody>{results.map((r, i) => <tr key={i}><td>{r.query.year}</td><td>{r.name} · {r.kind === 'radius' ? ACCIDENT_TYPES[r.query.type] : '공단 API'}</td><td>{r.state === 'error' ? r.message : r.kind === 'official' ? Object.entries(r.data.sections).map(([key, section]) => `${{statistics: '시군구', pedestrian: '보행자 다발', bicycle: '자전거 다발'}[key]}: ${section.status === 'success' ? '완료' : section.message || '자료 없음'}`).join(' / ') : '완료'}</td><td>{r.data?.counts?.casualties ?? '—'}</td><td>{surveyQuality(r.data).injuries ?? '—'}</td><td>{surveyQuality(r.data).total ?? '—'}</td><td>{surveyQuality(r.data).notes.join(' ') || '—'}</td><td>{r.data?.retrievedAt || '—'}</td></tr>)}</tbody></table></div>
      </details>
      <details><summary>보행자·자전거 사고다발지역 참고자료</summary><p>선정 기준에 해당하는 다발지역 중 중심점이 지정 반경 안에 있는 지점입니다. 전체 사고 건수로 사용하지 않습니다. 보행자 자료는 최근 3년 기준이므로 1년 반경 조회와 직접 비교할 수 없습니다.</p>{results.filter(r => r.kind === 'official').map((r, i) => <div key={i}><h4>{r.query.year}년 요청 · {r.data?.region.name || r.name}</h4>{['pedestrian', 'bicycle'].map(key => { const s = r.data?.sections[key]; return <div key={key}><strong>{ACCIDENT_TYPES[key]} 다발지역</strong><p>{s?.message || r.message || (s?.status === 'no_data' ? '공단 제공자료 없음' : `${s?.rows?.length ?? 0}개 지점`)}</p>{s?.rows?.map((row, j) => <p key={j}>{row.spot_nm} · 중심점 거리 {Math.round(row.distance)}m · 다발지역 사고 {row.occrrnc_cnt}건</p>)}</div>; })}</div>)}</details></>}
    </div>
    <p className="muted">출처: <a href={TAAS_URL} target="_blank" rel="noreferrer">한국도로교통공단 TAAS</a> · <a href="https://opendata.koroad.or.kr/" target="_blank" rel="noreferrer">공단 Open API</a>. 조회 실패·자료 미제공은 0건으로 처리하지 않습니다. 반경분석은 집계 원문을, 공간분석은 집계에 사용한 개별 사고 항목을 엑셀에 보존합니다.</p>
  </section>;
}
