export function roadProvenance(overrides = {}) {
  return {
    sourceReferenceDate: "", retrievedAt: "",
    endpointSource: "", endpointReferenceDate: "",
    totalWidth: "", carriagewayWidth: "", widthSource: "", widthReferenceDate: "",
    ...overrides,
  };
}

export function roadEndpointSummary(row = {}) {
  return `도로 전체 기종점 / 기점: ${String(row.startAddress || "").trim() || "수동 조사필요"} / 종점: ${String(row.endAddress || "").trim() || "수동 조사필요"} / 기종점 출처: ${String(row.endpointSource || "").trim() || "미확인"} / 기종점 자료 기준일: ${String(row.endpointReferenceDate || "").trim() || "미확인"} / 자동검증 미수행`;
}

export function roadWidthSummary(row = {}) {
  const display = value => value === undefined || value === null || String(value).trim() === "" ? "수동 조사필요" : `${value}m (수동 입력값)`;
  return `전체폭(보도 포함): ${display(row.totalWidth)} / 차도폭: ${display(row.carriagewayWidth)} / 폭원 출처: ${String(row.widthSource || "").trim() || "미확인"} / 폭원 자료 기준일: ${String(row.widthReferenceDate || "").trim() || "미확인"}`;
}

export function roadRetrievedDate(value) {
  if (typeof value !== "string" || !value.trim()) return "조회일 미기록";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "조회일 미기록";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function roadDateSummary(row = {}) {
  const referenceDate = String(row.sourceReferenceDate || "").trim();
  return `자료 기준일: ${referenceDate || "미확인"} / 조회일: ${roadRetrievedDate(row.retrievedAt)}`;
}
