import { POLICE_SIGN_CODES } from './policeSignCodes.js';

const codes = new Set(POLICE_SIGN_CODES);
// All source records require additional checking. Color denotes a sign location,
// never verification. Preserve the raw Seoul code in a separate note.
export const SIGN_COLOR = '#2563eb';
export function signRoadviewUrl(point) {
  if (point.lat == null || point.lng == null || String(point.lat).trim() === '' || String(point.lng).trim() === '') return null;
  const lat = Number(point.lat), lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `https://map.kakao.com/link/roadview/${lat},${lng}`;
}
export function classifySign(point) {
  const candidate = point.source === 'S' && codes.has(point.sourceIndex) ? point.sourceIndex : null;
  const policeCode = candidate;
  return {
    ...point, managementId: point.label, label: policeCode || '?', policeCode,
    color: SIGN_COLOR, roadviewUrl: signRoadviewUrl(point),
    sourceCodeRemark: `${point.source === 'S' ? '서울시 표지판 코드(표지인덱스)' : '서울시 표지종별'}: ${point.sourceIndex || '수동확인필요'}`,
    reason: point.source === 'R' ? '도로 안내표지는 경찰청 안전표지 일람표의 대응 대상이 아닙니다.'
      : candidate ? '일람표와 번호만 일치합니다. 해당 시설의 표지 의미는 추가 확인이 필요합니다.'
        : '경찰청 표지번호와의 대응이 확인되지 않았습니다. 원본 인덱스를 임의 변환하지 않습니다.',
  };
}
