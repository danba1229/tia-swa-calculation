'use client';
import { SURVEY_STATUS_LABELS } from '../lib/surveyStatus';
export default function StepNavigation({ items, activeStep, setActiveStep, states, children }) {
  return <aside className="step-nav-panel" aria-label="조사 단계 목차">
    <div className="workspace-brand">
      <span className="brand-symbol" aria-hidden="true">T</span>
      <span><strong>TIA Support</strong><small>교통영향평가 조사 도구</small></span>
    </div>
    <div className="step-nav-header"><h2>조사 항목</h2><span>01 — 08</span></div>
    <nav className="step-nav" aria-label="조사 항목">{items.map(item => <button key={item.step} type="button"
      className={activeStep === item.step ? 'active' : ''} aria-pressed={activeStep === item.step} onClick={() => setActiveStep(item.step)}>
      <span className="step-number" aria-hidden="true">{item.step ? String(item.step).padStart(2, '0') : '◎'}</span><strong>{item.label}</strong>
      {!!item.step && <small className={`step-state state-${states[item.step]}`}>{SURVEY_STATUS_LABELS[states[item.step]] || '미확인'}</small>}
    </button>)}</nav>
    <div className="workspace-nav-footer">
      {children}
      <details className="workspace-help"><summary>조사 진행 안내</summary><p className="investigation-progress">상단 조사 시작으로 자동 조사 항목을 함께 실행합니다. 교통관련 계획은 수동 확인이며, 사고조사는 별도 반경·연도 조건을 사용합니다.</p></details>
    </div>
  </aside>;
}
