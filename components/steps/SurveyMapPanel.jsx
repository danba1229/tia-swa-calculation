"use client";

export default function SurveyMapPanel({ mapCollapsed, mapContainerRef, mapExpandButtonRef, mapExpanded, mapRuntimeRef, mapStatus, selectedBusDetails, setMapCollapsed, setMapExpanded, setSelectedBusStop, setShowBikeStationsOnMap, setShowBusRouteLabels, setShowBusStopsOnMap, showBikeStationsOnMap, showBusRouteLabels, showBusStopsOnMap }) {
  return (<section className="panel project-panel">
        <div className="map-card project-map-card">
          <div className="map-header">
            <button type="button" className="ghost" hidden={mapExpanded} aria-expanded={!mapCollapsed} aria-controls="scope-map" onClick={() => {
              setMapCollapsed((current) => !current);
              window.setTimeout(() => {
                const runtime = mapRuntimeRef.current;
                runtime.map?.relayout();
                if (runtime.map && runtime.rectangle && runtime.scopeBounds) runtime.map.setBounds(runtime.scopeBounds, 48, 48, 48, 48);
              }, 100);
            }}>{mapCollapsed ? "지도 펼치기" : "지도 접기 / 표 넓게 보기"}</button>
            <button ref={mapExpandButtonRef} type="button" className="secondary map-expand-button" aria-expanded={mapExpanded} aria-controls="scope-map" onClick={() => {
              setMapCollapsed(false);
              setMapExpanded((current) => !current);
            }}>{mapExpanded ? "기본 화면으로" : "지도 크게 보기"}</button>
            <label className="checkbox-label map-toggle-control">
              <input
                type="checkbox"
                checked={showBikeStationsOnMap}
                onChange={(event) => setShowBikeStationsOnMap(event.target.checked)}
              />
              <span>따릉이 위치 표시</span>
            </label>
            <label className="checkbox-label map-toggle-control bus-map-toggle">
              <input type="checkbox" checked={showBusStopsOnMap} onChange={(event) => setShowBusStopsOnMap(event.target.checked)} />
              <span>버스정류장 표시</span>
            </label>
            <h3>카카오 지도</h3>
          </div>
          {mapExpanded ? (
            <div className="expanded-map-tools">
              <label className="checkbox-label">
                <input type="checkbox" checked={showBusRouteLabels} disabled={!showBusStopsOnMap} onChange={(event) => setShowBusRouteLabels(event.target.checked)} />
                <span>버스번호·종류 라벨 표시</span>
              </label>
              <button type="button" className="ghost" onClick={() => {
                const runtime = mapRuntimeRef.current;
                if (runtime.map && runtime.scopeBounds) runtime.map.setBounds(runtime.scopeBounds, 48, 48, 48, 48);
              }}>조사 범위 맞추기</button>
              <p>버스 종류는 API 상세조회에서 확인된 경우만 표시합니다. 미조회·미제공 값은 추정하지 않습니다. 라벨이 겹치면 지도를 확대해 주세요.</p>
            </div>
          ) : null}
          <div id="scope-map" ref={mapContainerRef} className="map-view" aria-label="조사 범위 지도" />
          <div id="selected-bus-stop-info" aria-live="polite">
            {selectedBusDetails ? (
              <section className="bus-stop-detail" aria-label="선택한 버스정류장 정보">
                <div className="bus-stop-detail-heading">
                  <h4>{selectedBusDetails.name}</h4>
                  <button type="button" className="ghost" onClick={() => setSelectedBusStop(null)} aria-label="버스정류장 정보 닫기">닫기</button>
                </div>
                <dl>
                  <dt>정류장번호</dt><dd>{selectedBusDetails.number}</dd>
                  <dt>경유 버스</dt><dd>{selectedBusDetails.routes}</dd>
                  <dt>번호·종류</dt><dd>{selectedBusDetails.routeLabels.join(", ") || "노선 정보 미제공"}</dd>
                  <dt>사업지와 거리</dt><dd>{selectedBusDetails.distance}</dd>
                </dl>
                <p>서울시 공식 파일{selectedBusDetails.sourceDate ? ` · ${selectedBusDetails.sourceDate} 기준` : ""} · 실시간 운행정보 아님</p>
              </section>
            ) : null}
          </div>
          <p className="map-status" role="status">{mapStatus}</p>
        </div>
      </section>);
}
