"use client";

import { useState } from "react";

export default function SurveyPointsStep({ detectSurveyRegion, buildPriorityResult, buildPriorityNote, runAll, TrafficPeakAnalysis, autoSurveyPoints, form, formatDistance, gyeonggiCandidates, gyeonggiStatus, selectedSurveyPoint, shouldShowStep, surveyRecommendations, topisCandidates, topisStatus, onPeakPointChange }) {
  const [peakChoice, setPeakChoice] = useState(null);
  const region = detectSurveyRegion(form.basics.siteAddress);
  const peakCandidate = gyeonggiCandidates.find((candidate) => peakChoice?.address === form.basics.siteAddress
    && peakChoice.code === candidate.pointCode && peakChoice.route === candidate.routeCode) || gyeonggiCandidates[0];
  return (<section className={`panel step-section ${shouldShowStep(2) ? "" : "is-hidden"}`}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>가까운 사전조사지점</h2>
          </div>
        </div>

        {detectSurveyRegion(form.basics.siteAddress) === "seoul" ? (
          <div className="survey-recommendation-block">
            <div className="output-header">
              <h3>서울 TOPIS 최근접 3지점</h3>
            </div>
            <p className="priority-note">{topisStatus || "서울 TOPIS 지점 좌표를 준비하는 중입니다."}</p>
            <div className="survey-recommendations">
              {topisCandidates.map((candidate, index) => (
                <article key={candidate.code} className="survey-recommendation-card">
                  <div className="survey-recommendation-top">
                    <span className="status-badge">{candidate.code}</span>
                    <p className="eyebrow survey-rank">{`${index + 1}순위 · ${candidate.category}`}</p>
                  </div>
                  <h3>{candidate.name}</h3>
                  <p>{candidate.address}</p>
                  <p className="candidate-distance">사업지 기준 {formatDistance(candidate.distanceKm)}</p>
                  <div className="survey-links">
                    <a href="https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily" target="_blank" rel="noreferrer">출처 보기</a>
                    <a href="https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport" target="_blank" rel="noreferrer">조사자료 PDF</a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {detectSurveyRegion(form.basics.siteAddress) === "gyeonggi" ? (
          <div className="survey-recommendation-block">
            <div className="output-header">
              <h3>경기 GITS 최근접 3지점</h3>
            </div>
            <p className="priority-note">{gyeonggiStatus || "경기 GITS 지점번호 후보를 준비하고 있습니다."}</p>
            <div className="survey-recommendations">
              {gyeonggiCandidates.map((candidate, index) => (
                <article key={`${candidate.routeCode}-${candidate.pointCode}`} className="survey-recommendation-card">
                  <div className="survey-recommendation-top">
                    <span className="status-badge">{candidate.pointCode}</span>
                    <p className="eyebrow survey-rank">{`${index + 1}순위 · ${candidate.categoryLabel}`}</p>
                  </div>
                  <h3>{candidate.routeName}</h3>
                  <p>{candidate.jurisdiction} / {candidate.sectionName}</p>
                  <p className="candidate-distance">
                    {Number.isFinite(candidate.distanceKm)
                      ? `사업지 기준 ${formatDistance(candidate.distanceKm)}`
                      : "거리 계산 전 단계 후보"}
                  </p>
                  <p className="candidate-note">
                    {Number.isFinite(candidate.distanceKm)
                      ? "거리 계산은 구간 양끝(IC/JCT) 기준의 근사값입니다."
                      : "지점번호는 공식 GITS 자료 기준이며, 현재는 거리 계산 없이 후보로 먼저 표시합니다."}
                  </p>
                  <div className="survey-links">
                    <a href="https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do" target="_blank" rel="noreferrer">출처 보기</a>
                    <a href="https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do" target="_blank" rel="noreferrer">2순위 자료</a>
                    <a href="#weekly-traffic-analysis" onClick={() => setPeakChoice({ address: form.basics.siteAddress, code: candidate.pointCode, route: candidate.routeCode })}>
                      {peakCandidate === candidate ? "선택 지점 첨두분석 연결 확인" : "이 지점 첨두분석 연결 확인"}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        <div className="survey-recommendations">
          {surveyRecommendations.map((recommendation) => (
            <article key={recommendation.key} className="survey-recommendation-card">
              <div className="survey-recommendation-top">
                <span className="status-badge">{recommendation.source}</span>
                <p className="eyebrow">공식 추천 출처</p>
              </div>
              <h3>{recommendation.title}</h3>
              <p>{recommendation.description}</p>
              <div className="survey-links">
                <a href={recommendation.sourceLink} target="_blank" rel="noreferrer">출처 보기</a>
                <a href={recommendation.downloadLink} target="_blank" rel="noreferrer">다운로드/조회</a>
              </div>
            </article>
          ))}
        </div>

        <div className="priority-card">
          <div>
            <p className="priority-label">최종 판정</p>
            <p className="priority-result">{buildPriorityResult(selectedSurveyPoint, autoSurveyPoints)}</p>
          </div>
          <p className="priority-note">{buildPriorityNote(selectedSurveyPoint, autoSurveyPoints)}</p>
        </div>

        <TrafficPeakAnalysis key={`${form.basics.siteAddress}:${region === "gyeonggi" ? `${peakCandidate?.routeCode || ""}:${peakCandidate?.pointCode || ""}` : ""}`} address={form.basics.siteAddress}
          region={region} candidates={region === "gyeonggi" ? gyeonggiCandidates : topisCandidates}
          selectedCandidate={region === "gyeonggi" ? peakCandidate : null} active={shouldShowStep(2) || runAll} onMapPointChange={onPeakPointChange} />

      </section>);
}
