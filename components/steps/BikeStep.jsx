"use client";

export default function BikeStep({ bikeStations, copyPublicTransportTables, downloadPublicTransportCsv, form, formatFacilityDistance, formatNumber, formatOptionalNumber, getScopeDimensions, publicTransportResult, searchPublicTransportFacilities, shouldShowStep }) {
  return (<section className={`panel step-section ${shouldShowStep(6) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 6</p>
            <h2>따릉이 현황</h2>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="secondary" onClick={searchPublicTransportFacilities} disabled={publicTransportResult.loading}>{publicTransportResult.loading ? "조회 중" : "따릉이 조회"}</button>
            <button type="button" className="secondary" onClick={() => copyPublicTransportTables("bike")} disabled={!bikeStations.length}>표 복사</button>
            <button type="button" className="secondary" onClick={() => downloadPublicTransportCsv("bike")} disabled={!bikeStations.length}>CSV 다운로드</button>
          </div>
        </div>
        <div className="scope-linked-note">
          <strong>조사 기준</strong>
          <span>상단 주소와 가로 {formatNumber(getScopeDimensions(form.basics).width)}m × 세로 {formatNumber(getScopeDimensions(form.basics).height)}m 범위 안의 서울 따릉이 대여소를 조회합니다. 지도 표시 여부는 지도 상단에서 선택합니다.</span>
        </div>
        <div className="verification-card">
          <p>{publicTransportResult.loading ? "교통시설 조회 중입니다." : publicTransportResult.error || (publicTransportResult.searched ? `따릉이 대여소 ${formatNumber(bikeStations.length)}개를 확인했습니다.` : "조사 시작 또는 따릉이 조회를 눌러 주세요.")}</p>
          <p className="verification-source">원자료: {publicTransportResult.source || "서울특별시_공공자전거 대여소 정보(25.12월 기준)"}</p>
        </div>
        <section className="subpanel">
          <div className="subpanel-header">
            <h3>따릉이 대여소</h3>
            <p className="subpanel-source">서울특별시 공공자전거 대여소 마스터 기준 / 거리순</p>
          </div>
          <div className="table-wrap">
            <table className="data-table public-transport-table">
              <thead><tr><th>대여소번호</th><th>대여소명</th><th>주소 또는 위치</th><th>거치대수</th><th>거리</th></tr></thead>
              <tbody>
                {bikeStations.length ? bikeStations.map((station) => (
                  <tr key={station.id || `${station.stationNumber}-${station.stationName}`}>
                    <td>{station.stationNumber || station.id || "-"}</td>
                    <td>{station.stationName || "-"}</td>
                    <td>{station.location || "-"}</td>
                    <td>{formatOptionalNumber(station.rackCount)}</td>
                    <td>{formatFacilityDistance(station)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="empty-cell">{publicTransportResult.loading ? "조회 중입니다." : publicTransportResult.error || (publicTransportResult.searched ? "조사 범위 안에서 표시할 따릉이 대여소가 없습니다." : "서울 주소지를 입력한 뒤 따릉이 조회를 눌러 주세요.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>);
}
