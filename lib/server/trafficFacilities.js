import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { facilityScope, selectFacilityRows, busFacilityPoints, numberFacilityPoints, facilityCoverage } from '../trafficFacilities.js';
import { getBusSnapshot } from '../seoulBusStore.js';
import { searchSeoulBusSnapshot } from '../seoulBusSnapshot.js';
import { searchGyeonggiBus } from '../gyeonggiBus.js';
let pending;
export async function loadFacilitySnapshot() {
  if (!pending) pending = (async () => {
    const dir = path.join(process.cwd(),'data','facilities');
    const [bytes, text] = await Promise.all([readFile(path.join(dir,'facilities.json.gz')),readFile(path.join(dir,'manifest.json'),'utf8')]);
    const manifest = JSON.parse(text);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('시설물 파일 무결성 오류');
    return { rows:JSON.parse(gunzipSync(bytes)), manifest };
  })().catch(e=>{pending=undefined;throw e;});
  return pending;
}
export async function queryTrafficFacilities(input) {
  const scope = facilityScope(input), { rows, manifest } = await loadFacilitySnapshot();
  const sources = { ...manifest.sources };
  const busScope = { center:{lat:scope.lat,lng:scope.lng}, bounds:{north:scope.north,south:scope.south,east:scope.east,west:scope.west}, width:scope.width,height:scope.height };
  let busPoints = [], busState = 'available', busError = '';
  try {
    const result = scope.region === 'seoul'
      ? searchSeoulBusSnapshot(busScope,(await getBusSnapshot()).snapshot)
      : await searchGyeonggiBus(busScope);
    busPoints = busFacilityPoints(result,scope);
    sources.bus = { name:result.source,url:result.sourceUrl,fileVersion:result.sourceDate || result.baseVersion || '조회 응답 참조',note:'기존 STEP 5 공식 정류장 자료',checkedAt:new Date().toISOString() };
  } catch { busState='failed';busError='버스정류장 자료 조회 실패. 다시 조회해 주세요.'; }
  return { scope, points:numberFacilityPoints([...selectFacilityRows(rows,scope),...busPoints],scope), sources,
    coverage:facilityCoverage(scope.region,busState), busError, checkedAt:new Date().toISOString(),
    snapshotVersion:manifest.builtAt, gyeonggiCrosswalkDistricts:manifest.gyeonggiCrosswalkDistricts };
}
