"use client";

import { BUS_ROUTE_NOTE } from "../../lib/seoulBusTable";
import { transportMissingNote } from "../../lib/transportTableDisplay";
import { busGapSummary } from "../../lib/client/transportEnrichment";

export default function PublicTransportStep({ BUS_ROUTE_COLUMNS, SubwayResults, busRefreshStatusText, busRouteTableRows, busStops, copyPublicTransportTables, downloadPublicTransportCsv, form, formatNumber, getScopeDimensions, publicTransportResult, searchPublicTransportFacilities, shouldShowStep }) {
  const routeRows = busRouteTableRows(busStops);
  const gaps = busGapSummary(busStops, publicTransportResult.busSummary);
  const routeNote = transportMissingNote(routeRows, busStops.flatMap(stop => [stop.routeError, ...(stop.routes || []).flatMap(route => [route.detailError, route.supplementError])]));
  return (<section className={`panel step-section ${shouldShowStep(5) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 5</p>
            <h2>버스·지하철 현황</h2>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="secondary" onClick={searchPublicTransportFacilities} disabled={publicTransportResult.loading || publicTransportResult.busRouteLoading || publicTransportResult.busDetailLoading || publicTransportResult.subwayDetailLoading}>
              {publicTransportResult.loading || publicTransportResult.busDetailLoading || publicTransportResult.subwayDetailLoading ? "조회 중" : "교통시설 조회"}
            </button>
            <button type="button" className="secondary" onClick={() => searchPublicTransportFacilities({ retryMissing: true })} disabled={!publicTransportResult.scope || publicTransportResult.loading || publicTransportResult.busRouteLoading || publicTransportResult.busDetailLoading || publicTransportResult.subwayDetailLoading}>누락 항목 재시도</button>
            <button type="button" className="secondary" onClick={() => copyPublicTransportTables("bus")} disabled={!busStops.length && !publicTransportResult.subwayStations?.length}>표 복사</button>
            <button type="button" className="secondary" onClick={() => downloadPublicTransportCsv("bus")} disabled={!busStops.length && !publicTransportResult.subwayStations?.length}>CSV 다운로드</button>
          </div>
        </div>

        <div className="scope-linked-note">
          <strong>조사 기준</strong>
          <span>상단 주소지와 가로 {formatNumber(getScopeDimensions(form.basics).width)}m × 세로 {formatNumber(getScopeDimensions(form.basics).height)}m 조사 범위를 사용합니다. 서울·경기 버스정류장과 지하철역을 조회합니다.</span>
        </div>

        <div className="verification-card">
          <div>
            <p className="eyebrow">Public Transport Facilities</p>
            <h3>범위 내 버스정류장 자동 정리</h3>
          </div>
          <p>
            {publicTransportResult.loading ? "교통시설 조회 중입니다." : publicTransportResult.busError
              ? publicTransportResult.busError
              : publicTransportResult.searched
                ? publicTransportResult.busSummary ? `조사 범위 안의 버스정류장 ${formatNumber(publicTransportResult.busSummary.returnedCount)}개를 정리했습니다.` : publicTransportResult.error || "버스 조회 결과를 확인하지 못했습니다."
                : "교통시설 조회를 누르면 버스정류장을 지도에서 확인하고 버스노선·지하철역을 표로 정리합니다."}
          </p>
          <p className="verification-source">
            원자료: {publicTransportResult.busSource || "서울시 버스정류소 위치정보 · 버스노선별 정류소정보"}
            {publicTransportResult.busSourceDate ? ` / 버스 자료 기준일: ${publicTransportResult.busSourceDate} (실시간 자료 아님)` : ""}
            {publicTransportResult.busFetchedAt ? ` / 버스 조회 시각: ${publicTransportResult.busFetchedAt} (UTC)` : ""}
          </p>
          {publicTransportResult.busSourceDate ? <p className="verification-source">{publicTransportResult.transportRegion === "gyeonggi" ? `GBIS 원자료 버전 기준 · ${publicTransportResult.busCacheInfo?.storage === "DATABASE" ? "DB 저장 자료 재사용 · 매월 5일 04시 이후 첫 조회에 갱신" : "메모리 임시 저장 · 서버 재시작 시 재조회 가능"} · 조회 시점은 자료 갱신일과 다릅니다.` : busRefreshStatusText(publicTransportResult.busRefresh)}</p> : null}
          {publicTransportResult.busCacheInfo?.stale && <p role="alert">버스 기반정보 갱신 실패로 이전 정상 저장 자료를 표시합니다. 최신 운행 여부는 공식 자료를 확인해 주세요.</p>}
          {[...new Set((publicTransportResult.busStops || []).flatMap((stop) => (stop.routes || []).flatMap((route) => [route.cacheWarning, route.supplementError]).filter(Boolean)))].map((warning) => <p className="hint" role="alert" key={warning}>{warning}</p>)}
          {publicTransportResult.busDetailTotal > 0 ? (
            <p className="verification-source" role="status">노선 상세 API: {publicTransportResult.busDetailLoading ? "조회 중" : publicTransportResult.busDetailError ? "조회 중단" : "조회 시도 완료"} ({publicTransportResult.busDetailCompleted}/{publicTransportResult.busDetailTotal}개 노선). 미제공 항목은 수동 확인이 필요합니다.</p>
          ) : null}
          {publicTransportResult.busDetailError ? <p className="verification-source" role="alert">{publicTransportResult.busDetailError} 기본 정류장·경유노선 목록은 유지합니다.</p> : null}
          {publicTransportResult.busRouteTotal > 0 && <p role="status">경유노선 보완: {publicTransportResult.busRouteCompleted || 0}/{publicTransportResult.busRouteTotal}개 정류장 조회 시도 · {publicTransportResult.busRouteLoading ? "이어서 조회 중" : "조회 종료"}</p>}
          {publicTransportResult.busRouteError && <p role="alert">{publicTransportResult.busRouteError}</p>}
          <p className="hint">지도에서 버스정류장 아이콘을 누르면 정류장명·경유버스·정차노선수·사업지와 거리를 확인할 수 있습니다. 지도는 상단의 조사 시작으로 표시합니다.</p>
          <p className="hint">누락 항목 재시도는 성공 자료를 유지합니다. 버스노선표의 첫차·막차는 노선 기점 기준입니다. API 미제공 값은 수동 확인이 필요합니다. API 재조회 대기 중이면 최대 5분 뒤 다시 시도하세요.</p>
          {gaps.partial ? (
            <p className="verification-source">추가 확인: 경유노선 미확인 {gaps.failedStationRoutes}개 정류장 · 노선 상세 조회 미완료 {gaps.failedRouteDetails}개 노선 · 기점 첫·막차 미제공 {gaps.failedStationTimes}개 노선 · 배차간격 일부 미제공 {gaps.missingIntervals}개 노선. 노선 수는 중복을 제거한 기준입니다.</p>
          ) : null}
          {publicTransportResult.busSummary?.truncated ? (
            <p className="verification-source">범위 안 정류장 {publicTransportResult.busSummary.withinScopeCount}개 중 거리순 {publicTransportResult.busSummary.returnedCount}개를 표시합니다.</p>
          ) : null}
        </div>

        <section className="subpanel">
          <div className="subpanel-header">
            <h3>버스노선표</h3>
            <p className="subpanel-source">{BUS_ROUTE_NOTE} 동일 노선은 한 번만 표시하며 버스번호 오름차순입니다.
              {routeNote && <span className="transport-missing-note">{routeNote}</span>}
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table bus-route-table">
              <thead>
                <tr>
                  {BUS_ROUTE_COLUMNS.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {routeRows.length > 1 ? routeRows.slice(1).map((row, index) => (
                  <tr key={index}>
                    {row.map((value, column) => <td key={column}>{value}</td>)}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={BUS_ROUTE_COLUMNS.length} className="empty-cell">
                      {publicTransportResult.searched ? "조회된 버스정류장 노선 정보가 없습니다." : "조회 전입니다."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <SubwayResults result={publicTransportResult} />
      </section>);
}
