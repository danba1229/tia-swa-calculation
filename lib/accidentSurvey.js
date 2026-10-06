export const TAAS_URL = 'https://taas.koroad.or.kr/gis/mcm/mcl/initMap.do?menuId=0';
export const COLLISION_TYPES = { vehicleVehicle: '차대차', vehiclePerson: '차대사람', singleVehicle: '차량단독', railway: '철길건널목' };
export const ACCIDENT_TYPES = { all: '전체 사고', pedestrian: '보행자 사고', bicycle: '자전거 사고', ...COLLISION_TYPES };

export function validateAccidentQuery(input) {
  const lat = Number(input?.lat), lng = Number(input?.lng), radius = Number(input?.radius), year = Number(input?.year);
  if (!input || [input.lat, input.lng, input.radius, input.year].some(v => v === '' || v == null)) throw new Error('좌표, 반경, 연도를 입력해 주세요.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39.5 || lng < 124 || lng > 132) throw new Error('대한민국 범위의 위도·경도를 입력해 주세요.');
  if (!Number.isInteger(radius) || radius < 10 || radius > 1000) throw new Error('반경은 검증된 범위인 10~1,000m 정수로 입력해 주세요.');
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

export const COLLISION_COLLECTION_METHOD = 'individual-subtypes-v1';
export const SPATIAL_COLLECTION_METHOD = 'spatial-records-v1';
const COUNT_FIELDS = ['accidents', 'casualties', 'deaths', 'serious', 'minor', 'reported'];

// Never publish a partial sum: every leaf from the current TAAS tree must succeed once.
export function sumCollisionResults(expectedCodes, results) {
  if (!expectedCodes.length || new Set(expectedCodes).size !== expectedCodes.length || results.length !== expectedCodes.length) throw new Error('TAAS 세부유형 조회 누락 또는 중복');
  const counts = Object.fromEntries(COUNT_FIELDS.map(key => [key, 0]));
  const seen = new Set();
  for (const result of results) {
    if (!expectedCodes.includes(result.code) || seen.has(result.code)) throw new Error('TAAS 세부유형 조회 누락 또는 중복');
    seen.add(result.code);
    for (const key of COUNT_FIELDS) {
      const value = result.counts?.[key];
      if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(counts[key] + value)) throw new Error('TAAS 세부유형 집계값 누락 또는 형식 오류');
      counts[key] += value;
    }
  }
  return counts;
}

export function surveyQuality(data) {
  const quality = radiusQuality(data?.counts);
  const individual = data?.collectionMethod === COLLISION_COLLECTION_METHOD;
  const warnings = [...quality.warnings], notes = [...quality.notes];
  if (data?.collectionMethod === SPATIAL_COLLECTION_METHOD) notes.unshift('공간분석 WFS 개별 사고 원자료를 집계한 계산값입니다. 사상자 집계는 사망·중상·경상·부상신고의 합계이며 TAAS 반경분석 화면의 사상자 표기값과 구분합니다.');
  if (individual) {
    notes.unshift('사고유형 값은 세부유형별 개별 조회의 계산 합계입니다. 각 TAAS 원문은 별도로 보존합니다.');
    for (const row of data.subtypeResults || []) {
      const child = radiusQuality(row.counts);
      warnings.push(...child.warnings.map(text => `${row.label || row.code}: ${text}`));
      notes.push(...child.notes.map(text => `${row.label || row.code}: ${text}`));
    }
  }
  return { ...quality, warnings: [...new Set(warnings)], notes: [...new Set(notes)] };
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
