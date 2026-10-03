export function busRefreshStatusText(refresh) {
  if (!refresh) return "자료 갱신 확인 전";
  const labels = {
    UPDATED: "새 공식 자료 반영 완료", UNCHANGED: "공식 파일 확인 완료 · 변경 없음",
    FAILED: "갱신 실패 또는 검증 보류 · 기존 자료 유지", NEVER_CHECKED: "첫 자동 확인 대기",
    NOT_CONFIGURED: "자동 갱신 미설정 · 기본 파일 사용", STORE_UNAVAILABLE: "갱신 저장소 연결 실패 · 기존 자료 사용",
    INVALID_STORED_DATA: "저장 자료 검증 실패 · 기본 파일 사용",
  };
  const status = labels[refresh.status] || "갱신 상태 확인 필요";
  return `${status}${refresh.checkedAt ? ` / 마지막 확인: ${refresh.checkedAt} (UTC)` : ""}${refresh.automatic ? " / 매월 5일 04시대(한국시간) 자동 확인 설정" : " / 자동 실행 설정 확인 필요"}`;
}
