export const TAAS_URL = 'https://taas.koroad.or.kr/gis/mcm/mcl/initMap.do?menuId=0';
export const COLLISION_TYPES = { vehicleVehicle: '차대차', vehiclePerson: '차대사람', singleVehicle: '차량단독', railway: '철길건널목' };
export const ACCIDENT_TYPES = { all: '전체 사고', pedestrian: '보행자 사고', bicycle: '자전거 사고', ...COLLISION_TYPES };

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
  return radiusQuality(counts).warnings;
}

export function radiusQuality(counts) {
  if (!counts || ['casualties', 'deaths', 'serious', 'minor', 'reported'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) return { warnings: [], notes: [], injuries: null, total: null };
  const injuries = counts.serious + counts.minor + counts.reported, total = counts.deaths + injuries;
  if (counts.casualties === total) return { warnings: [], notes: [], injuries, total };
  if (counts.casualties === injuries) return { warnings: [], notes: [`TAAS ‘사상자수’ 표기값 ${counts.casualties}명은 부상자 합계(중상·경상·부상신고)와 일치합니다. 사망 ${counts.deaths}명을 포함한 계산 합계는 ${total}명입니다. 원문과 세부값을 보존했으며 원자료 오류로 단정하지 않습니다.`], injuries, total };
  return { warnings: [`원문 합계 확인 필요: TAAS 표기 사상자 ${counts.casualties}명은 부상자 합계 ${injuries}명 및 사망 포함 계산 합계 ${total}명과 모두 다릅니다. 원문 확인이 필요합니다.`], notes: [], injuries, total };
}

// Read the active TAAS tree, including the site's year-dependent subcategories.
export function collisionFilterValues(options, type) {
  const label = COLLISION_TYPES[type];
  if (!label) throw new Error('지원하지 않는 사고유형입니다.');
  const selected = options.filter(option => option.title.trim() === label);
  if (!selected.length || selected.some(option => !/^\d{3}$/.test(option.value))) throw new Error(`TAAS ${label} 사고유형 설정 화면이 변경되었습니다.`);
  if (new Set(selected.map(option => option.value)).size !== selected.length) throw new Error('TAAS 사고유형 코드가 중복되었습니다.');
  return selected.map(option => option.value);
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
