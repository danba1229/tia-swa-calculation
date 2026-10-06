"use client";

export default function PlansStep({ addRow, createConstructionPlanRow, createTrafficPlanRow, form, removeRow, shouldShowStep, updateListItem }) {
  return (<section className={`panel step-section ${shouldShowStep(7) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 7</p>
            <h2>교통관련 계획</h2>
          </div>
        </div>

        <div className="subpanel-grid">
          <section className="subpanel">
            <div className="subpanel-header">
              <h3>교통계획</h3>
              <button type="button" className="secondary" onClick={() => addRow("trafficPlans", createTrafficPlanRow)}>계획 추가</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>계획명</th>
                    <th>연계 도시계획</th>
                    <th>내용</th>
                    <th>출처</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {form.trafficPlans.map((row, index) => (
                    <tr key={`traffic-${index}`}>
                      <td><input className="table-input" value={row.title} onChange={(event) => updateListItem("trafficPlans", index, { title: event.target.value })} placeholder="예: 시내부 간선도로망 계획" /></td>
                      <td><input className="table-input" value={row.relatedPlan} onChange={(event) => updateListItem("trafficPlans", index, { relatedPlan: event.target.value })} placeholder="예: 2030 도시기본계획" /></td>
                      <td><textarea className="table-textarea" value={row.description} onChange={(event) => updateListItem("trafficPlans", index, { description: event.target.value })} placeholder="예: 교차로 개량 및 도로 확장 계획" /></td>
                      <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("trafficPlans", index, { source: event.target.value })} placeholder="예: 시청 교통정책과" /></td>
                      <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("trafficPlans", index, createTrafficPlanRow)}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-header">
              <h3>공사 중인 시설계획</h3>
              <button type="button" className="secondary" onClick={() => addRow("constructionPlans", createConstructionPlanRow)}>시설계획 추가</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>시설명</th>
                    <th>위치/구간</th>
                    <th>진행상태</th>
                    <th>출처</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {form.constructionPlans.map((row, index) => (
                    <tr key={`construction-${index}`}>
                      <td><input className="table-input" value={row.title} onChange={(event) => updateListItem("constructionPlans", index, { title: event.target.value })} placeholder="예: 경수대로 확장공사" /></td>
                      <td><input className="table-input" value={row.location} onChange={(event) => updateListItem("constructionPlans", index, { location: event.target.value })} placeholder="예: 수원시청~인계사거리" /></td>
                      <td><input className="table-input" value={row.status} onChange={(event) => updateListItem("constructionPlans", index, { status: event.target.value })} placeholder="예: 공사중" /></td>
                      <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("constructionPlans", index, { source: event.target.value })} placeholder="예: 도로과 보도자료" /></td>
                      <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("constructionPlans", index, createConstructionPlanRow)}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

      </section>);
}
