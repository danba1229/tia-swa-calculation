"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./IndicatorCalculator.module.css";

const DIRS = ["north", "east", "south", "west"];
const LABEL = { north: "북", east: "동", south: "남", west: "서", excluded: "명시적 제외", internal: "내부" };
const NATIONAL_YEARS = [2023, 2025, 2030, 2035, 2040, 2045, 2050];

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({ error: "응답을 읽을 수 없습니다." }));
  if (!response.ok) {
    const error = new Error(payload.error || "요청에 실패했습니다.");
    error.code = payload.errorCode || payload.error_code;
    throw error;
  }
  return payload;
}

function post(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fmt(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "계산 불가";
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function pct(value) {
  return value === null || value === undefined ? "계산 불가" : `${fmt(Number(value) * 100, 2)}%`;
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function csvText(result) {
  const meta = [
    ["calculation_zone_system", result.calculation_zone.zone_system],
    ["calculation_zone_id", result.calculation_zone.zone_id],
    ["calculation_zone_region", result.calculation_zone.region_name],
    ["location_zone_system", result.location_zone.zone_system],
    ["location_zone_id", result.location_zone.zone_id],
    ["indicator_target_year", result.input.target_year],
    ["od_scenario_year", result.input.od_year],
    ["od_unit", result.access.unit],
    ["od_scope", result.access.scope],
    ["internal_trip_policy", result.access.internal.policy],
  ];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = result.rows.map((row) => [
    row.taz, row.region_name, row.default_direction, row.current_direction,
    row.assignment_source, row.bearing_degrees, row.inflow_to_target, row.outflow_from_target,
  ]);
  return "\uFEFF" + [
    ...meta,
    [],
    ["zone_id", "region_name", "default_direction", "current_direction", "assignment_source", "bearing_degrees", "inflow_to_target", "outflow_from_target"],
    ...rows,
  ].map((row) => row.map(quote).join(",")).join("\r\n");
}

function downloadableResult(result) {
  const { integrity_token: _integrityToken, storage_envelope: _storageEnvelope, ...publicResult } = result;
  return publicResult;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AuthPanel({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "", inviteCode: "" });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const payload = await post(`/api/indicator/auth/${mode}`, form);
      onAuthenticated(payload.user);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className={styles.center}>
    <section className={styles.authCard}>
      <p className={styles.eyebrow}>TIA SUPPORT · PRIVATE CALCULATOR</p>
      <h1>지표·O/D 접근강도 계산기</h1>
      <p>저장된 주소·방향 배정·결과는 사용자별 비공개 영역에 보관됩니다.</p>
      <div className={styles.tabs}>
        <button className={mode === "login" ? styles.active : ""} onClick={() => setMode("login")}>로그인</button>
        <button className={mode === "register" ? styles.active : ""} onClick={() => setMode("register")}>사용자 등록</button>
      </div>
      <form onSubmit={submit} className={styles.formStack}>
        <label>사용자 이름<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" required /></label>
        <label>비밀번호<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        {mode === "register" && <label>등록 승인 코드<input type="password" value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} required /></label>}
        <button disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "로그인" : "등록 후 시작"}</button>
      </form>
      {status && <p className={styles.error}>{status}</p>}
    </section>
  </main>;
}

export default function IndicatorCalculator() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [projects, setProjects] = useState([]);
  const [address, setAddress] = useState("");
  const [targetYear, setTargetYear] = useState(2029);
  const [odYear, setOdYear] = useState(2023);
  const [dataset, setDataset] = useState("auto");
  const [search, setSearch] = useState(null);
  const [candidateToken, setCandidateToken] = useState("");
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("상세 도로명 또는 지번 주소를 입력해 주세요.");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkDirection, setBulkDirection] = useState("north");
  const [groupName, setGroupName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [revision, setRevision] = useState("");
  const searchSequence = useRef(0);
  const pendingSaveOperation = useRef(null);

  useEffect(() => {
    requestJson("/api/indicator/auth/me").then((payload) => setUser(payload.user)).catch(() => setUser(null)).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user) refreshProjects();
  }, [user]);

  async function refreshProjects() {
    try {
      const payload = await requestJson("/api/indicator/projects");
      setProjects(payload.projects || []);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function invalidate(message) {
    searchSequence.current += 1;
    setSearch(null);
    setCandidateToken("");
    setResult(null);
    setProjectId("");
    setRevision("");
    setSelected(new Set());
    setStatus(message);
  }

  async function searchAddress() {
    const requested = address;
    const sequence = ++searchSequence.current;
    setBusy(true);
    setResult(null);
    setCandidateToken("");
    setStatus("카카오에서 주소를 확인 중입니다.");
    try {
      const payload = await post("/api/indicator_calculator", { action: "address-search", address: requested });
      if (sequence !== searchSequence.current || normalizeAddress(requested) !== normalizeAddress(address)) return;
      setSearch(payload);
      const automatic = payload.candidates.find((item) => item.candidate_id === payload.auto_select_candidate_id);
      if (automatic?.candidate_token) setCandidateToken(automatic.candidate_token);
      setStatus(payload.status === "VERIFIED_SINGLE_EXACT"
        ? "구체적인 단일 주소가 확인됐습니다. 계산을 실행하세요."
        : `${payload.confirmation_reason} (전체 ${payload.provider_total_count}건, 받은 후보 ${payload.received_candidate_count}건)`);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      setSearch(null);
      setStatus(`주소 확인 실패: ${error.message} 이전 위치와 계산 결과는 사용하지 않습니다.`);
    } finally {
      if (sequence === searchSequence.current) setBusy(false);
    }
  }

  async function calculate() {
    if (!candidateToken) return setStatus("구체적인 주소 후보를 먼저 확인해 주세요.");
    setBusy(true);
    setStatus("검증된 클라우드 자료로 계산 중입니다.");
    try {
      const payload = await post("/api/indicator_calculator", {
        action: "calculate", address, candidate_token: candidateToken,
        target_year: Number(targetYear), od_year: Number(odYear), access_dataset: dataset,
      });
      setResult(payload);
      setProjectId("");
      setRevision("");
      setSelected(new Set());
      setStatus(`계산 완료 · ${payload.calculation_zone.zone_system} / ${payload.calculation_zone.zone_id} / ${payload.calculation_zone.region_name}`);
    } catch (error) {
      setResult(null);
      setStatus(`계산 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyChanges(changes) {
    if (!result) return;
    setBusy(true);
    try {
      const payload = await post("/api/indicator_calculator", { action: "reassign", result, changes });
      setResult(payload);
      setStatus(`방향 재집계 완료 · 유입 분모 ${fmt(payload.access.denominators.inflow, 3)} / 유출 분모 ${fmt(payload.access.denominators.outflow, 3)}`);
    } catch (error) {
      setStatus(`방향 수정 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!result) return;
    const operationId = pendingSaveOperation.current || crypto.randomUUID();
    pendingSaveOperation.current = operationId;
    setBusy(true);
    try {
      const payload = await post("/api/indicator/projects", {
        projectId: projectId || undefined,
        baseRevision: revision || undefined,
        operationId,
        name: projectName,
        calculationEnvelope: result.storage_envelope,
      });
      setProjectId(payload.project.projectId);
      setRevision(payload.project.revision);
      pendingSaveOperation.current = null;
      setStatus(`영구 저장 완료 · 리비전 ${payload.project.revisionNumber}${payload.project.idempotentReplay ? " (중복 요청 재사용)" : ""}`);
      await refreshProjects();
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") pendingSaveOperation.current = null;
      setStatus(`저장 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadProject(id) {
    setBusy(true);
    try {
      const payload = await requestJson(`/api/indicator/projects?id=${encodeURIComponent(id)}`);
      const project = payload.project;
      setResult(project.calculation);
      setAddress(project.calculation.input.address);
      setTargetYear(project.calculation.input.target_year);
      setOdYear(project.calculation.input.od_year);
      setDataset(project.calculation.input.access_dataset);
      setProjectName(project.name);
      setProjectId(project.projectId);
      setRevision(project.revision);
      setSearch(null);
      setCandidateToken("");
      setSelected(new Set());
      setStatus(`저장 작업 재열람 완료 · 리비전 ${project.revisionNumber}`);
    } catch (error) {
      setStatus(`불러오기 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await post("/api/indicator/auth/logout", {});
    setUser(null);
    setResult(null);
  }

  const visibleRows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter((row) => {
      const textMatch = !filter || row.region_name.includes(filter) || String(row.taz).includes(filter);
      const directionMatch = !directionFilter || row.current_direction === directionFilter || (directionFilter === "user" && row.assignment_source.startsWith("USER"));
      return textMatch && directionMatch;
    });
  }, [result, filter, directionFilter]);

  const groups = useMemo(() => result ? [...new Set(result.rows.map((row) => row.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")) : [], [result]);

  if (!authChecked) return <main className={styles.center}>로그인 상태 확인 중…</main>;
  if (!user) return <AuthPanel onAuthenticated={setUser} />;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>TIA SUPPORT · CLOUD CALCULATOR</p><h1>지표·O/D 접근강도 계산기</h1><p>주소 확인부터 방향 수정과 재열람까지 Vercel에서 실행됩니다.</p></div>
      <div className={styles.user}><span>{user.username}</span><button className={styles.ghost} onClick={logout}>로그아웃</button></div>
    </header>

    <section className={styles.card}>
      <h2>1. 주소와 연도</h2>
      <div className={styles.grid}>
        <label className={styles.wide}>사업지 상세 주소<input value={address} onChange={(e) => { setAddress(e.target.value); invalidate("주소가 바뀌어 이전 후보·TAZ·계산·방향 상태를 무효화했습니다."); }} placeholder="예: 경기도 수원시 팔달구 효원로 241" /></label>
        <label>지표 목표연도<input type="number" min="2023" max="2050" value={targetYear} onChange={(e) => { setTargetYear(e.target.value); setResult(null); setStatus("목표연도가 바뀌어 다시 계산해야 합니다."); }} /></label>
        <label>O/D 시나리오 연도<select value={odYear} onChange={(e) => { setOdYear(e.target.value); setResult(null); }}>{NATIONAL_YEARS.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label>접근강도 자료<select value={dataset} onChange={(e) => { setDataset(e.target.value); setResult(null); }}><option value="auto">지역에 맞게 자동 선택</option><option value="metro_capital_region_2023">수도권 1,310존·2023</option><option value="national_250_purpose_total">전국 250존</option><option value="metro_capital_linkage_only_2023">수도권 연계 통행만</option></select></label>
        <div className={styles.actions}><button onClick={searchAddress} disabled={busy || !address.trim()}>주소 확인</button><button onClick={calculate} disabled={busy || !candidateToken}>계산</button></div>
      </div>
      {search && <div className={styles.candidates}>{search.candidates.map((candidate) => <label key={candidate.candidate_id} className={!candidate.selection_eligible ? styles.disabledCandidate : ""}><input type="radio" name="candidate" disabled={!candidate.selection_eligible} checked={candidateToken === candidate.candidate_token} onChange={() => setCandidateToken(candidate.candidate_token || "")} /><span><b>{candidate.road_address_name || candidate.land_lot_address_name || candidate.address_name}</b><small>{candidate.specificity_status} · 위도 {candidate.latitude}, 경도 {candidate.longitude}</small></span></label>)}</div>}
      <p className={styles.status}>{busy ? "처리 중… " : ""}{status}</p>
    </section>

    <section className={styles.card}>
      <div className={styles.sectionHead}><div><h2>저장한 작업</h2><p>새 브라우저나 함수 재시작 후에도 사용자별로 복원됩니다.</p></div><button className={styles.ghost} onClick={refreshProjects}>목록 새로고침</button></div>
      <div className={styles.projectList}>{projects.length ? projects.map((project) => <button className={styles.projectButton} key={project.projectId} onClick={() => loadProject(project.projectId)}><b>{project.name}</b><span>{project.address} · {project.targetYear}년 · {project.calculationZone?.zone_system}/{project.calculationZone?.zone_id}</span></button>) : <p>저장한 작업이 없습니다.</p>}</div>
    </section>

    {result && <>
      <section className={styles.card}>
        <h2>2. 계산 결과</h2>
        <div className={styles.metrics}>
          <div><span>실제 O/D 계산 존</span><b>{result.calculation_zone.zone_system}<br />{result.calculation_zone.zone_id} · {result.calculation_zone.region_name}</b></div>
          <div><span>참고 위치 판정 존</span><b>{result.location_zone.zone_system}<br />{result.location_zone.zone_id} · {result.location_zone.region_name}</b></div>
          <div><span>지표 범위·연도</span><b>{result.indicator.spatial_scope}<br />{result.input.target_year}년</b></div>
          <div><span>O/D 자료·연도</span><b>{result.access.zone_system}<br />{result.access.scenario_year}년 · {result.access.unit}</b></div>
        </div>
        <p className={styles.notice}>{result.access.interpretation_limit}</p>
        <div className={styles.metrics}>
          <div><span>인구</span><b>{fmt(result.indicator.population.display_integer)}명</b></div>
          <div><span>목적통행 합계</span><b>{fmt(result.indicator.purpose_display_total)}</b></div>
          <div><span>주수단 합계</span><b>{fmt(result.indicator.mode_display_total)}</b></div>
          <div><span>계산 시간</span><b>{fmt(result.runtime?.elapsed_ms, 1)}ms</b></div>
        </div>
        <div className={styles.directionCards}>{DIRS.map((direction) => <div key={direction}><b>{LABEL[direction]}</b><span>유입 {pct(result.access.directions[direction].inflow_share)}</span><span>유출 {pct(result.access.directions[direction].outflow_share)}</span></div>)}</div>
        <p className={result.access.status === "COMPLETE" ? styles.ok : styles.warning}>상태 {result.access.status} · 외부 유입 분모 {fmt(result.access.denominators.inflow, 3)} · 외부 유출 분모 {fmt(result.access.denominators.outflow, 3)} · 내부통행 {fmt(result.access.internal.inflow, 3)} · 제외 존 {result.access.excluded.zone_count}</p>
      </section>

      <section className={styles.card}>
        <h2>3. 방향 확인·수정</h2>
        <p>{result.direction_basis.warning}</p>
        <div className={styles.toolbar}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="지역명·존 ID 검색" />
          <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}><option value="">모든 방향</option>{DIRS.map((direction) => <option value={direction} key={direction}>{LABEL[direction]}</option>)}<option value="excluded">명시적 제외</option><option value="user">사용자 수정</option></select>
          <select value={bulkDirection} onChange={(e) => setBulkDirection(e.target.value)}>{[...DIRS, "excluded", "auto"].map((direction) => <option value={direction} key={direction}>{LABEL[direction] || "자동 복원"}</option>)}</select>
          <button onClick={() => applyChanges(Object.fromEntries([...selected].map((id) => [id, bulkDirection])))} disabled={!selected.size}>선택 {selected.size}개 적용</button>
          <select value={groupName} onChange={(e) => setGroupName(e.target.value)}><option value="">행정지역 묶음</option>{groups.map((group) => <option key={group}>{group}</option>)}</select>
          <button onClick={() => applyChanges(Object.fromEntries(result.rows.filter((row) => row.group_name === groupName && row.current_direction !== "internal").map((row) => [row.taz, bulkDirection])))} disabled={!groupName}>묶음 적용</button>
        </div>
        <div className={styles.tableWrap}><table><thead><tr><th>선택</th><th>계산 존 ID</th><th>지역</th><th>자동</th><th>현재</th><th>유입</th><th>유출</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.taz}><td>{row.current_direction !== "internal" && <input type="checkbox" checked={selected.has(row.taz)} onChange={(e) => setSelected((previous) => { const next = new Set(previous); e.target.checked ? next.add(row.taz) : next.delete(row.taz); return next; })} />}</td><td>{row.taz}</td><td>{row.region_name}</td><td>{LABEL[row.default_direction] || "미배정"}</td><td>{row.current_direction === "internal" ? "내부" : <select value={row.current_direction || "auto"} onChange={(e) => applyChanges({ [row.taz]: e.target.value })}>{[...DIRS, "excluded", "auto"].map((direction) => <option value={direction} key={direction}>{LABEL[direction] || "자동 복원"}</option>)}</select>}</td><td>{fmt(row.inflow_to_target, 3)}</td><td>{fmt(row.outflow_from_target, 3)}</td></tr>)}</tbody></table></div>
      </section>

      <section className={styles.card}>
        <h2>4. 저장·재열람·다운로드</h2>
        <div className={styles.saveRow}><input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="사업명" /><button onClick={saveProject} disabled={busy || !projectName.trim()}>현재 작업 저장</button><button className={styles.ghost} onClick={() => download(`${result.calculation_zone.zone_system}_${result.calculation_zone.zone_id}_${result.input.target_year}.json`, JSON.stringify(downloadableResult(result), null, 2), "application/json;charset=utf-8")}>JSON</button><button className={styles.ghost} onClick={() => download(`${result.calculation_zone.zone_system}_${result.calculation_zone.zone_id}_${result.input.target_year}.csv`, csvText(result), "text/csv;charset=utf-8")}>CSV</button></div>
        <p>저장 리비전: {revision || "아직 저장하지 않음"} · 검증 상태: {result.verification_status}</p>
      </section>
    </>}
  </main>;
}
