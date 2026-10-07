"use client";

export default function SurveyMapPanel({ mapCollapsed, mapContainerRef, mapExpandButtonRef, mapExpanded, mapRuntimeRef, mapStatus, selectedBusDetails, setMapCollapsed, setMapExpanded, setSelectedBusStop, setShowBikeStationsOnMap, setShowBusRouteLabels, setShowBusStopsOnMap, showBikeStationsOnMap, showBusRouteLabels, showBusStopsOnMap,
  showSurveyPointsOnMap, setShowSurveyPointsOnMap, surveyPoints = [], selectedSurveyMapPoint, setSelectedSurveyMapPoint, referencePoint, referenceSearch, referencePosition, onConfirmReference }) {
  return (<section className="panel project-panel">
        <div className="map-card project-map-card">
          <div className="map-header">
            <button type="button" className="ghost" hidden={mapExpanded} aria-expanded={!mapCollapsed} aria-controls="scope-map" onClick={() => {
              setMapCollapsed((current) => !current);
              window.setTimeout(() => {
                const runtime = mapRuntimeRef.current;
                runtime.map?.relayout();
                if (runtime.map && runtime.rectangle && runtime.scopeBounds) runtime.map.setBounds(runtime.surveyBounds || runtime.scopeBounds, 48, 48, 48, 48);
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
          <div className="survey-map-tools">
            <label className="checkbox-label"><input type="checkbox" checked={showSurveyPointsOnMap} onChange={(event) => setShowSurveyPointsOnMap(event.target.checked)} />사전조사·참고지점 표시</label>
            <button type="button" className="ghost" disabled={!showSurveyPointsOnMap || !surveyPoints.length} onClick={() => {
              const runtime = mapRuntimeRef.current;
              if (runtime.map && runtime.surveyBounds) runtime.map.setBounds(runtime.surveyBounds, 64, 64, 64, 64);
            }}>지점 포함 화면 맞추기</button>
            <small>파랑: 추천지점 · 주황: 첨두분석 참고지점 · 위치 확인 {surveyPoints.length}개{showSurveyPointsOnMap ? "" : " (표시 꺼짐)"}</small>
          </div>
          {referencePoint && <details className="reference-map-location" open={!referencePosition}>
            <summary>참고지점 {referencePoint.point.code} 위치 확인{referencePosition ? " · 근사위치 표시 중" : " · 확인 후 표시"}</summary>
            <p>{referencePoint.point.name} · {referencePoint.month} 수록자료</p>
            <p>공식 측정 좌표가 없습니다. 아래는 지역·시설명으로 찾은 위치 후보이며 측정지점과 다를 수 있습니다. 원자료와 대조한 뒤 선택하세요. 추천 순위·교통량 분석값에는 영향을 주지 않습니다.</p>
            {referenceSearch?.status === "loading" ? <p role="status">지역·시설명 위치 후보 검색 중...</p> : null}
            {referenceSearch?.status === "failed" ? <p role="status">위치 검색에 실패했습니다. 임의 좌표로 표시하지 않습니다.</p> : null}
            {referenceSearch?.status === "ready" && !referenceSearch.choices.length ? <p role="status">같은 시·군에서 위치 후보를 확인하지 못했습니다. 지도 미표시 · 원자료 위치 확인 필요</p> : null}
            {referenceSearch?.choices.map((choice) => <div key={choice.id} className="reference-map-choice">
              <span>{choice.matchedName}<small>{choice.matchedAddress}</small></span>
              <button type="button" className="ghost" aria-pressed={referencePosition?.id === choice.id} onClick={() => onConfirmReference(choice)}>이 위치를 참고위치로 표시</button>
            </div>)}
          </details>}
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
          {showSurveyPointsOnMap && selectedSurveyMapPoint && <section className="bus-stop-detail" aria-label="선택한 사전조사지점 정보">
            <div className="bus-stop-detail-heading"><h4>{selectedSurveyMapPoint.kind === "reference" ? "첨두분석 참고지점" : `${selectedSurveyMapPoint.rank}순위 추천지점`} · {selectedSurveyMapPoint.code}</h4>
              <button type="button" className="ghost" onClick={() => setSelectedSurveyMapPoint(null)}>닫기</button></div>
            <p>{selectedSurveyMapPoint.title}</p><p>{selectedSurveyMapPoint.note}</p>
            <p>자료연도/월: {selectedSurveyMapPoint.sourceYear || "미확인"}</p>
          </section>}
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
