"use client";

import { useEffect, useState } from "react";
import { monthWeeks, trafficDateLabel, WEEKDAYS } from "../lib/trafficPeak";
import { gyeonggiPointLink, peakAnalysisIdentity, peakConnectionRows } from "../lib/trafficPointLink";
import styles from "./TrafficPeakAnalysis.module.css";

const number = (value) => value === null || value === undefined ? "—" : value.toLocaleString("ko-KR");
const hourLabel = (h) => `${String(h).padStart(2, "0")}:00~${String(h + 1).padStart(2, "0")}:00`;
const dateLabel = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

export default function TrafficPeakAnalysis({ region, candidates = [], selectedCandidate = null, address, active, onMapPointChange }) {
  const [catalog, setCatalog] = useState(null);
  const [month, setMonth] = useState("");
  const [week, setWeek] = useState("");
  const [chosenStation, setChosenStation] = useState("");
  const [direction, setDirection] = useState("both");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [reference, setReference] = useState(false);
  const [pointSearch, setPointSearch] = useState("");
  const isGyeonggi = region === "gyeonggi";
  const supported = region === "seoul" || isGyeonggi;
  const endpoint = isGyeonggi ? "/api/traffic-volume/gyeonggi" : "/api/traffic-volume";
  const providerName = isGyeonggi ? "경기데이터드림 상시교통량(일반국도 시간대별)" : "서울 TOPIS 지점별 일자별 교통량";
  const metadata = catalog?.months.find((m) => m.month === month);
  const points = metadata?.points || [];
  const link = gyeonggiPointLink(selectedCandidate, points, month);
  const preferred = !isGyeonggi ? candidates.find((c) => points.some((p) => p.code === c.code))?.code || "" : "";
  const station = isGyeonggi && !reference ? link.station : points.some((p) => p.code === chosenStation) ? chosenStation : preferred;
  const point = points.find((p) => p.code === station);
  const identity = peakAnalysisIdentity({ provider: region, address, candidate: selectedCandidate, station, month, reference });
  const listedPoints = isGyeonggi && reference ? points.filter((p) => p.code === station || `${p.code} ${p.name}`.toLowerCase().includes(pointSearch.trim().toLowerCase())) : points;
  const weeks = month ? monthWeeks(month) : [];

  useEffect(() => {
    onMapPointChange?.(isGyeonggi && point ? { address, point, month } : null);
    return () => onMapPointChange?.(null);
  }, [onMapPointChange, isGyeonggi, address, point, month]);

  useEffect(() => {
    if (!active || !supported || !address.trim()) return;
    const abort = new AbortController();
    setError("");
    setCatalog(null);
    setCatalogLoading(true);
    fetch(endpoint, { signal: abort.signal }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (abort.signal.aborted) return;
      setCatalog(data);
      setMonth((old) => data.months.some((m) => m.month === old) ? old : data.months[0]?.month || "");
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setCatalogLoading(false); });
    return () => abort.abort();
  }, [active, supported, endpoint, address, refresh]);

  useEffect(() => {
    if (!month) { setWeek(""); return; }
    const rows = monthWeeks(month);
    setWeek((old) => rows.some((w) => w[0] === old) ? old : (rows.find((w) => w.every((d) => d.startsWith(month))) || rows[0])[0]);
  }, [month]);

  useEffect(() => {
    setResult(null);
    if (!active || !supported || !station || !week) { setLoading(false); return; }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ station, week, direction });
    fetch(`${endpoint}?${params}`, { signal: abort.signal }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (!abort.signal.aborted) setResult({ ...data, identity });
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [active, supported, endpoint, station, week, direction, refresh, identity]);

  const visible = result && !catalogLoading && result.identity === identity && result.station === station && result.weekStart === week && result.direction === direction ? result : null;
  function downloadCsv() {
    if (!visible) return;
    const rows = [["지점번호", station, "지점명", point?.name || "", "방향", direction],
      ...(isGyeonggi ? peakConnectionRows({ candidate: selectedCandidate, point, month, link, reference }) : []),
      ["시간", ...visible.days.map((d) => `${d.date}(${d.label})`)],
      ...Array.from({ length: 24 }, (_, h) => [hourLabel(h), ...visible.days.map((d) => d.hours[h] ?? "")]),
      ["일교통량(24시간 완전자료만)", ...visible.days.map((d) => d.total ?? "")],
      ["첨두일", ...visible.peakDays], ["주간 최대시간", ...visible.peakCells],
      ["결측 안내", visible.warning], ["출처", providerName],
      ...visible.sources.map((s) => ["원자료", s.fileName, "SHA256", s.sourceSha256, "수집시각", s.collectedAt])];
    const text = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${isGyeonggi ? "GG" : "TOPIS"}_${station}_${week}_주간교통량.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!address.trim()) return <div id="weekly-traffic-analysis" className={styles.box}><h3>첨두일·첨두시간 분석</h3><p>상단 주소를 입력한 뒤 서울 또는 경기도의 교통량 분석 지점을 선택하세요.</p></div>;
  if (!supported) return <div id="weekly-traffic-analysis" className={styles.box}><h3>첨두일·첨두시간 분석</h3><p>서울 TOPIS와 경기도 일반국도 상시교통량을 지원합니다. 다른 지역을 서울 자료로 대체하지 않습니다.</p></div>;

  const failedSync = visible?.sync.filter((s) => ["FAILED", "PARTIAL"].includes(s.status)) || [];
  return <div id="weekly-traffic-analysis" className={styles.box} aria-busy={loading || catalogLoading}>
    <div className={styles.heading}><div><p className="eyebrow">WEEKLY TRAFFIC · {isGyeonggi ? "GYEONGGI" : "TOPIS"}</p><h3>첨두일·첨두시간 분석</h3></div>
      <div className={styles.actions}><button type="button" className="secondary-button" onClick={() => setRefresh((n) => n + 1)}>저장자료 새로고침</button>
        <button type="button" className="secondary-button" disabled={!visible} onClick={downloadCsv}>분석표 CSV</button></div></div>
    <p className={styles.help}>{isGyeonggi ? "경기데이터드림의 실제 수록 월을 표시합니다. 최초 조회 시 전체 페이지를 수집하며, 이후 24시간 동안 저장자료를 재사용합니다. 지점번호·노선·지역·자료연도가 일치할 때만 자동 연결합니다." : "월별 공식 엑셀을 사용합니다. 달력에서 한 주를 선택하세요. 월 경계의 주는 인접 월의 저장자료도 함께 조회합니다."}</p>
    {isGyeonggi && <div className={styles.connection} aria-label="경기 사전조사지점 첨두분석 연결">
      <h4>사전조사지점 연결</h4>
      <p>GITS 추천지점: <strong>{selectedCandidate ? `${selectedCandidate.pointCode} · ${selectedCandidate.routeName}` : "없음"}</strong>
        {selectedCandidate && ` / ${selectedCandidate.jurisdiction} / ${selectedCandidate.sectionName} / 자료연도 ${selectedCandidate.sourceYear || "미확인"}`}</p>
      <p role="status">{catalogLoading ? "실제 수록 지점과 연결 여부를 확인하고 있습니다." : !catalog ? "교통량 목록을 확인하지 못해 연결 여부를 판단할 수 없습니다." : `${link.status === "MATCHED" ? "동일 지점 연결" : link.status === "NO_DATA" ? "연결 자료 없음" : "자동 연결 보류"}: ${link.note}`}</p>
      <div className={styles.actions}>
        <button type="button" className="secondary-button" disabled={!catalog} aria-pressed={!reference} onClick={() => { setReference(false); setChosenStation(""); setResult(null); }}>동일 지점만 분석</button>
        <button type="button" className="secondary-button" disabled={!catalog} aria-pressed={reference} onClick={() => { setReference(true); setChosenStation(""); setResult(null); }}>별도 참고지점 직접 선택</button>
      </div>
      {reference && <p className={styles.warning}>참고지점 분석 모드입니다. 선택한 상시조사지점의 교통량이며, GITS 추천지점의 교통량으로 대체하거나 해당 지점의 첨두일로 확정하지 않습니다.</p>}
      <p className={styles.help}>상시지점은 일반국도 자료만 제공하며, 정확 좌표·거리가 검증되지 않아 최근접 순으로 추천하지 않습니다. 지점을 선택하면 좌측 지도에서 위치 후보를 확인하여 참고 근사위치로 표시할 수 있습니다. 원자료의 노선·지역·수록 월을 확인해 주세요.</p>
    </div>}
    <div className={styles.controls}>
      <div className={styles.calendar}>
        <label>자료 월<select aria-label="교통량 자료 월" value={month} onChange={(e) => { setMonth(e.target.value); setResult(null); }}>
          {!catalog?.months.length && <option value="">수집된 월 없음</option>}
          {catalog?.months.map((m) => <option key={m.month} value={m.month}>{m.month.replace("-", "년 ")}월</option>)}
        </select></label>
        <div className={styles.weekday} aria-hidden="true">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
        <div role="group" aria-label="주간 교통량 달력">{weeks.map((dates) => <button type="button" key={dates[0]}
          aria-label={`${dates[0]}부터 ${dates[6]}까지 선택`} aria-pressed={week === dates[0]}
          className={`${styles.week} ${week === dates[0] ? styles.selected : ""}`}
          onClick={() => { setWeek(dates[0]); setResult(null); }}>
          {dates.map((d) => <span key={d} className={d.startsWith(month) ? "" : styles.outside}>{Number(d.slice(8))}</span>)}
        </button>)}</div>
      </div>
      <div className={styles.options}>
        {isGyeonggi && reference && <label>참고지점 검색<input aria-label="참고지점 검색" value={pointSearch} onChange={(e) => setPointSearch(e.target.value)} placeholder="지점번호, 노선명 또는 지역명" /></label>}
        <label>{isGyeonggi && reference ? "별도 참고 분석지점" : "분석 지점"}<select aria-label="교통량 분석 지점" value={station} disabled={isGyeonggi && !reference} onChange={(e) => { setChosenStation(e.target.value); setResult(null); }}>
          <option value="">분석 지점을 선택하세요</option>
          {listedPoints.map((p) => <option key={p.code} value={p.code}>{!isGyeonggi && candidates.some((c) => c.code === p.code) ? "[인근 후보] " : ""}{p.code} · {p.name}</option>)}
        </select></label>
        {isGyeonggi && reference && !listedPoints.length && <p className={styles.help}>선택 월에 검색어와 일치하는 수록 지점이 없습니다.</p>}
        <label>교통량 방향<select aria-label="교통량 방향" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="both">양방향 합계</option><option value="in">{isGyeonggi ? "원자료 방향 " : "유입 "}{point?.directions.in || (isGyeonggi ? "1" : "")}</option><option value="out">{isGyeonggi ? "원자료 방향 " : "유출 "}{point?.directions.out || (isGyeonggi ? "2" : "")}</option>
        </select></label>
        <p className={styles.help}>{isGyeonggi ? "지점번호·노선·지역을 확인해 사업지와 관련된 상시조사지점을 선택하세요. 방향은 원자료의 1/2 코드와 명칭을 그대로 표시합니다." : "인근 후보는 거리 기준입니다. 사업지 접근도로와의 관련성을 확인한 후 분석 지점을 확정하세요."}</p>
        {metadata && <a href={`${endpoint}?source=${month}`}>선택 월 원자료 {isGyeonggi ? "JSON" : "엑셀"} 다운로드</a>}
        <a href={isGyeonggi ? "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=5YXX2DGXASTB4S54AEEP32699329&infSeq=1" : "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily"} target="_blank" rel="noreferrer">{isGyeonggi ? "경기데이터드림 공식 자료" : "TOPIS 공식 자료실"}</a>
        {visible && <div className={styles.summary} aria-label="주간 교통량 분석 요약" aria-live="polite">
          <span><small>분석 주간</small><strong>{trafficDateLabel(visible.weekStart)} ~ {trafficDateLabel(visible.weekEnd)}</strong></span>
          <span><small>첨두일 · 일교통량 최대</small><strong>{visible.peakDays.length ? visible.peakDays.map(trafficDateLabel).join(", ") : visible.complete ? "최대일 구분 없음" : "선정 보류"}</strong><small>{visible.dailyMax !== null ? `${number(visible.dailyMax)}대/일` : "7일 완전자료 필요"}</small></span>
        </div>}
      </div>
    </div>
    <div aria-live="polite">
      {(loading || catalogLoading) && <p className={styles.message}>{isGyeonggi ? "경기도 교통량을 조회 중입니다. 최초 전체 수집은 시간이 걸릴 수 있습니다." : "저장된 교통량으로 주간 분석 중입니다."}</p>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {catalog?.warning && <p className={styles.warning}>{catalog.warning}</p>}
      {catalog && !catalog.months.length && <p className={styles.warning}>아직 수집된 월별 원자료가 없습니다. 수집이 완료된 뒤 조회해 주세요. 0으로 대체하지 않습니다.</p>}
      {visible && <>
        {isGyeonggi && <p className={styles.warning}>{reference ? "별도 참고지점 분석" : "동일 지점 분석"}: {point?.code} · {point?.name} / {month} 수록자료{reference ? " · GITS 추천지점의 측정값이 아닙니다." : ""}</p>}
        {visible.warning && <p className={styles.warning}>{visible.warning}</p>}
        {failedSync.length > 0 && <p className={styles.warning}>최근 원문 갱신에 실패한 기간이 있습니다. 기존 검증 자료로 분석했으며 최신성 확인이 필요합니다. {failedSync.map((s) => s.month).join(", ")}</p>}
        <div className={styles.legend}><span className={styles.peakDay}>첨두일</span><span className={styles.peakHour}>일별 첨두시간</span><span className={styles.weekPeak}>주간 최대시간</span><span>동률은 모두 표시 · 결측은 —</span></div>
        <div className={styles.tableScroll}><table className={styles.table}>
          <caption>{point?.name} ({station}) · {direction === "both" ? "양방향" : isGyeonggi ? point?.directions[direction] || `원자료 방향 ${direction === "in" ? "1" : "2"}` : direction === "in" ? "유입" : "유출"} · 단위: 대/시</caption>
          <thead><tr><th scope="col">시간</th>{visible.days.map((d) => <th scope="col" key={d.date} className={visible.peakDays.includes(d.date) ? styles.peakDay : ""}>{d.label}<small>{dateLabel(d.date)}</small>{d.sourceWeekday === "일" && d.label !== "일" && <small>원자료 공휴일</small>}</th>)}</tr></thead>
          <tbody>{Array.from({ length: 24 }, (_, h) => <tr key={h}><th scope="row">{hourLabel(h)}</th>{visible.days.map((d) => {
            const peak = visible.peakCells.includes(`${d.date}|${h}`), daily = d.peakHours.includes(h), peakDay = visible.peakDays.includes(d.date);
            return <td key={d.date} className={peak ? styles.weekPeak : daily ? styles.peakHour : peakDay ? styles.peakDay : ""}
              aria-label={`${d.date} ${hourLabel(h)} ${d.hours[h] === null ? "결측" : `${number(d.hours[h])}대`}${peak ? ", 주간 최대시간" : daily ? ", 일별 첨두시간" : ""}`}>
              {number(d.hours[h])}{(peak || daily) && <small>{peak ? "주간 최대" : "첨두"}</small>}</td>;
          })}</tr>)}</tbody>
          <tfoot><tr><th scope="row">일교통량</th>{visible.days.map((d) => <td key={d.date} className={visible.peakDays.includes(d.date) ? styles.peakDay : ""}>{number(d.total)}{visible.peakDays.includes(d.date) && <small>첨두일</small>}</td>)}</tr></tfoot>
        </table></div>
        <p className={styles.help}>선택 주의 관측 최대값이며, 평가서의 최종 조사일·첨두시간을 자동 확정하는 값은 아닙니다. 양방향은 같은 날짜·시간의 두 방향 자료가 모두 있을 때만 합산합니다. 한 방향이라도 없으면 해당 시간은 —(결측)로 표시하고 0이나 한쪽 값으로 대체하지 않습니다. 결측이 있는 날은 일교통량·일별 첨두시간을 보류하며, 선택 주에 결측이 있으면 주간 첨두일·주간 최대시간도 보류합니다. 24시간이 모두 있는 다른 날의 일교통량·첨두시간은 유지합니다. 공휴일은 실제 달력 요일에 배치하며 원자료 표기가 있을 때 별도로 표시합니다.</p>
        {visible.sources.map((s) => <p key={s.month} className={styles.provenance}>원자료: {s.fileName} · 수집 {new Date(s.collectedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 최근 원문 확인 {new Date(s.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>)}
      </>}
    </div>
  </div>;
}
