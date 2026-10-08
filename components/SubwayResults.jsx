import { createSubwayRows, SUBWAY_COLUMNS } from "../lib/subwayTable";
import { transportMissingNote } from "../lib/transportTableDisplay";
export default function SubwayResults({ result }) {
  const stations = result.subwayStations || [];
  const rows = createSubwayRows(stations);
  const missingNote = transportMissingNote(rows, stations.map(station => station.error));
  return <section className="subpanel">
    <div className="subpanel-header"><h3>지하철역 · 운행일/행선지별 첫차·막차</h3><p className="subpanel-source">{result.subwaySource || "카카오 Local 위치 · 국토교통부 TAGO 시간표"}
      {missingNote && <span className="transport-missing-note">{missingNote}</span>}
    </p></div>
    <p className="hint">역 출발시간 기준입니다. 00~02시는 이전 운행일의 익일 시간으로 정리합니다. 공사·임시 시간표와 열차구분 미제공 항목은 운영기관 확인이 필요합니다. 조회 시각은 시간표 개정일이 아닙니다. 시간표는 저장 자료를 재사용하며 매월 5일 04시 이후 첫 조회에 갱신합니다.</p>
    {result.subwayError && <p role="alert">{result.subwayError}</p>}
    {result.subwayCacheInfo?.stale && <p role="alert">역 목록 갱신 실패로 이전 저장 자료를 표시합니다.</p>}
    {stations.some((s) => s.cacheInfo?.storage === "MEMORY") && <p className="hint">현재 시간표는 메모리 임시 저장 상태입니다. DB 연결이 없거나 실패하면 서버 재시작 시 다시 조회될 수 있습니다.</p>}
    {result.subwayTruncated && <p role="alert">위치 검색 제공 한도(45건)에 도달했습니다. 조사 범위를 줄여 다시 확인해 주세요.</p>}
    {result.subwayDetailLoading && <p role="status">역 코드 및 운행일·방향별 시간표를 이어서 조회 중입니다.</p>}
    <p className="hint">코드 조회 실패는 재시도하고, 코드 없음·복수 일치는 임의 연결하지 않습니다. 시간표는 평일·토요일·일요일/공휴일의 상·하행을 나누어 조회하며 성공한 항목은 재시도에서 제외합니다.</p>
    {stations.filter(s => s.scheduleSlots?.length).map(s => <p className="hint" key={`slots-${s.id}`}>{s.stationName}: 운행일·방향 {s.scheduleSlots.filter(slot => slot.status === "SUCCESS").length}/6개 정상 조회 · 미제공/실패/미조회는 운행 없음으로 확정하지 않습니다.</p>)}
    {stations.filter((s) => s.cacheInfo?.stale).map((s) => <p role="alert" key={`cache-${s.id}`}>{s.stationName}: 시간표 갱신 실패로 이전 저장 자료를 표시합니다.</p>)}
    <div className="table-wrap"><table className="data-table bus-route-table"><thead><tr>{SUBWAY_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{stations.length ? rows.slice(1).map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)
        : <tr><td colSpan={SUBWAY_COLUMNS.length} className="empty-cell">{result.loading ? "조회 중입니다." : result.subwayError || (result.searched ? "조사 범위 안에서 조회된 지하철역이 없습니다." : "교통시설 조회를 눌러 주세요.")}</td></tr>}</tbody>
    </table></div>
  </section>;
}
