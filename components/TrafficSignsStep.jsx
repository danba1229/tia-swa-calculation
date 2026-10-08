'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { layoutSignLabels, signScope } from '../lib/trafficSigns';
import { classifySign } from '../lib/signClassification';
import PoliceSignChart from './PoliceSignChart';

const SOURCE_NAMES = { S: '안전표지', R: '도로표지' };
export default function TrafficSignsStep({ visible, siteLocation, width, height, refresh, loadMaps, onPhase }) {
  const [result, setResult] = useState(null), [error, setError] = useState('');
  const [mapError, setMapError] = useState(''), [retryMap, setRetryMap] = useState(0);
  const [selectedId, setSelectedId] = useState(''), [source, setSource] = useState('all');
  const [screen, setScreen] = useState(null);
  const container = useRef(null), fit = useRef(null), mapRef = useRef(null);
  const key = JSON.stringify([siteLocation.address, siteLocation.status, siteLocation.lat, siteLocation.lng, width, height, refresh]);
  let scopeError = '';
  if (siteLocation.status !== 'ready') scopeError = siteLocation.message;
  else if (!/서울(?:특별시)?\s/.test(siteLocation.message)) scopeError = '현재 서울시 표지판 자료만 지원합니다. 서울 주소를 입력해 주세요.';
  else { try { signScope({ lat: siteLocation.lat, lng: siteLocation.lng, width, height }); } catch (e) { scopeError = e.message; } }
  const current = result?.key === key && !scopeError ? result : null;

  useEffect(() => {
    if (!visible) { onPhase(current ? 'complete' : 'idle'); return; }
    setError(''); setSelectedId('');
    if (scopeError) { onPhase('idle'); return; }
    const controller = new AbortController();
    onPhase('loading');
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ lat: siteLocation.lat, lng: siteLocation.lng, width, height });
        const response = await fetch(`/api/seoul-signs?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '표지판 조회에 실패했습니다.');
        if (controller.signal.aborted) return;
        setResult({ ...data, key }); onPhase('complete');
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e.message); onPhase('failed');
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible, key, scopeError, siteLocation.lat, siteLocation.lng, width, height, onPhase]);

  const points = useMemo(() => (current?.points || []).filter(p => source === 'all' || p.source === source).map(p => classifySign(p)), [current, source]);
  const verifiedCount = points.filter(p => p.verified).length;
  const selected = points.find(p => p.id === selectedId);
  useEffect(() => {
    if (!visible || !current || !container.current) { setScreen(null); return; }
    let cancelled = false, observer, frame, map, kakao, rectangle;
    const node = container.current;
    setMapError(''); setScreen(null);
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cancelled || !map) return;
        const projection = map.getProjection();
        const project = p => { const position = projection.containerPointFromCoords(new kakao.maps.LatLng(p.lat, p.lng)); return { ...p, x: position.x, y: position.y }; };
        setScreen({ width: node.clientWidth, height: node.clientHeight, points: points.map(project), site: project(current.scope) });
      });
    };
    loadMaps().then(sdk => {
      if (cancelled) return;
      kakao = sdk;
      const scope = current.scope;
      map = new kakao.maps.Map(node, { center: new kakao.maps.LatLng(scope.lat, scope.lng), level: 3 });
      mapRef.current = map;
      const bounds = new kakao.maps.LatLngBounds(new kakao.maps.LatLng(scope.south, scope.west), new kakao.maps.LatLng(scope.north, scope.east));
      rectangle = new kakao.maps.Rectangle({ map, bounds, strokeWeight: 2, strokeColor: '#2563eb', strokeStyle: 'dash', fillColor: '#dbeafe', fillOpacity: 0.06 });
      map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
      fit.current = () => { map.relayout(); const sidePadding = node.clientWidth < 600 ? 24 : 100; map.setBounds(bounds, 65, sidePadding, 65, sidePadding); draw(); };
      for (const event of ['bounds_changed', 'idle']) kakao.maps.event.addListener(map, event, draw);
      observer = new ResizeObserver(() => { map.relayout(); draw(); }); observer.observe(node);
      fit.current();
    }).catch(e => { if (!cancelled) setMapError(e.message || '지도를 불러오지 못했습니다.'); });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); observer?.disconnect();
      if (map) for (const event of ['bounds_changed', 'idle']) kakao.maps.event.removeListener(map, event, draw);
      rectangle?.setMap(null); fit.current = null; mapRef.current = null; node.replaceChildren();
    };
  }, [visible, current, points, loadMaps, retryMap]);

  const layout = useMemo(() => screen ? layoutSignLabels(screen.points, screen.width, screen.height, selectedId, [{ x: screen.width - 236, y: screen.height - 246, w: 228, h: 222 }]) : { points: [], labels: [] }, [screen, selectedId]);
  const choose = id => {
    setSelectedId(id);
    const point = points.find(p => p.id === id);
    if (point && mapRef.current && window.kakao) mapRef.current.panTo(new window.kakao.maps.LatLng(point.lat, point.lng));
  };
  return <section className={`panel step-section traffic-signs ${visible ? '' : 'is-hidden'}`} aria-label="STEP 9 교통 표지판">
    <div className="signs-heading"><div><p className="eyebrow">STEP 09 · SEOUL</p><h2>교통 표지판 위치도</h2><p>경찰청 일람표 번호와 표지 의미의 확인 상태를 함께 검토합니다.</p></div><span className="signs-region">서울시 공식 공개자료</span></div>
    <div className="signs-toolbar">
      <div className="signs-filters" role="group" aria-label="표지판 종류">{[['all', '전체 표지판'], ['S', '안전표지'], ['R', '도로표지']].map(([value, label]) => <button type="button" key={value} aria-pressed={source === value} onClick={() => { setSource(value); setSelectedId(''); }}>{label}{current && <span>{current.points.filter(p => value === 'all' || p.source === value).length.toLocaleString('ko-KR')}</span>}</button>)}</div>
      <button type="button" className="secondary" disabled={!screen} onClick={() => fit.current?.()}>조사 범위에 맞추기</button>
    </div>
    <div className="signs-status" role="status">{scopeError || error || (!current ? '서울 표지판을 조회하고 있습니다…' : `범위 내 ${points.length.toLocaleString('ko-KR')}건 · ${current.scope.width.toLocaleString('ko-KR')} × ${current.scope.height.toLocaleString('ko-KR')}m · 의미 확인 ${verifiedCount.toLocaleString('ko-KR')}건 / 추가 확인 ${(points.length - verifiedCount).toLocaleString('ko-KR')}건`)}{current && screen && ` · 현재 화면 번호 ${layout.labels.length}/${layout.points.length}개`}</div>
    <div className="signs-workbench">
    <div className="signs-map-frame">
      <div ref={container} className="signs-map" aria-label="서울 교통 표지판 지도" />
      {screen && current && <svg className="signs-overlay" width={screen.width} height={screen.height} aria-label="경찰청 일람표 번호와 인출선">
        {layout.labels.map(p => <line key={p.id} x1={p.x} y1={p.y} x2={Math.max(p.box.x, Math.min(p.x, p.box.x + p.box.w))} y2={Math.max(p.box.y, Math.min(p.y, p.box.y + p.box.h))} stroke={p.color} strokeWidth={p.id === selectedId ? 2 : 1} />)}
        {layout.points.map(p => <circle key={p.id} data-sign-id={p.id} data-verified={p.verified} cx={p.x} cy={p.y} r={p.id === selectedId ? 7 : 4} fill={p.color} stroke={p.id === selectedId ? '#172b46' : 'white'} strokeWidth={p.id === selectedId ? 2.5 : 1.5} className="signs-dot" onClick={() => setSelectedId(p.id)}><title>{p.label} · {p.verified ? '의미 확인' : '추가 확인 필요'} · 관리번호 {p.managementId}</title></circle>)}
        {layout.labels.map(p => <g key={p.id} className="signs-callout" onClick={() => setSelectedId(p.id)}>
          <rect x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} rx="4" fill={p.id === selectedId ? '#eef2f7' : '#fff'} stroke={p.id === selectedId ? '#172b46' : p.color} />
          <text x={p.box.x + p.box.w / 2} y={p.box.y + 16} textAnchor="middle" fill="#18314b">{p.label}</text>
        </g>)}
        <g transform={`translate(${screen.site.x},${screen.site.y})`}><path d="M0 -12L12 0L0 12L-12 0Z" fill="#172b46" stroke="white" strokeWidth="3" /><text y="-18" textAnchor="middle" className="signs-site-label">사업지</text></g>
      </svg>}
      {(!screen || mapError) && <div className="signs-map-message"><strong>{mapError ? '지도 연결 확인이 필요합니다' : current ? '지도를 불러오고 있습니다' : '주소와 조사 범위를 확인해 주세요'}</strong><p>{mapError || scopeError || error || '서울시 표지판 위치를 큰 지도에서 확인합니다.'}</p>{mapError && <button type="button" onClick={() => setRetryMap(v => v + 1)}>지도 다시 연결</button>}</div>}
      <div className="signs-map-legend"><table><caption>범례</caption><thead><tr><th scope="col">표시</th><th scope="col">의미</th></tr></thead><tbody>
        <tr><td><i className="signs-confirmed" aria-label="파란 점" /></td><td>표지 의미 확인</td></tr>
        <tr><td><i className="signs-unconfirmed" aria-label="빨간 점" /></td><td>추가 확인 필요</td></tr>
        <tr><td>123</td><td>일람표 번호 / 대응 후보</td></tr>
        <tr><td>?</td><td>일람표 번호 미확인</td></tr>
        <tr><td><i className="signs-site" /></td><td>사업지</td></tr>
        <tr><td><i className="signs-boundary" /></td><td>조사 범위</td></tr>
      </tbody></table></div>
    </div>
    {visible && <PoliceSignChart />}
    </div>
    <p className="signs-hint">빨간 점의 번호는 일람표와 번호만 일치하는 대응 후보이며, 의미가 확인된 번호가 아닙니다. 대응 미확인·도로 안내표지는 ?로 표시합니다. 현재 개별 의미 검증 완료 자료는 0건입니다. 밀집 구간은 확대하거나 아래 목록에서 선택하세요.</p>
    {current && <div className="signs-detail"><label><span>표지판 선택 · 공식 관리번호</span><select value={selected?.id || ''} onChange={e => choose(e.target.value)}><option value="">{points.length ? '관리번호를 선택하세요' : '범위 내 공개자료 없음'}</option>{points.map(p => <option value={p.id} key={p.id}>{p.managementId} · {p.label} · {SOURCE_NAMES[p.source]}</option>)}</select></label>
      <div aria-live="polite">{selected ? <><strong>{selected.policeCode ? `일람표 ${selected.policeCode}${selected.verified ? ' · 의미 확인' : ' · 대응 후보'}` : '수동확인필요'} · 관리번호 {selected.managementId}</strong><p>{selected.reason}</p><p>{SOURCE_NAMES[selected.source]} · 위도 {selected.lat} / 경도 {selected.lng}</p><p>{selected.source === 'S' ? `표지인덱스 ${selected.sourceIndex || '수동확인필요'} · 규격코드 ${selected.specification || '수동확인필요'}` : `표지종별 ${selected.sourceIndex || '수동확인필요'}`}</p>{selected.evidence && <p>확인 근거: {selected.evidence}</p>}</> : <p>지도 위 점 또는 관리번호를 선택하면 원본 정보와 확인 상태가 표시됩니다.</p>}</div></div>}
    {current && <details className="signs-provenance"><summary>자료 출처 · 파일 버전 · 제외 기준</summary>{current.manifest.sources.map(s => <p key={s.key}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> · 서울특별시 · 파일 버전 {s.fileVersion} · 시설 기준일 미확인 · {s.license}</p>)}<p>안전표지 좌표 불일치 {current.manifest.excluded.safety_coordinate_conflict || 0}건·중복 관리번호 {current.manifest.excluded.safety_duplicate_or_missing_id || 0}건, 도로표지 중복 {current.manifest.excluded.road_duplicate_or_missing_id || 0}건·검토 영역 밖 {current.manifest.excluded.road_outside_review_envelope || 0}건은 제외했습니다. 표지인덱스는 표지판 내용을 뜻하는 번호로 해석하지 않습니다.</p><p>개수는 공개자료 레코드 수이며 두 출처 간 동일 시설의 중복 여부는 확정하지 않았습니다. 공개자료에 없는 시설의 부재를 의미하지 않습니다. 파일 버전은 현장 조사일과 다르며, 실제 설치 현황은 확인이 필요합니다.</p></details>}
  </section>;
}
