const REFLECT_KEYWORDS = ["공사중", "착공", "사업승인", "실시계획인가", "건축허가", "준공 예정", "준공예정"];
const REVIEW_KEYWORDS = ["교통영향평가 심의완료", "심의완료", "심의", "지구단위계획", "정비구역"];
const REFERENCE_KEYWORDS = ["계획수립", "검토", "구상"];
const COMPLETED_KEYWORDS = ["준공 완료", "준공완료", "사용승인", "완료"];

function projectText(project) {
  return [
    project?.projectName,
    project?.location,
    project?.projectType,
    project?.facilityType,
    project?.projectPeriod,
    project?.developer,
    project?.reviewResult,
    typeof project?.raw === "object" ? JSON.stringify(project.raw) : project?.raw,
  ].filter(Boolean).join(" ");
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function judgeReflection(project, distanceMeters, radiusMeters) {
  if (project?.geocodeStatus === "failed") {
    return {
      reflectionStatus: "제외후보",
      reflectionReason: "위치 좌표화 실패로 거리계산 불가",
    };
  }

  if (Number.isFinite(distanceMeters) && Number.isFinite(radiusMeters) && distanceMeters > radiusMeters) {
    return {
      reflectionStatus: "제외후보",
      reflectionReason: "검색반경 초과",
    };
  }

  const text = projectText(project);
  if (includesAny(text, COMPLETED_KEYWORDS) && !text.includes("예정")) {
    return {
      reflectionStatus: "제외후보",
      reflectionReason: "준공 또는 완료 사업으로 추정",
    };
  }

  if (includesAny(text, REFLECT_KEYWORDS)) {
    return {
      reflectionStatus: "반영",
      reflectionReason: "착공/허가/인가 등 실행 단계 키워드 확인",
    };
  }

  if (includesAny(text, REVIEW_KEYWORDS)) {
    return {
      reflectionStatus: "반영검토",
      reflectionReason: "심의완료 또는 계획 확정 가능성이 있는 키워드 확인",
    };
  }

  if (includesAny(text, REFERENCE_KEYWORDS)) {
    return {
      reflectionStatus: "참고",
      reflectionReason: "계획 또는 검토 단계로 추정",
    };
  }

  return {
    reflectionStatus: "참고",
    reflectionReason: "추진단계가 불명확하여 자동판정 참고로 분류",
  };
}
