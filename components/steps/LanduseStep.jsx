"use client";

export default function LanduseStep({ rankClass, DEFAULT_STATISTICS_YEAR, STATISTICS_YEAR_OPTIONS, addRow, createZoningRow, exportStep3Excel, form, formatNumber, formatOptionalNumber, formatPercent, formatSquareKilometers, landuseReportRows, landuseSlices, landuseStats, pieBackground, refreshLocalStatisticsOnly, removeRow, setForm, shouldShowStep, updateLanduseArea, updateListItem, updateStatisticsYear, verification, zoningReportRows, zoningSlices, zoningStats }) {
  return (<section className={`panel step-section ${shouldShowStep(3) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>토지이용 현황 및 계획</h2>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="secondary" onClick={refreshLocalStatisticsOnly}>
              KOSIS 자료 추출
            </button>
            <button type="button" className="secondary" onClick={exportStep3Excel}>
              엑셀 출력
            </button>
          </div>
        </div>

        <div className="form-grid compact-grid">
          <label>
            <span>기준연도</span>
            <select value={form.statisticsYear || DEFAULT_STATISTICS_YEAR} onChange={(event) => updateStatisticsYear(event.target.value)}>
              {STATISTICS_YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}년</option>)}
            </select>
          </label>
          <label>
            <span>토지이용 출처</span>
            <input value={form.landuseSource} onChange={(event) => setForm((current) => ({ ...current, landuseSource: event.target.value }))} placeholder="KOSIS 국토교통부, 행정구역별·지목별 국토이용현황_시군구" />
          </label>
          <label>
            <span>용도지역 출처</span>
            <input value={form.zoningSource} onChange={(event) => setForm((current) => ({ ...current, zoningSource: event.target.value }))} placeholder="KOSIS 도시계획현황, 용도지역(시군구)" />
          </label>
        </div>

        <div className={`verification-card ${verification?.status || "idle"}`}>
          <div>
            <p className="eyebrow">KOSIS Extraction</p>
            <h3>KOSIS 수록기간 자동 추출</h3>
          </div>
          <p>{verification?.message || "조사 시작 후 주소지 행정구역과 선택한 수록기간으로 KOSIS 지목별 국토이용현황 및 용도지역 시군구 통계표를 조회합니다."}</p>
          {verification?.source ? <p className="verification-source">원자료: {verification.source}</p> : null}
          {verification?.sourceLink ? <p className="verification-source">KOSIS 링크: {verification.sourceLink}</p> : null}
          {verification?.period ? <p className="verification-source">수록기간: {verification.period}</p> : null}
        </div>

        <div className="subpanel-grid landuse-layout">
          <section className="subpanel">
            <div className="subpanel-header">
              <h3>지목별 토지이용현황</h3>
              <p className="subpanel-source">출처: {landuseReportRows[0]?.source || "미입력"}</p>
            </div>
            <div className="table-wrap">
              <table className="data-table report-table horizontal-report-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    {landuseReportRows.map((row) => (
                      <th key={`landuse-head-${row.key}`} className={row.isTotal ? "total-row" : rankClass(landuseStats.rankMap.get(row.key))}>{row.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>면적_m2</th>
                    {landuseReportRows.map((row) => (
                      <td key={`landuse-area-${row.key}`} className={row.isTotal ? "total-row" : rankClass(landuseStats.rankMap.get(row.key))}>
                        {row.isTotal ? formatOptionalNumber(row.area) : (
                          <input className="table-input" type="number" min="0" step="any" value={form.landuseAreas[row.key] ?? ""} onChange={(event) => updateLanduseArea(row.key, event.target.value)} placeholder="면적 입력" />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>면적_km2</th>
                    {landuseReportRows.map((row) => <td key={`landuse-km2-${row.key}`} className={row.isTotal ? "total-row" : ""}>{formatSquareKilometers(row.area)}</td>)}
                  </tr>
                  <tr>
                    <th>구성비_%</th>
                    {landuseReportRows.map((row) => <td key={`landuse-ratio-${row.key}`} className={row.isTotal ? "total-row" : ""}>{formatPercent(row.ratio)}</td>)}
                  </tr>
                  <tr>
                    <th>원자료항목</th>
                    {landuseReportRows.map((row) => <td key={`landuse-raw-${row.key}`} className={row.isTotal ? "total-row" : ""}>{row.rawItem}</td>)}
                  </tr>
                  <tr>
                    <th>조사년도</th>
                    {landuseReportRows.map((row) => <td key={`landuse-year-${row.key}`} className={row.isTotal ? "total-row" : ""}>{row.year}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-header">
              <h3>용도지역 현황</h3>
              <div className="subpanel-header-actions">
                <p className="subpanel-source">출처: {zoningReportRows[0]?.source || "미입력"}</p>
                <button type="button" className="secondary" onClick={() => addRow("zoningRows", createZoningRow)}>용도지역 추가</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table report-table horizontal-report-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    {zoningReportRows.map((row, index) => (
                      <th key={`zoning-head-${row.key}`} className={row.isTotal ? "total-row" : rankClass(zoningStats.rankMap.get(index))}>
                        {row.isTotal ? row.label : (
                          <input className="table-input" value={form.zoningRows[index]?.name || ""} onChange={(event) => updateListItem("zoningRows", index, { name: event.target.value })} placeholder="예: 주거지역" />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>면적_m2</th>
                    {zoningReportRows.map((row, index) => (
                      <td key={`zoning-area-${row.key}`} className={row.isTotal ? "total-row" : rankClass(zoningStats.rankMap.get(index))}>
                        {row.isTotal ? formatOptionalNumber(row.area) : <input className="table-input" type="number" min="0" step="any" value={form.zoningRows[index]?.area ?? ""} onChange={(event) => updateListItem("zoningRows", index, { area: event.target.value })} placeholder="면적 입력" />}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>면적_km2</th>
                    {zoningReportRows.map((row) => <td key={`zoning-km2-${row.key}`} className={row.isTotal ? "total-row" : ""}>{formatSquareKilometers(row.area)}</td>)}
                  </tr>
                  <tr>
                    <th>구성비_%</th>
                    {zoningReportRows.map((row) => <td key={`zoning-ratio-${row.key}`} className={row.isTotal ? "total-row" : ""}>{formatPercent(row.ratio)}</td>)}
                  </tr>
                  <tr>
                    <th>원자료항목</th>
                    {zoningReportRows.map((row) => <td key={`zoning-raw-${row.key}`} className={row.isTotal ? "total-row" : ""}>{row.rawItem}</td>)}
                  </tr>
                  <tr>
                    <th>조사년도</th>
                    {zoningReportRows.map((row) => <td key={`zoning-year-${row.key}`} className={row.isTotal ? "total-row" : ""}>{row.year}</td>)}
                  </tr>
                  <tr>
                    <th>관리</th>
                    {zoningReportRows.map((row, index) => <td key={`zoning-actions-${row.key}`} className="actions">{row.isTotal ? "" : <button type="button" className="mini-button" onClick={() => removeRow("zoningRows", index, createZoningRow)}>삭제</button>}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="chart-grid">
          {(!landuseStats.consistent || !zoningStats.consistent) && <p className="data-warning">세부 면적의 합이 원자료 합계를 초과합니다. 해당 표의 구성비와 그래프를 보류했으니 원자료를 확인해 주세요.</p>}
          {(!landuseStats.complete || !zoningStats.complete) && <p className="data-warning">누락된 면적은 0으로 계산하지 않습니다. 원자료 합계가 있으면 확인된 항목의 구성비만 계산하며, 그래프의 회색 부분은 미확인 면적입니다. 합계가 없으면 구성비와 그래프를 보류합니다.</p>}
          <section className="chart-card">
            <div className="chart-header">
              <h3>지목별 토지이용 원형 그래프</h3>
              <p className="chart-caption">{landuseStats.total > 0 ? `총면적 ${formatNumber(landuseStats.total)}㎡` : "총면적 미입력"}</p>
            </div>
            <div className="chart-layout">
              <div className="pie-chart" style={{ background: pieBackground(landuseSlices) }} />
              <div className="legend">
                {landuseSlices.length ? landuseSlices.map((slice) => (
                  <div key={slice.label} className="legend-item">
                    <span className="legend-swatch" style={{ background: slice.color }} />
                    <span>{slice.label}</span>
                  </div>
                )) : <p className="chart-caption">{!landuseStats.consistent ? "면적 합계가 일치하지 않아 그래프를 보류했습니다." : landuseStats.total === null && landuseStats.knownTotal > 0 ? "합계 면적을 확인하지 못해 그래프를 보류했습니다." : "입력된 지목별 면적이 없습니다."}</p>}
              </div>
            </div>
          </section>

          <section className="chart-card">
            <div className="chart-header">
              <h3>용도지역 원형 그래프</h3>
              <p className="chart-caption">{zoningStats.total > 0 ? `총면적 ${formatNumber(zoningStats.total)}㎡` : "총면적 미입력"}</p>
            </div>
            <div className="chart-layout">
              <div className="pie-chart" style={{ background: pieBackground(zoningSlices) }} />
              <div className="legend">
                {zoningSlices.length ? zoningSlices.map((slice) => (
                  <div key={`${slice.label}-${slice.key}`} className="legend-item">
                    <span className="legend-swatch" style={{ background: slice.color }} />
                    <span>{slice.label}</span>
                  </div>
                )) : <p className="chart-caption">{!zoningStats.consistent ? "면적 합계가 일치하지 않아 그래프를 보류했습니다." : zoningStats.total === null && zoningStats.knownTotal > 0 ? "합계 면적을 확인하지 못해 그래프를 보류했습니다." : "입력된 용도지역 면적이 없습니다."}</p>}
              </div>
            </div>
          </section>
        </div>

      </section>);
}
