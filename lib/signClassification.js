import { POLICE_SIGN_CODES } from './policeSignCodes.js';

const codes = new Set(POLICE_SIGN_CODES);
// Only individually reviewed evidence belongs here. Number equality, a sample
// remark, or a shared sourceIndex never verifies other records. No records have
// yet met this standard. Bind reviews to identity, raw code and coordinates so
// changed source records cannot silently inherit a previous confirmation.
const reviewedSigns = {};
export function classifySign(point, reviews = reviewedSigns) {
  const review = reviews[point.id];
  const verified = point.source === 'S' && review &&
    review.sourceIndex === point.sourceIndex && review.lat === point.lat && review.lng === point.lng &&
    codes.has(review.policeCode) && Boolean(review.evidence?.trim()) && Boolean(review.reviewedAt?.trim());
  const candidate = point.source === 'S' && codes.has(point.sourceIndex) ? point.sourceIndex : null;
  const policeCode = verified ? review.policeCode : candidate;
  return {
    ...point, managementId: point.label, label: policeCode || '?', policeCode,
    verified: Boolean(verified), color: verified ? '#2563eb' : '#dc2626',
    reason: verified ? '개별 근거로 표지 의미 확인' : point.source === 'R' ? '도로 안내표지는 경찰청 안전표지 일람표의 대응 대상이 아닙니다.'
      : candidate ? '일람표와 번호만 일치합니다. 해당 시설의 표지 의미는 추가 확인이 필요합니다.'
        : '경찰청 표지번호와의 대응이 확인되지 않았습니다. 원본 인덱스를 임의 변환하지 않습니다.',
    evidence: verified ? review.evidence : null,
  };
}
