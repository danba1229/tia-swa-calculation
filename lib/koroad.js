import regionData from './koroadRegions.json' with { type: 'json' };
import { decodeKoroadKey, distanceMeters } from './accidentSurvey.js';

export function findStatisticsRegion(region) {
  const aliases = { '강원도': '강원특별자치도', '전라북도': '전북특별자치도', '제주도': '제주특별자치도' };
  const province = aliases[region.region_1depth_name] || region.region_1depth_name;
  const district = region.region_2depth_name || province;
  const matches = regionData.regions.filter(r => (aliases[r.province] || r.province) === province && (r.district === district || district.startsWith(r.district + ' ')));
  if (matches.length !== 1) throw new Error('해당 지역의 공단 통계코드가 확인되지 않았습니다.');
  return matches[0];
}

export async function getKoroadRows(endpoint, params, { fetchImpl = fetch, key = process.env.KOROAD_API_KEY } = {}) {
  if (!['stt', 'frequentzone/bicycle', 'frequentzone/pedstrians'].includes(endpoint)) throw new Error('지원하지 않는 API');
  const rows = [], pageSignatures = new Set(); let total;
  for (let page = 1; page <= 30; page++) {
    const url = new URL(`https://opendata.koroad.or.kr/data/rest/${endpoint}`);
    url.search = new URLSearchParams({ ...params, authKey: decodeKoroadKey(key), type: 'json', numOfRows: '1000', pageNo: String(page) });
    let response, data;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), cache: 'no-store', redirect: 'error' }); data = await response.json(); }
    catch { throw new Error('공단 API 연결 또는 응답 형식 오류'); }
    if (!response.ok) throw new Error(`공단 API HTTP ${response.status}`);
    if (data.resultCode === '03' && page === 1) return { rows: [], status: 'no_data' };
    if (data.resultCode !== '00') throw new Error(`공단 API 오류 코드 ${String(data.resultCode).replace(/[^\w-]/g, '').slice(0, 20)}${data.resultCode === '30' ? ' (인증/활용승인 확인 필요)' : ''}`);
    if (total != null && total !== Number(data.totalCount)) throw new Error('공단 API 페이지별 전체 건수가 달라졌습니다.');
    total = Number(data.totalCount);
    if (!Number.isSafeInteger(total) || total < 0 || total > 30000) throw new Error('공단 API 전체 건수 형식 오류');
    const items = data.items?.item;
    const batch = Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
    const signature = JSON.stringify(batch);
    if (pageSignatures.has(signature)) throw new Error('공단 API 페이지가 반복되었습니다.');
    pageSignatures.add(signature);
    rows.push(...batch);
    if (rows.length === total) return { rows, status: total ? 'success' : 'no_data' };
    if (!batch.length || rows.length > total) throw new Error('공단 API 응답 일부가 누락되었습니다.');
  }
  throw new Error('공단 API 페이지 조회 한도 초과');
}

export async function surveyKoroad(query) {
  const key = String(process.env.KAKAO_REST_API_KEY || '').trim();
  if (!key) throw new Error('좌표의 행정구역 확인을 위한 KAKAO_REST_API_KEY가 없습니다.');
  let data;
  try {
    const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json');
    url.search = new URLSearchParams({ x: String(query.lng), y: String(query.lat) });
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch { throw new Error('좌표의 행정구역을 확인하지 못했습니다.'); }
  const region = data.documents?.find(r => r.region_type === 'B');
  if (!region || !/^\d{10}$/.test(region.code)) throw new Error('법정동 행정구역 코드가 없습니다.');
  const tasks = {};
  try {
    const mapped = findStatisticsRegion(region);
    tasks.statistics = getKoroadRows('stt', { searchYearCd: String(query.year), siDo: mapped.siDo, guGun: mapped.guGun });
  } catch (e) { tasks.statistics = Promise.reject(e); }
  const params = { searchYearCd: String(query.year), siDo: region.code.slice(0, 2), guGun: region.code.slice(2, 5) };
  tasks.bicycle = getKoroadRows('frequentzone/bicycle', params);
  tasks.pedestrian = getKoroadRows('frequentzone/pedstrians', params);
  const entries = Object.entries(tasks), results = await Promise.allSettled(entries.map(([, p]) => p));
  const sections = Object.fromEntries(results.map((result, i) => {
    const name = entries[i][0];
    if (result.status === 'rejected') return [name, { status: 'error', message: result.reason.message, rows: null }];
    const value = result.value;
    if (name !== 'statistics') {
      const districtTotal = value.rows.length;
      value.rows = value.rows.map(row => ({ ...row, distance: distanceMeters(query, { lat: Number(row.la_crd), lng: Number(row.lo_crd) }) })).filter(row => Number.isFinite(row.distance) && row.distance <= query.radius);
      value.districtTotal = districtTotal;
      value.scope = '다발지역 중심점이 지정 반경 안에 있는 지점. 각 지점 사고수의 합은 반경 내 전체 사고수가 아닙니다.';
    } else if (value.rows.some(row => String(row.std_year) !== String(query.year))) {
      return [name, { status: 'error', message: '공단 응답 연도가 요청과 다릅니다.', rows: null }];
    }
    return [name, value];
  }));
  return { query, region: { name: region.address_name, code: region.code }, sections, retrievedAt: new Date().toISOString(), sourceUrl: 'https://opendata.koroad.or.kr/' };
}
