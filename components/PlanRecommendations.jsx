'use client';
import { useEffect, useRef, useState } from 'react';

export default function PlanRecommendations({ address, year, autoRequest, onPhase }) {
  const [run, setRun] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState([]);
  const [downloading, setDownloading] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const mounted = useRef(true);
  const autoId = autoRequest?.address === address ? autoRequest.id : 0;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!run && !autoId) { onPhase('idle'); return; }
    const controller = new AbortController();
    let active = true;
    setBusy(true); setError(''); onPhase('loading');
    (async () => {
      try {
        const response = await fetch('/api/plans/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, year }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '계획 조회 실패');
        if (!active) return;
        let choices = data.plans.filter(p => p.autoSelected).map(p => p.versionId);
        try {
          const stored = JSON.parse(localStorage.getItem(`tia-plan-selection:${address}:${year}:${data.registryVersion}`) || 'null');
          if (Array.isArray(stored)) choices = stored.filter(id => data.plans.some(p => p.versionId === id));
        } catch {}
        setResult(data); setSelected(choices); onPhase('complete');
      } catch (e) {
        if (active && !controller.signal.aborted) { setError(e.message); setResult(null); onPhase('failed'); }
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [run, autoId, address, year, onPhase]);

  function choose(ids) {
    setSelected(ids);
    try { localStorage.setItem(`tia-plan-selection:${address}:${year}:${result.registryVersion}`, JSON.stringify(ids)); }
    catch { setError('선택은 화면에 반영했지만 브라우저에 저장하지 못했습니다.'); }
  }
  async function download(plan) {
    setDownloading(plan.versionId); setError('');
    try {
      const response = await fetch(`/api/plans/download?version=${encodeURIComponent(plan.versionId)}`, { cache: 'no-store' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '다운로드 실패'); }
      const file = await response.blob();
      if (!mounted.current) return;
      const url = URL.createObjectURL(file); const link = document.createElement('a');
      link.href = url; link.download = plan.summaryFileName; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setDownloading(''); }
  }
  const rows = result?.plans.filter(p => (showAll || (p.hasSummary && p.relevance !== 'other')) && (!query || `${p.title} ${p.scopeText}`.includes(query))) || [];
  return <section className="plan-recommendations" aria-label="주소 기반 계획 추천">
    <div className="plan-toolbar">
      <button type="button" disabled={busy || !address.trim()} onClick={() => setRun(n => n + 1)}>{busy ? '계획 확인 중…' : '계획 다시 찾기'}</button>
    </div>
    <p>상단 주소 기준으로 계획을 추천합니다. 개별 사업의 반경 내 포함 여부·착공·준공·교통수요 반영을 확정하지 않습니다.</p>
    <p>Word 요약본은 로그인 없이 누구나 다운로드할 수 있습니다. 원문은 공식 출처에서 확인하세요.</p>
    {error && <p role="alert" className="plan-warning">{error}</p>}
    {!result && !busy && !error && <p>상단 ‘조사 시작’ 또는 ‘계획 다시 찾기’를 눌러 주세요.</p>}
    {result && <>
      <p role="status">{result.admin.address} · 검토연도 {result.year} · 등록부 {result.registryVersion} · 선택 {selected.length}개</p>
      <p>{result.researchCount}개 조사 항목 중 요약본 {result.summaryCount}개를 연결했습니다. 미등록 계획까지 모두 조사한 결과는 아닙니다.</p>
      <div className="plan-toolbar">
        <label>계획 검색 <input value={query} onChange={e => setQuery(e.target.value)} placeholder="계획명 또는 지역" /></label>
        <label><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />미검토·다른 지역 후보도 표시</label>
        <button type="button" className="secondary" onClick={() => choose(result.plans.filter(p => p.autoSelected).map(p => p.versionId))}>추천 선택으로 복원</button>
      </div>
      <div className="table-wrap"><table className="data-table plan-table"><thead><tr>
        <th>선택</th><th>계획·기간</th><th>관련성·선택 이유</th><th>자료 상태</th><th>자료 받기</th>
      </tr></thead><tbody>{rows.map(plan => <tr key={plan.versionId}>
        <td><input type="checkbox" aria-label={`${plan.title} 선택`} checked={selected.includes(plan.versionId)} onChange={e => choose(e.target.checked ? [...selected, plan.versionId] : selected.filter(id => id !== plan.versionId))} /></td>
        <td><strong>{plan.title}</strong><p>{plan.periodText}</p><small>{plan.periodStatus}</small>{plan.yearNote && <p className="plan-warning">{plan.yearNote}</p>}</td>
        <td><span className="plan-badge">{plan.relevanceLabel}</span><p>{plan.reason}</p><details><summary>범위·근거 보기</summary><p>{plan.scopeText}</p><p>{plan.pageEvidence}</p><p>{plan.approvalEvidence}</p></details></td>
        <td><span className="plan-badge">{plan.status}</span><p>{plan.note}</p><small>확인일 {plan.checkedAt}</small></td>
        <td>{plan.sources.map((source, i) => <a className="plan-source" key={`${source.url}-${i}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.kind} ↗</a>)}
          {plan.hasSummary ? <button type="button" className="secondary" disabled={!!downloading} onClick={() => download(plan)}>{downloading === plan.versionId ? '다운로드 중…' : 'Word 요약본'}</button> : <small>Word 요약본 없음</small>}
        </td>
      </tr>)}</tbody></table></div>
      {!rows.length && <p>조건에 맞는 등록 계획이 없습니다.</p>}
    </>}
  </section>;
}
