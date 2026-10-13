// Photo observations under the user's display rules, not official verification.
// Evidence, capture dates and unresolved examples: docs/sign-code-verification/
// visual-sign-review-2026-10-13.md. Match the original record, never all records
// sharing a remark. A changed source record must be reviewed again.
const reviews = new Map([
  ['S:04-0000386810', { remark: '자전거주의', lat: 37.4983714, lng: 127.1255598,
    codes: [], ignored: true, date: '2026-06-22', observation: '양보 표지 아래 흰색 자전거주의 문구판' }],
  ['S:04-0000386695', { remark: '횡단보도', lat: 37.4555957, lng: 127.0637639,
    codes: ['132'], date: '2026-06-15', observation: '빨간 테두리·노란 바탕 삼각형의 횡단보도 주의 도안' }],
  ['S:04-0000318429', { remark: '좌로굽은도로', lat: 37.4679511, lng: 126.9468186,
    codes: ['112'], date: '2026-08-03', observation: '좌로 굽은 도로 삼각형 도안' }],
  ['S:04-0000359126', { remark: '우로굽은길', lat: 37.4697156, lng: 126.9518899,
    codes: ['111'], date: '2026-08-03', observation: '우로 굽은 도로 삼각형 도안' }],
]);

export function seoulSignVisualRule(point) {
  if (point.source !== 'S' || point.sourceIndex !== '751') return null;
  const review = reviews.get(point.id);
  if (!review || point.sourceRemark !== review.remark
    || point.lat !== review.lat || point.lng !== review.lng) return null;
  return { ignored: Boolean(review.ignored), codes: [...review.codes], basis: 'visual',
    note: `로드뷰 ${review.date} 촬영 사진에서 ${review.observation}을 확인한 지점입니다. 현재 상태는 추가 확인이 필요합니다.` };
}
