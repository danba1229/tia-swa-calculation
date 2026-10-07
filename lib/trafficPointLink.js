const clean = (value) => String(value ?? "").trim();
const compact = (value) => clean(value).replace(/\s+/g, "");

export function trafficPointMetadata(point) {
  // Older stored catalogs keep these source fields in the display name.
  const parts = clean(point?.name).split(" · ");
  return {
    route: clean(point?.routeName || parts[0]),
    region: clean(point?.regionName || parts[1]),
  };
}

export function gyeonggiPointLink(candidate, points = [], month = "") {
  if (!candidate) return { status: "NO_CANDIDATE", station: "", note: "GITS 추천지점이 없습니다. 별도 참고지점을 직접 선택할 수 있습니다." };
  const matches = points.filter((point) => clean(point.code) === clean(candidate.pointCode));
  if (!matches.length) return { status: "NO_DATA", station: "", note: "선택 월에 동일 지점번호의 시간대별 연결 자료가 없습니다. 다른 지점으로 자동 대체하지 않습니다." };
  if (matches.length !== 1) return { status: "REVIEW_REQUIRED", station: "", note: "같은 번호가 복수로 확인돼 자동 연결하지 않습니다." };
  const metadata = trafficPointMetadata(matches[0]);
  const sourceYear = clean(candidate.sourceYear);
  const same = compact(candidate.routeName) && compact(candidate.jurisdiction) !== "-"
    && compact(candidate.jurisdiction) && compact(metadata.route) === compact(candidate.routeName)
    && compact(metadata.region) === compact(candidate.jurisdiction)
    && /^20\d{2}$/.test(sourceYear) && sourceYear === month.slice(0, 4);
  if (!same) return { status: "REVIEW_REQUIRED", station: "", note: "번호는 같지만 노선·지역·자료연도 일치를 확인하지 못했습니다. 동일 지점으로 자동 연결하지 않습니다." };
  return { status: "MATCHED", station: matches[0].code, note: "지점번호·노선·지역·자료연도가 일치하는 원자료를 연결했습니다. 지점의 조사 목적 적합성은 별도 확인이 필요합니다." };
}

export function peakAnalysisIdentity({ provider, address, candidate, station, month, reference = false }) {
  return JSON.stringify([provider, address, candidate?.pointCode || "", candidate?.routeCode || "", station, month, reference]);
}

export function peakConnectionRows({ candidate, point, month, link, reference }) {
  return [
    ["분석 연결 구분", reference ? "별도 참고지점 (GITS 추천지점의 교통량이 아님)" : "동일 지점 연결"],
    ["GITS 추천지점", candidate?.pointCode || "없음", candidate?.routeName || "", candidate?.jurisdiction || "", candidate?.sectionName || ""],
    ["GITS 자료연도", candidate?.sourceYear || "미확인"],
    ["실제 분석지점", point?.code || "", point?.name || "", "수록 월", month],
    ["동일 지점 연결 상태", link.status, link.note],
    ["위치 확인", "상시지점의 정확 좌표·거리가 검증되지 않았으므로 최근접 지점으로 단정하지 않음"],
  ];
}
