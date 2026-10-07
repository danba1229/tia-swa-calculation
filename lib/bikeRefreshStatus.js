export function bikeRefreshStatusText(refresh) {
  if (!refresh) return "자료 갱신 상태는 다시 조회하면 확인할 수 있습니다.";
  const checked = refresh.checkedAt && Number.isFinite(new Date(refresh.checkedAt).getTime())
    ? new Date(refresh.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 없음";
  const warning = !["UPDATED", "UNCHANGED"].includes(refresh.status)
    ? " · 최신 자료 확인 미완료: 이전 정상 자료를 사용합니다." : "";
  return `매월 1일 10시대 자동 확인(한국시간) · 마지막 확인: ${checked}${warning}`;
}
