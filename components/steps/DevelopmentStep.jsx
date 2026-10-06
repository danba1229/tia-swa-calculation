"use client";

export default function DevelopmentStep({ DEVELOPMENT_PROJECT_TYPES, DEVELOPMENT_STATUS_FILTERS, copyDevelopmentDraft, copyDevelopmentTable, developmentAdmin, developmentGeocodeText, developmentResult, developmentScaleText, developmentSearch, displayedDevelopmentResults, downloadDevelopmentCsv, form, formatDevelopmentDistance, formatNumber, getScopeDimensions, searchDevelopmentPlans, shouldShowStep, updateDevelopmentSearch }) {
  return (<section className={`panel step-section ${shouldShowStep(4) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 4</p>
            <h2>주변지역 개발계획</h2>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="secondary" onClick={searchDevelopmentPlans} disabled={developmentResult.loading}>
              {developmentResult.loading ? "검색 중" : "주변사업 검색"}
            </button>
            <button type="button" className="secondary" onClick={copyDevelopmentTable} disabled={!displayedDevelopmentResults.length || !developmentResult.complete}>표 복사</button>
            <button type="button" className="secondary" onClick={downloadDevelopmentCsv} disabled={!displayedDevelopmentResults.length || !developmentResult.complete}>CSV 다운로드</button>
            <button type="button" className="secondary" onClick={copyDevelopmentDraft} disabled={!developmentResult.complete || Boolean(developmentResult.warnings)}>2장 문장 복사</button>
          </div>
        </div>

        <div className="scope-linked-note">
          <strong>검색 기준</strong>
          <span>상단 주소지와 가로 {formatNumber(getScopeDimensions(form.basics).width)}m × 세로 {formatNumber(getScopeDimensions(form.basics).height)}m 사각형 조사범위를 사용합니다. 행정구역은 {developmentAdmin.sido || "-"} / {developmentAdmin.sigungu || "-"}로 자동 적용합니다.</span>
        </div>

        <div className="form-grid compact-grid development-form">
          <label>
            <span>검색시작연도</span>
            <input type="number" value={developmentSearch.startYear} onChange={(event) => updateDevelopmentSearch({ startYear: event.target.value })} placeholder="2021" />
          </label>
          <label>
            <span>검색종료연도</span>
            <input type="number" value={developmentSearch.endYear} onChange={(event) => updateDevelopmentSearch({ endYear: event.target.value })} placeholder="2026" />
          </label>
          <label>
            <span>사업유형</span>
            <select value={developmentSearch.projectType} onChange={(event) => updateDevelopmentSearch({ projectType: event.target.value })}>
              {DEVELOPMENT_PROJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>반영여부 필터</span>
            <select value={developmentSearch.statusFilter} onChange={(event) => updateDevelopmentSearch({ statusFilter: event.target.value })}>
              {DEVELOPMENT_STATUS_FILTERS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={Boolean(developmentSearch.includeFailed)} onChange={(event) => updateDevelopmentSearch({ includeFailed: event.target.checked })} />
            <span>위치 미확인 사업 포함 보기</span>
          </label>
        </div>

        <div className="verification-card">
          <div>
            <p className="eyebrow">TIA API Search</p>
            <h3>교통영향평가 후보사업 자동 검색</h3>
          </div>
          <p>
            {developmentResult.error
        ? developmentResult.error
        : developmentResult.loading ? `${developmentResult.progress || "후보 조회 중"}. 조사가 끝나기 전까지 잠정 결과입니다.`
        : developmentResult.searched
                ? `${developmentResult.dataMode === "DB_CACHE" ? "누적 DB 자료" : "실시간 공공 API"}를 기준으로 사업지 좌표와 후보사업 좌표를 계산했습니다. 반영여부는 자동판정이므로 보고서 작성 전 원자료 확인이 필요합니다.`
                : "누적 DB의 수집 기간·완전성·갱신 시각을 확인하고, 불완전하거나 오래된 자료는 교통영향평가 공공 API 실시간 조회로 보완합니다."}
          </p>
          {developmentResult.warnings && <p className="data-warning">일부 출처 조회 실패: {developmentResult.warnings}. 현재 결과만으로 주변사업 부재를 판단할 수 없습니다.</p>}
          {developmentResult.progress && <p>{developmentResult.progress} / {developmentResult.complete ? "수집 후보 처리 완료" : "미완료"}</p>}
          <p className="verification-source">좌표변환 실패 사업과 원자료 미수록 사업은 범위 내 여부를 확인할 수 없습니다. 0건이어도 사업이 없다고 단정하지 마세요.</p>
          <p className="verification-source">
            원자료: {developmentResult.dataMode === "DB_CACHE" ? "누적 DB(TIA businessSearch 수집자료)" : "국토교통부 교통영향평가_사업정보 API + 교통영향평가정보지원시스템 API"}
            {" / "}DB 연결: {!developmentResult.searched ? "미확인" : developmentResult.dbConfigured ? "연결됨" : "미연결"}
            {" / "}좌표변환: 카카오 Local API
          </p>
        </div>

        {developmentResult.summary ? (
          <div className="development-summary-grid">
            <div><strong>{formatNumber(developmentResult.summary.totalRawCount)}</strong><span>원자료</span></div>
            <div><strong>{formatNumber(developmentResult.summary.geocodedCount)}</strong><span>좌표변환</span></div>
            <div><strong>{formatNumber(developmentResult.summary.withinRadiusCount)}</strong><span>사각형 범위 내</span></div>
            <div><strong>{formatNumber(developmentResult.summary.reflectCount)}</strong><span>반영</span></div>
            <div><strong>{formatNumber(developmentResult.summary.reviewCount)}</strong><span>반영검토</span></div>
            <div><strong>{formatNumber(developmentResult.summary.referenceCount)}</strong><span>참고</span></div>
            <div><strong>{formatNumber(developmentResult.summary.excludedCount)}</strong><span>제외후보</span></div>
          </div>
        ) : null}

        <section className="subpanel">
          <div className="subpanel-header">
            <h3>주변 교통영향평가 사업 후보</h3>
            <p className="subpanel-source">기본 정렬: 거리순 / 위치 미확인 사업은 하단 표시</p>
          </div>
          <div className="table-wrap">
            <table className="data-table development-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>사업명</th>
                  <th>위치</th>
                  <th>좌표 확인</th>
                  <th>확인 주소</th>
                  <th>사업구분</th>
                  <th>용도/시설</th>
                  <th>규모</th>
                  <th>사업기간</th>
                  <th>심의결과</th>
                  <th>사업지와 거리</th>
                  <th>반영여부</th>
                  <th>반영사유</th>
                  <th>출처</th>
                </tr>
              </thead>
              <tbody>
                {displayedDevelopmentResults.length ? displayedDevelopmentResults.map((result, index) => (
                  <tr key={`${result.id}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{result.projectName || "-"}</td>
                    <td>{result.location || "-"}</td>
                    <td>
                      <span>{result.geocodeStatus === "success" ? "상세 주소 일치" : "위치 미확인"}</span>
                      <details>
                        <summary>조회 과정·사유</summary>
                        <div className="geocode-details">{developmentGeocodeText(result)}</div>
                      </details>
                    </td>
                    <td>{result.matchedAddress || "-"}</td>
                    <td>{result.projectType || "-"}</td>
                    <td>{result.facilityType || "-"}</td>
                    <td>{developmentScaleText(result)}</td>
                    <td>{result.projectPeriod || "-"}</td>
                    <td>{result.reviewResult || "-"}</td>
                    <td>{formatDevelopmentDistance(result)}</td>
                    <td><span className={`status-pill ${result.reflectionStatus || ""}`}>{result.reflectionStatus || "-"}</span></td>
                    <td>{result.reflectionReason || "-"}</td>
                    <td>{result.source || "TIA_API"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={14} className="empty-cell">
                      {developmentResult.searched ? "표시할 주변지역 개발계획 후보가 없습니다." : "검색 전입니다. 입력값을 확인한 뒤 주변사업 검색을 눌러 주세요."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="subpanel notice-search-panel">
          <div className="subpanel-header">
            <h3>지자체 고시공고 보조 확인</h3>
            <p className="subpanel-source">자동 키워드 검색 링크 / 공식 고시공고 및 첨부파일은 수동확인 필요</p>
          </div>
          <div className="notice-link-grid">
            {(developmentResult.noticeSearches || []).length ? developmentResult.noticeSearches.map((item) => (
              <a key={item.keyword} className="notice-link-card" href={item.url} target="_blank" rel="noreferrer">
                <strong>{item.keyword}</strong>
                <span>{item.title}</span>
                <em>{item.confidence}</em>
              </a>
            )) : (
              <p className="empty-cell">주변사업 검색 후 행정구역 기반 고시공고 검색 링크가 표시됩니다.</p>
            )}
          </div>
        </section>
      </section>);
}
