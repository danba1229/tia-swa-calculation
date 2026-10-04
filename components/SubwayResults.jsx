import { createSubwayRows, SUBWAY_COLUMNS } from "../lib/subwayTable";
export default function SubwayResults({ result }) {
  const stations = result.subwayStations || [];
  return <section className="subpanel">
    <div className="subpanel-header"><h3>지하철역 · 운행일/행선지별 첫차·막차</h3><p className="subpanel-source">{result.subwaySource || "카카오 Local 위치 · 국토교통부 TAGO 시간표"}</p></div>
    <p className="hint">역 출발시간 기준입니다. 00~02시는 이전 운행일의 익일 시간으로 정리합니다. 공사·임시 시간표와 열차구분 미제공 항목은 운영기관 확인이 필요합니다. 조회 시각은 시간표 개정일이 아닙니다. 시간표는 저장 자료를 재사용하며 매월 5일 04시 이후 첫 조회에 갱신합니다.</p>
    {result.subwayError && <p role="alert">{result.subwayError}</p>}
    {result.subwayCacheInfo?.stale && <p role="alert">역 목록 갱신 실패로 이전 저장 자료를 표시합니다.</p>}
    {stations.some((s) => s.cacheInfo?.storage === "MEMORY") && <p className="hint">현재 시간표는 메모리 임시 저장 상태입니다. DB 연결이 없거나 실패하면 서버 재시작 시 다시 조회될 수 있습니다.</p>}
    {result.subwayTruncated && <p role="alert">위치 검색 제공 한도(45건)에 도달했습니다. 조사 범위를 줄여 다시 확인해 주세요.</p>}
    {stations.filter((s) => s.error).map((s) => <p className="hint" key={s.id}>{s.stationName}: {s.error}</p>)}
    {stations.filter((s) => s.cacheInfo?.stale).map((s) => <p role="alert" key={`cache-${s.id}`}>{s.stationName}: 시간표 갱신 실패로 이전 저장 자료를 표시합니다.</p>)}
    <div className="table-wrap"><table className="data-table bus-route-table"><thead><tr>{SUBWAY_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{stations.length ? createSubwayRows(stations).slice(1).map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)
        : <tr><td colSpan={SUBWAY_COLUMNS.length} className="empty-cell">{result.loading ? "조회 중입니다." : result.subwayError || (result.searched ? "조사 범위 안에서 조회된 지하철역이 없습니다." : "교통시설 조회를 눌러 주세요.")}</td></tr>}</tbody>
    </table></div>
  </section>;
}
