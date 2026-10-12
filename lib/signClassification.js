import { POLICE_SIGN_CODES } from './policeSignCodes.js';
import { SEOUL_SIGN_CODE_MAPPINGS, seoulSignDisplayRule } from './seoulSignCodeMappings.js';

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
  const rule = seoulSignDisplayRule(point);
  const userMappedCode = point.source === 'S' && Object.hasOwn(SEOUL_SIGN_CODE_MAPPINGS, point.sourceIndex)
    ? SEOUL_SIGN_CODE_MAPPINGS[point.sourceIndex] : null;
  const candidate = point.source === 'S' && codes.has(point.sourceIndex) ? point.sourceIndex : null;
  const policeCodes = rule ? rule.codes : userMappedCode ? [userMappedCode] : candidate ? [candidate] : [];
  const policeCode = policeCodes.join(', ') || null;
  return {
    ...point, managementId: point.label, label: policeCode || '?', policeCode,
    policeCodes, ignored: rule?.ignored || false,
    mappingBasis: rule || userMappedCode ? 'user' : candidate ? 'code-match' : null,
    color: SIGN_COLOR, roadviewUrl: signRoadviewUrl(point),
    sourceCodeRemark: `${point.source === 'S' ? '서울시 표지판 코드(표지인덱스)' : '서울시 표지종별'}: ${point.sourceIndex || '수동확인필요'}`,
    reason: point.source === 'R' ? '도로 안내표지는 경찰청 안전표지 일람표의 대응 대상이 아닙니다.'
      : rule?.ignored ? '사용자 지정 규칙에 따라 지도와 목록에서 제외합니다. 원본 자료는 보존합니다.'
        : rule ? `사용자 지정 매핑: ${point.sourceIndex} → ${policeCode}. 원본 비고에 따라 표시하며, 실제 표지 내용은 추가 확인이 필요합니다.`
          : userMappedCode ? `사용자 지정 매핑: ${point.sourceIndex} → ${userMappedCode}. 원본 비고와 관계없이 동일하게 표시하며, 실제 표지 내용은 추가 확인이 필요합니다.`
        : candidate ? '일람표와 번호만 일치합니다. 해당 시설의 표지 의미는 추가 확인이 필요합니다.'
        : '경찰청 표지번호와의 대응이 확인되지 않았습니다. 원본 인덱스를 임의 변환하지 않습니다.',
  };
}

export function visibleSigns(points) {
  return points.map(classifySign).filter(point => !point.ignored);
}
