"use client";

import { BUS_STOP_COLUMNS, createBusStopTableRows } from "../../lib/seoulBusTable";
import { transportMissingNote } from "../../lib/transportTableDisplay";

export default function PublicTransportStep({ BUS_ROUTE_COLUMNS, SubwayResults, busRefreshStatusText, busRouteTableRows, busStops, copyPublicTransportTables, downloadPublicTransportCsv, form, formatFacilityDistance, formatNumber, getScopeDimensions, publicTransportResult, searchPublicTransportFacilities, shouldShowStep }) {
  const stopRows = createBusStopTableRows(busStops, formatFacilityDistance);
  const routeRows = busRouteTableRows(busStops);
  const stopNote = transportMissingNote(stopRows, busStops.map(stop => stop.routeError));
  const routeNote = transportMissingNote(routeRows, busStops.flatMap(stop => [stop.routeError, ...(stop.routes || []).flatMap(route => [route.detailError, route.endpointTimeError, route.supplementError])]));
  const pairedStops = [];
  for (let index = 1; index < stopRows.length; index += 2) pairedStops.push([stopRows[index], stopRows[index + 1]]);
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
                : "교통시설 조회를 누르면 버스정류장·경유노선·지하철역을 표로 정리합니다."}
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
          <p className="hint">누락 항목 재시도는 성공 자료를 유지합니다. 첫차·막차는 노선 기점과 종점 기준입니다. API 미제공 값은 수동 확인이 필요합니다. API 재조회 대기 중이면 최대 5분 뒤 다시 시도하세요.</p>
          {publicTransportResult.busSummary?.partial ? (
            <p className="verification-source">버스 정보 일부 조회 실패: 경유노선 {publicTransportResult.busSummary.failedStationRoutes || 0}개 정류장, 노선 상세 {publicTransportResult.busSummary.failedRouteDetails || 0}건, 기종점 첫·막차 {publicTransportResult.busSummary.failedStationTimes || 0}건. 조회된 결과는 유지하며 누락 항목은 수동 확인이 필요합니다.</p>
          ) : null}
          {publicTransportResult.busSummary?.truncated ? (
            <p className="verification-source">범위 안 정류장 {publicTransportResult.busSummary.withinScopeCount}개 중 거리순 {publicTransportResult.busSummary.returnedCount}개를 표시합니다.</p>
          ) : null}
        </div>

        <section className="subpanel">
          <div className="subpanel-header">
            <h3>버스정류장</h3>
            <p className="subpanel-source">{publicTransportResult.transportRegion === "gyeonggi" ? "경기버스정보 기반정보" : "서울시 공식 파일"} {publicTransportResult.busSourceDate ? `(${publicTransportResult.busSourceDate} 기준)` : "기준"} / 조사 범위 내 정류장 · 직선거리순 (왼쪽 → 오른쪽)
              {stopNote && <span className="transport-missing-note">{stopNote}</span>}
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table public-transport-table bus-stop-table">
              <thead>
                <tr>
                  {[...BUS_STOP_COLUMNS, ...BUS_STOP_COLUMNS].map((column, index) => <th key={index} scope="col">{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {busStops.length ? pairedStops.map(([left, right], index) => (
                  <tr key={index}>
                    {left.map((cell, column) => <td key={`left-${column}`}>{cell}</td>)}
                    {right ? right.map((cell, column) => <td key={`right-${column}`}>{cell}</td>) : <td colSpan={3} aria-label="추가 정류장 없음" />}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      {publicTransportResult.loading ? "조회 중입니다." : publicTransportResult.searched ? (publicTransportResult.busError || (!publicTransportResult.busSummary && publicTransportResult.error) || "조사 범위 안에서 표시할 버스정류장이 없습니다.") : "조회 전입니다. 서울·경기 주소지를 입력한 뒤 교통시설 조회를 눌러 주세요."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-header">
            <h3>정류장별 경유 버스노선</h3>
            <p className="subpanel-source">첫차·막차는 노선 기점·종점 기준이며 중간 정류장 도착시간이 아닙니다. 경기 시간은 평일 기준, 서울 종점은 명칭이 유일하게 일치하는 종점 정류소 운행시간입니다. 서울 토요일·공휴일 배차는 T-DATA, 경기 평일·토요일·일요일·공휴일 배차는 GBIS 자료입니다. 서울 일반 배차는 평일로 간주하지 않으며 미제공 값은 수동 확인이 필요합니다. 조회 시각은 자료 기준일과 다릅니다.
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
                {busStops.length ? routeRows.slice(1).map((row, index) => (
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
