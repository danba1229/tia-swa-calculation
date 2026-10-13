import { POLICE_SIGN_CODES } from './policeSignCodes.js';
import { SEOUL_SIGN_CODE_MAPPINGS, seoulSignDisplayRule, seoulSupplementaryExceptions } from './seoulSignCodeMappings.js';

const codes = new Set(POLICE_SIGN_CODES);
const hiddenSupplementaryCodes = new Set(POLICE_SIGN_CODES.filter(code => code.startsWith('4') && !['427', '428'].includes(code)));
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
  let rule = seoulSignDisplayRule(point);
  const userMappedCode = point.source === 'S' && Object.hasOwn(SEOUL_SIGN_CODE_MAPPINGS, point.sourceIndex)
    ? SEOUL_SIGN_CODE_MAPPINGS[point.sourceIndex] : null;
  const candidate = point.source === 'S' && codes.has(point.sourceIndex) ? point.sourceIndex : null;
  const exceptions = seoulSupplementaryExceptions(point);
  if (exceptions.length) {
    const originalCodes = rule ? rule.codes : userMappedCode ? [userMappedCode] : candidate ? [candidate] : [];
    rule = { ...rule, ignored: false, codes: [...new Set([...originalCodes, ...exceptions])],
      basis: rule?.basis || 'remark',
      note: rule?.note || '해제·견인지역은 표시를 유지합니다. 나머지 미지정 내용은 원본 비고를 확인하세요.' };
  }
  const mappedCodes = rule ? rule.codes : userMappedCode ? [userMappedCode] : candidate ? [candidate] : [];
  const omittedPoliceCodes = mappedCodes.filter(code => hiddenSupplementaryCodes.has(code));
  const policeCodes = mappedCodes.filter(code => !hiddenSupplementaryCodes.has(code));
  const policeCode = policeCodes.join(', ') || null;
  // Hide unmatched safety records and supplementary-only records. Keep the
  // regulatory/warning/instruction components of mixed signs and 427/428.
  // The approved one-way text and road signs remain separate.
  const ignored = Boolean(rule?.ignored || (point.source === 'S' && !policeCode && !rule?.displayLabel));
  return {
    ...point, managementId: point.label, label: policeCode || rule?.displayLabel || '?', policeCode,
    displayOnly: Boolean(rule?.displayLabel && !policeCode),
    policeCodes, omittedPoliceCodes, ignored,
    mappingBasis: rule || userMappedCode || ignored || omittedPoliceCodes.length ? 'user' : candidate ? 'code-match' : null,
    color: SIGN_COLOR, roadviewUrl: signRoadviewUrl(point),
    sourceCodeRemark: `${point.source === 'S' ? '서울시 표지판 코드(표지인덱스)' : '서울시 표지종별'}: ${point.sourceIndex || '수동확인필요'}`,
    reason: point.source === 'R' ? '도로 안내표지는 경찰청 안전표지 일람표의 대응 대상이 아닙니다.'
      : ignored ? `사용자 지정 규칙에 따라 ${omittedPoliceCodes.length ? '해제·견인지역 외 보조표지를' : '이 항목을'} 지도와 목록에서 제외합니다. 원본 자료는 보존합니다.${rule?.note ? ` ${rule.note}` : ''}`
        : rule?.displayLabel ? '사용자 지정 문구: 일방. 화살표 방향이 미확인되어 일람표 번호를 지정하지 않았습니다. 실제 표지는 추가 확인이 필요합니다.'
        : rule ? `사용자 지정 매핑: ${point.sourceIndex} → ${policeCode}. ${rule.basis === 'code' ? '원본 비고와 관계없이 동일하게 표시하며' : rule.basis === 'visual' ? '해당 지점의 사진 판독에 따라 표시하며' : '원본 비고에 따라 표시하며'}, 실제 표지 내용은 추가 확인이 필요합니다.${omittedPoliceCodes.length ? ' 해제·견인지역 외 보조표지 번호는 생략합니다.' : ''}${rule.note ? ` ${rule.note}` : ''}`
          : userMappedCode ? `사용자 지정 매핑: ${point.sourceIndex} → ${userMappedCode}. 원본 비고와 관계없이 동일하게 표시하며, 실제 표지 내용은 추가 확인이 필요합니다.`
        : candidate ? '일람표와 번호만 일치합니다. 해당 시설의 표지 의미는 추가 확인이 필요합니다.'
        : '경찰청 표지번호와의 대응이 확인되지 않았습니다. 원본 인덱스를 임의 변환하지 않습니다.',
  };
}

export function visibleSigns(points, mode = 'police') {
  if (mode === 'seoul') return points.map(point => ({
    ...point, managementId: point.label, label: point.sourceIndex || '?',
    policeCode: null, policeCodes: [], omittedPoliceCodes: [],
    displayOnly: false, ignored: false, mappingBasis: 'source',
    color: SIGN_COLOR, roadviewUrl: signRoadviewUrl(point),
    sourceCodeRemark: `${point.source === 'S' ? '서울시 표지판 코드(표지인덱스)' : '서울시 표지종별'}: ${point.sourceIndex || '수동확인필요'}`,
    reason: '서울시 공개자료의 원본 코드와 비고입니다. 실제 표지의 종류·위치·설치 상태는 추가 확인이 필요합니다.',
  }));
  return points.map(classifySign).filter(point => !point.ignored);
}
