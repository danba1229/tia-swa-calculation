'use client';
import { SURVEY_STATUS_LABELS } from '../lib/surveyStatus';
export default function StepNavigation({ items, activeStep, setActiveStep, states, children }) {
  return <section className="step-nav-panel" aria-label="조사 단계 목차">
    {children}
    <div className="step-nav-header"><p className="eyebrow">Step Index</p><h2>목차</h2></div>
    <div className="step-nav">{items.map(item => <button key={item.step} type="button"
      className={activeStep === item.step ? 'active' : ''} aria-pressed={activeStep === item.step} onClick={() => setActiveStep(item.step)}>
      <span>Step.{item.step}</span><strong>{item.label}</strong>
      {!!item.step && <small className={`step-state state-${states[item.step]}`}>{SURVEY_STATUS_LABELS[states[item.step]] || '미확인'}</small>}
    </button>)}</div>
    <p className="investigation-progress" role="status">상단 조사 시작으로 자동 조사 항목을 함께 실행합니다. 교통관련 계획은 수동 확인이며, 사고조사는 별도 반경·연도 조건을 사용합니다.</p>
  </section>;
}
