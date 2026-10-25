// The MOLIT dataset's 사업기간 column has no unit; bare numbers (48, 60) read as months.
export function formatProjectPeriod(project) {
  const period = String(project?.projectPeriod ?? "").trim();
  const periodText = /^\d+(?:\.\d+)?$/.test(period) ? `${period}개월(추정)` : period;
  const target = project?.targetYear ? `목표연도 ${project.targetYear}` : "";
  return [periodText, target].filter(Boolean).join(" · ");
}

export function formatTargetYear(raw) {
  const short = String(raw?.goalYySrtpd ?? "").trim(), long = String(raw?.goalYyLngtr ?? "").trim();
  return [short && `단기 ${short}`, long && `장기 ${long}`].filter(Boolean).join(" / ");
}
