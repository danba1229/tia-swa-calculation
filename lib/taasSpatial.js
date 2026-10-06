import proj4 from 'proj4';
import { createHash } from 'node:crypto';
import { COLLISION_TYPES, SPATIAL_COLLECTION_METHOD, TAAS_URL, surveyQuality, validateAccidentQuery } from './accidentSurvey.js';

const WFS_URL = 'https://taas.koroad.or.kr/gis36/TAAS/wfs';
const TM = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs';
const UTM = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';
const LIMIT = 10000;
const fields = { deaths: 'dprs_cnt', serious: 'sep_cnt', minor: 'slp_cnt', reported: 'inj_aplcnt_cnt' };
const cache = new Map();

export function spatialRequest(input) {
  const query = validateAccidentQuery(input);
  const center = proj4('EPSG:4326', TM, [query.lng, query.lat]);
  // 720 segments: maximum inward chord error at 1km is under 1cm.
  const ring = Array.from({ length: 720 }, (_, i) => proj4(TM, UTM, [center[0] + query.radius * Math.cos(i * Math.PI / 360), center[1] + query.radius * Math.sin(i * Math.PI / 360)]));
  ring.push(ring[0]);
  const polygon = `POLYGON((${ring.map(point => point.map(n => n.toFixed(5)).join(' ')).join(', ')}))`;
  const clauses = [`acdnt_year='${query.year}'`, "acdnt_gae_code IN ('01','02','03','04')", `INTERSECTS(geom, ${polygon})`];
  if (COLLISION_TYPES[query.type]) clauses.push(`acdnt_hdc='${COLLISION_TYPES[query.type]}'`);
  if (query.type === 'pedestrian') clauses.push("acc_cls_08yn='1'");
  if (query.type === 'bicycle') clauses.push("acc_cls_49yn='1'");
  const body = new URLSearchParams({ service: 'WFS', version: '1.0.0', srsName: 'EPSG:5179', request: 'GetFeature', typeName: 'TAAS:GNRL_GIS_ACDNT_INFO_DEFAULT', outputFormat: 'json', maxFeatures: String(LIMIT), propertyname: 'geom,acdnt_no,acdnt_year,acdnt_hdc,acdnt_code,acdnt_dc,acdnt_gae_code,acc_cls_08yn,acc_cls_49yn,dprs_cnt,sep_cnt,slp_cnt,inj_aplcnt_cnt', CQL_FILTER: clauses.join(' AND ') });
  return { query, center, body };
}

export function parseSpatialResult(data, input) {
  const { query, center } = spatialRequest(input);
  if (!Array.isArray(data?.features) || !Number.isSafeInteger(data.totalFeatures) || data.totalFeatures < 0 || data.totalFeatures >= LIMIT || data.features.length !== data.totalFeatures) throw new Error('TAAS 공간분석 응답이 누락되었거나 수집 한도를 초과했습니다.');
  const seen = new Set(), records = [], counts = { accidents: data.features.length, casualties: 0, deaths: 0, serious: 0, minor: 0, reported: 0 };
  const crs = data.crs?.properties?.name || '';
  if (data.features.length && !/5179$/.test(crs)) throw new Error('TAAS 공간분석 좌표계가 일치하지 않습니다.');
  for (const feature of data.features) {
    const p = feature.properties, xy = feature.geometry?.coordinates;
    if (!p || typeof p.acdnt_no !== 'string' || !p.acdnt_no.trim() || seen.has(p.acdnt_no)) throw new Error('TAAS 공간분석 사고 식별자 누락 또는 중복');
    seen.add(p.acdnt_no);
    if (String(p.acdnt_year) !== String(query.year) || !['01', '02', '03', '04'].includes(p.acdnt_gae_code)) throw new Error('TAAS 공간분석 연도·심각도 조건 불일치');
    if (COLLISION_TYPES[query.type] && p.acdnt_hdc !== COLLISION_TYPES[query.type]) throw new Error('TAAS 공간분석 사고유형 조건 불일치');
    if ((query.type === 'pedestrian' && p.acc_cls_08yn !== '1') || (query.type === 'bicycle' && p.acc_cls_49yn !== '1')) throw new Error('TAAS 공간분석 사고부문 조건 불일치');
    if (feature.geometry?.type !== 'Point' || !Array.isArray(xy) || xy.length < 2 || !xy.slice(0, 2).every(Number.isFinite)) throw new Error('TAAS 공간분석 사고 좌표 누락');
    const metricPoint = proj4(UTM, TM, xy.slice(0, 2));
    if (Math.hypot(metricPoint[0] - center[0], metricPoint[1] - center[1]) > query.radius + .1) throw new Error('TAAS 공간분석 반경 밖 사고 응답');
    if (!/^\d{3}$/.test(p.acdnt_code) || typeof p.acdnt_dc !== 'string') throw new Error('TAAS 공간분석 세부유형 누락');
    for (const [key, field] of Object.entries(fields)) {
      const value = p[field];
      if (value === null || value === undefined || String(value).trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('TAAS 공간분석 인명피해 값 누락');
      counts[key] += Number(value);
      if (!Number.isSafeInteger(counts[key])) throw new Error('TAAS 공간분석 집계 범위 초과');
    }
    records.push({ ...p, x: xy[0], y: xy[1] });
  }
  counts.casualties = counts.deaths + counts.serious + counts.minor + counts.reported;
  return { counts, records };
}

export async function surveyTaasSpatial(input, { fetchImpl = fetch } = {}) {
  const { query, body } = spatialRequest(input), key = JSON.stringify(query);
  const saved = cache.get(key);
  if (fetchImpl === fetch && saved?.expires > Date.now()) return { ...saved.result, cached: true };
  let response, text;
  try {
    response = await fetchImpl(WFS_URL, { method: 'POST', body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('HTTP failure');
    text = await response.text();
  } catch { throw new Error('TAAS 공간분석 서버 조회에 실패했습니다. 실패를 0건으로 처리하지 않습니다.'); }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('TAAS 공간분석 응답 형식 오류'); }
  const { counts, records } = parseSpatialResult(data, query);
  const sourceHash = createHash('sha256').update(text).digest('hex');
  const result = { query, counts, collectionMethod: SPATIAL_COLLECTION_METHOD, spatialRecords: records, selectedCollisionCodes: [...new Set(records.map(row => row.acdnt_code))].sort(), source: '한국도로교통공단 TAAS 공간분석 WFS (개별 사고 집계)', sourceUrl: TAAS_URL, retrievedAt: new Date().toISOString(), coordinateSystem: 'EPSG:5179', sourceHash, evidence: JSON.stringify({ source: WFS_URL, year: query.year, radius: query.radius, matched: data.totalFeatures, uniqueRecords: records.length, sourceHash, aggregation: '사고 원자료 건수 및 인명피해 합계; casualties는 사망 포함 계산값', counts }), cached: false };
  const quality = surveyQuality(result);
  Object.assign(result, { qualityWarnings: quality.warnings, qualityNotes: quality.notes, calculatedInjuries: quality.injuries, calculatedCasualties: quality.total });
  if (fetchImpl === fetch) {
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(key, { result, expires: Date.now() + 3600000 });
  }
  return result;
}
