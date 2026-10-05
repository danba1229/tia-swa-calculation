export const TAAS_URL = 'https://taas.koroad.or.kr/gis/mcm/mcl/initMap.do?menuId=0';
export const ACCIDENT_TYPES = { all: '전체 사고', pedestrian: '보행자 사고', bicycle: '자전거 사고' };

export function validateAccidentQuery(input) {
  const lat = Number(input?.lat), lng = Number(input?.lng), radius = Number(input?.radius), year = Number(input?.year);
  if (!input || [input.lat, input.lng, input.radius, input.year].some(v => v === '' || v == null)) throw new Error('좌표, 반경, 연도를 입력해 주세요.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39.5 || lng < 124 || lng > 132) throw new Error('대한민국 범위의 위도·경도를 입력해 주세요.');
  if (!Number.isInteger(radius) || radius < 10 || radius > 2000) throw new Error('반경은 10~2,000m 정수로 입력해 주세요.');
  if (!Number.isInteger(year) || year < 2007 || year >= new Date().getFullYear()) throw new Error('조사 연도를 확인해 주세요.');
  if (!Object.hasOwn(ACCIDENT_TYPES, input.type)) throw new Error('사고 구분을 확인해 주세요.');
  return { lat, lng, radius, year, type: input.type };
}

export function parseRadiusResult(text, marker, expectedXY) {
  const normalized = text.replaceAll('\u00a0', ' ');
  if (!normalized.includes(marker)) throw new Error('TAAS 응답의 조사 지점이 일치하지 않습니다.');
  const coordinate = normalized.match(/입력좌표\s*:\s*([\d.-]+)\s*,\s*([\d.-]+)/);
  if (!coordinate || coordinate.slice(1).some((v, i) => Math.abs(Number(v) - expectedXY[i]) > 0.1)) throw new Error('TAAS 응답 좌표 검증 실패');
  const labels = { accidents: '사고건수', casualties: '사상자수', deaths: '사망자수', serious: '중상자수', minor: '경상자수', reported: '부상신고자수' };
  const counts = {};
  for (const [key, label] of Object.entries(labels)) {
    const match = normalized.match(new RegExp(`${label}\\s*:\\s*([\\d,]+)(?=\\s|,|$)`));
    if (!match) throw new Error(`TAAS ${label} 응답 누락`);
    counts[key] = Number(match[1].replaceAll(',', ''));
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) throw new Error('TAAS 집계값 형식 오류');
  }
  return counts;
}

export function radiusQualityWarnings(counts) {
  const sum = counts.deaths + counts.serious + counts.minor + counts.reported;
  return counts.casualties === sum ? [] : [`원문 합계 확인 필요: TAAS 표기 사상자 ${counts.casualties}명, 사망·중상·경상·부상신고 합계 ${sum}명. 원문을 보존했으며 보고서 확정 전 확인해 주세요.`];
}

export function decodeKoroadKey(key) {
  const value = String(key || '').trim();
  if (!value) throw new Error('KOROAD_API_KEY 환경변수가 설정되지 않았습니다.');
  try { return /%[\da-f]{2}/i.test(value) ? decodeURIComponent(value) : value; }
  catch { throw new Error('KOROAD_API_KEY 인코딩 형식 오류'); }
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2)));
}
