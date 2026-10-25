'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FACILITY_TYPES, facilityScope, facilityCsv } from '../lib/trafficFacilities';
import { layoutSignLabels } from '../lib/trafficSigns';

const STATUS = { unavailable:'자료 미연결', failed:'조회 실패', candidate:'과거자료 후보', historical:'과거자료', partial:'일부 자료', snapshot:'공개파일', available:'조회 가능', unclassified:'분류 미확인' };
const typeOf = key => FACILITY_TYPES.find(t=>t.key===key);
export default function TrafficFacilitiesStep({ visible, siteLocation, region, width, height, refresh, loadMaps, onPhase }) {
  const [result,setResult]=useState(null),[error,setError]=useState(''),[selectedId,setSelectedId]=useState('');
  const [enabled,setEnabled]=useState(()=>FACILITY_TYPES.map(t=>t.key)),[screen,setScreen]=useState(null),[mapError,setMapError]=useState(''),[retry,setRetry]=useState(0),[page,setPage]=useState(0);
  const container=useRef(null),mapRef=useRef(null),fit=useRef(null),pointsRef=useRef([]),redraw=useRef(null);
  const key=JSON.stringify([siteLocation.address,siteLocation.status,siteLocation.lat,siteLocation.lng,region,width,height,refresh]);
  let scopeError='';
  if (siteLocation.status!=='ready') scopeError=siteLocation.message || '상단에 주소를 입력해 주세요.';
  else { try { facilityScope({lat:siteLocation.lat,lng:siteLocation.lng,region,width,height}); } catch(e) {scopeError=e.message;} }
  const current=result?.key===key&&!scopeError?result:null;
  useEffect(()=>{
    if(!visible) return;
    setError('');setResult(null);setSelectedId('');setPage(0);
    if(scopeError){onPhase('idle');return;}
    const controller=new AbortController();onPhase('loading');
    const timer=setTimeout(async()=>{
      try {
        const query=new URLSearchParams({lat:siteLocation.lat,lng:siteLocation.lng,region,width,height});
        const response=await fetch(`/api/traffic-facilities?${query}`,{signal:controller.signal});const data=await response.json();
        if(!response.ok)throw new Error(data.message||'시설물 조회 실패');
        if(controller.signal.aborted)return;
        setResult({...data,key});onPhase('partial');
      }catch(e){if(!controller.signal.aborted){setError(e.message);onPhase('failed');}}
    },300);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[visible,key,scopeError,siteLocation.lat,siteLocation.lng,region,width,height,onPhase]);
  const points=useMemo(()=>(current?.points||[]).filter(p=>enabled.includes(p.kind)),[current,enabled]);
  const selected=points.find(p=>p.id===selectedId);
  useEffect(()=>{pointsRef.current=points;redraw.current?.();},[points]);
  useEffect(()=>{
    if(!visible||!current||!container.current){setScreen(null);return;}
    let cancelled=false,map,kakao,observer,frame,rectangle;const node=container.current;
    setScreen(null);setMapError('');
    const draw=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(cancelled||!map)return;
      const project=p=>{const q=map.getProjection().containerPointFromCoords(new kakao.maps.LatLng(p.lat,p.lng));return {...p,x:q.x,y:q.y};};
      setScreen({width:node.clientWidth,height:node.clientHeight,site:project(current.scope),points:pointsRef.current.map(project)});
    });};
    redraw.current=draw;
    loadMaps().then(sdk=>{
      if(cancelled)return;kakao=sdk;const s=current.scope;
      map=new kakao.maps.Map(node,{center:new kakao.maps.LatLng(s.lat,s.lng),level:3});mapRef.current=map;
      const bounds=new kakao.maps.LatLngBounds(new kakao.maps.LatLng(s.south,s.west),new kakao.maps.LatLng(s.north,s.east));
      rectangle=new kakao.maps.Rectangle({map,bounds,strokeWeight:2,strokeColor:'#2563eb',strokeStyle:'dash',fillColor:'#dbeafe',fillOpacity:.06});
      map.addControl(new kakao.maps.ZoomControl(),kakao.maps.ControlPosition.RIGHT);
      fit.current=()=>{map.relayout();map.setBounds(bounds,45,45,65,45);draw();};
      for(const ev of ['bounds_changed','idle'])kakao.maps.event.addListener(map,ev,draw);
      observer=new ResizeObserver(()=>{map.relayout();draw();});observer.observe(node);fit.current();
    }).catch(e=>{if(!cancelled)setMapError(e.message||'지도를 불러오지 못했습니다.');});
    return ()=>{cancelled=true;cancelAnimationFrame(frame);observer?.disconnect();if(map)for(const ev of ['bounds_changed','idle'])kakao.maps.event.removeListener(map,ev,draw);rectangle?.setMap(null);mapRef.current=null;redraw.current=null;fit.current=null;node.replaceChildren();};
  },[visible,current,loadMaps,retry]);
  const layout=useMemo(()=>screen?layoutSignLabels(screen.points,screen.width,screen.height,selectedId,[{x:screen.width-222,y:screen.height-330,w:212,h:310}]):{points:[],labels:[]},[screen,selectedId]);
  const select=id=>{setSelectedId(id);const p=points.find(x=>x.id===id);if(p&&mapRef.current&&window.kakao)mapRef.current.panTo(new window.kakao.maps.LatLng(p.lat,p.lng));};
  const toggle=kind=>{setEnabled(v=>v.includes(kind)?v.filter(x=>x!==kind):[...v,kind]);setPage(0);setSelectedId('');};
  const download=()=>{const url=URL.createObjectURL(new Blob([facilityCsv(points,current.sources)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='교통시설물_조사목록.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className={`panel step-section traffic-facilities ${visible?'':'is-hidden'}`} aria-label="STEP 10 교통시설물">
    <div className="signs-heading"><div><p className="eyebrow">STEP 10 · SEOUL / GYEONGGI</p><h2>교통시설물 위치도</h2><p>사업지 시·도의 시설 대표점을 표시합니다. 번호는 종류별 조사 순번입니다.</p></div><button type="button" className="secondary" disabled={!current||!points.length} onClick={download}>표시 목록 CSV</button></div>
    <p className="signs-review-notice"><strong>모든 자료는 추가 확인이 필요합니다.</strong> 과거자료·일부 지역 자료를 포함하며, 미표시가 시설 없음을 뜻하지 않습니다. 주소 변환 위치와 신호교차로 후보는 현장·로드뷰로 확인하세요.</p>
    <div className="facility-filters" role="group" aria-label="교통시설물 종류">{FACILITY_TYPES.map(t=>{const c=current?.coverage.find(c=>c.key===t.key),n=current?.points.filter(p=>p.kind===t.key).length;return <button type="button" key={t.key} aria-pressed={enabled.includes(t.key)} onClick={()=>toggle(t.key)}><i style={{background:t.color}}/><span>{t.mapLabel||t.label}</span><small>{c?.status==='unavailable'?'미연결':c?.status==='failed'?'오류':current?`${n}개 표시`:'—'}</small></button>;})}</div>
    <div className="facility-status" role="status">{scopeError||error||(!current?'시설물 자료를 조회하고 있습니다…':`표시지점 ${points.length.toLocaleString()}개 · ${current.scope.width} × ${current.scope.height}m · 추가 확인 필요`)}{current?.busError&&<span> · {current.busError}</span>}</div>
    <div className="facility-workbench">
      <div className="signs-map-frame">
        <div ref={container} className="signs-map" aria-label="서울 경기 교통시설물 카카오 지도"/>
        {screen&&current&&<svg className="signs-overlay" width={screen.width} height={screen.height} aria-label="시설물 지점과 인출선">
          {layout.labels.map(p=><line key={p.id} x1={p.x} y1={p.y} x2={Math.max(p.box.x,Math.min(p.x,p.box.x+p.box.w))} y2={Math.max(p.box.y,Math.min(p.y,p.box.y+p.box.h))} stroke={p.color} strokeWidth={p.id===selectedId?2:1}/>)}
          {layout.points.map(p=><circle key={p.id} data-facility-id={p.id} cx={p.x} cy={p.y} r={p.id===selectedId?7:4.5} fill={p.color} stroke="white" strokeWidth="1.5" className="signs-dot" onClick={()=>select(p.id)}><title>{p.label} {p.name} · {p.positionBasis} · 추가확인필요</title></circle>)}
          {layout.labels.map(p=><g key={p.id} className="facility-callout" role="button" tabIndex="0" aria-label={`${p.label} ${p.name} 상세 보기`} onClick={()=>select(p.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(p.id);}}}><rect x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} rx="4" fill={p.id===selectedId?'#e0f2fe':'white'} stroke={p.color}/><text x={p.box.x+p.box.w/2} y={p.box.y+16} textAnchor="middle" fill="#18314b">{p.label}</text></g>)}
          <g transform={`translate(${screen.site.x},${screen.site.y})`}><path d="M0 -10L10 0L0 10L-10 0Z" fill="#172b46" stroke="white" strokeWidth="2"/><text y="-15" textAnchor="middle" className="signs-site-label">사업지</text></g>
        </svg>}
        {(!screen||mapError)&&<div className="signs-map-message"><strong>{mapError?'지도 연결 확인 필요':scopeError?'주소와 범위를 확인해 주세요':'지도를 준비하고 있습니다'}</strong><p>{mapError||scopeError||error}</p>{mapError&&<button type="button" onClick={()=>setRetry(v=>v+1)}>지도 다시 연결</button>}</div>}
        <div className="signs-map-legend facility-legend"><table><caption>범례</caption><thead><tr><th>표시</th><th>의미</th></tr></thead><tbody>{FACILITY_TYPES.filter(t=>enabled.includes(t.key)).map(t=><tr key={t.key}><td><i style={{background:t.color}}/> {t.prefix}</td><td>{t.mapLabel||t.label}</td></tr>)}<tr><td>◆</td><td>사업지</td></tr></tbody></table></div>
      </div>
      <aside className="facility-details" aria-label="시설물 상세 정보">
        <div className="facility-detail-heading"><h3>선택 시설</h3><button type="button" className="mini-button" onClick={()=>fit.current?.()} disabled={!screen}>범위에 맞추기</button></div>
        {selected?<div aria-live="polite"><p className="facility-selected-number" style={{color:selected.color}}>{selected.label} · {typeOf(selected.kind).mapLabel||typeOf(selected.kind).label}</p><h4>{selected.name||'시설명 미제공'}</h4><dl><dt>사업지와 거리</dt><dd>{selected.distance.toLocaleString()}m</dd><dt>위치 근거</dt><dd>{selected.positionBasis}</dd><dt>자료 기준일</dt><dd>{selected.referenceDate||'미확인'}</dd><dt>파일 버전</dt><dd>{current.sources[selected.sourceId]?.fileVersion||'미확인'}</dd><dt>원본 식별자</dt><dd>{selected.id}</dd></dl>{selected.address&&<p>{selected.address}</p>}<p>{selected.remark}</p><p className="facility-source-note">{current.sources[selected.sourceId]?.note}</p><div className="facility-links"><a href={selected.roadviewUrl} target="_blank" rel="noopener noreferrer">카카오 로드뷰 ↗</a>{current.sources[selected.sourceId]?.url&&<a href={current.sources[selected.sourceId].url} target="_blank" rel="noopener noreferrer">공식 출처 ↗</a>}</div></div>:<p className="facility-empty">지도 번호 또는 아래 목록을 선택하세요. 밀집 구간은 지도를 확대하면 번호를 더 확인할 수 있습니다.</p>}
        <details open className="facility-coverage"><summary>자료 연결 범위</summary>{(current?.coverage||[]).filter(t=>t.key!=='unknown_intersection').map(t=><div key={t.key}><strong>{t.label} <small>{STATUS[t.status]}</small></strong><p>{t.note}</p></div>)}</details>
      </aside>
    </div>
    {current&&<><div className="subpanel-header"><h3>교통시설물 목록</h3><p className="subpanel-source">시설 대표점 기준 · 전 항목 추가확인필요 · 근사위치는 실제 시설 중심과 다를 수 있음</p></div><div className="table-wrap"><table className="data-table facility-table"><thead><tr><th>번호</th><th>종류</th><th>시설명</th><th>거리</th><th>위치 근거</th><th>자료 기준일</th><th>파일 버전</th><th>확인</th></tr></thead><tbody>{points.slice(page*100,(page+1)*100).map(p=><tr key={p.id} className={p.id===selectedId?'facility-selected-row':''}><td><button className="mini-button" type="button" onClick={()=>select(p.id)}>{p.label}</button></td><td>{typeOf(p.kind).mapLabel||typeOf(p.kind).label}</td><td>{p.name||'수동확인필요'}</td><td>{p.distance.toLocaleString()}m</td><td>{p.positionBasis}</td><td>{p.referenceDate||'수동확인필요'}</td><td>{current.sources[p.sourceId]?.fileVersion||'수동확인필요'}</td><td><a href={p.roadviewUrl} target="_blank" rel="noopener noreferrer">로드뷰 ↗</a></td></tr>)}</tbody></table></div>{!points.length&&<p className="facility-empty">선택한 종류의 표시 가능한 자료가 없습니다. ‘자료 연결 범위’를 확인하세요. 시설이 없다는 판정은 아닙니다.</p>}{points.length>100&&<div className="facility-pagination"><button type="button" disabled={!page} onClick={()=>setPage(v=>v-1)}>이전</button><span>{page+1} / {Math.ceil(points.length/100)} 페이지 · CSV에는 필터 결과 전체 포함</span><button type="button" disabled={(page+1)*100>=points.length} onClick={()=>setPage(v=>v+1)}>다음</button></div>}
      <details className="signs-provenance"><summary>출처·수록범위·기준일</summary><p>파일 버전과 조회일은 현장 조사일이 아닙니다. 버스는 기존 조회 자료를 사용하며 다른 시설은 공개파일 스냅샷입니다. 점으로 변환한 시설은 대표점이 범위 안에 있을 때 표시합니다. 서로 다른 시설의 근접 위치만으로 합치지 않습니다.</p>{Object.entries(current.sources).map(([id,s])=><p key={id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a> · {s.fileVersion} · {s.note}</p>)}<p>경기 횡단보도 수록 시군·구: {current.gyeonggiCrosswalkDistricts.join(', ')}. 각 지역 내 전수 수록을 보장하지 않습니다.</p></details></>}
  </section>;
}
