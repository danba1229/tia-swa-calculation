import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { facilityScope, selectFacilityRows, busFacilityPoints, numberFacilityPoints, facilityCoverage, facilityCsv } from '../lib/trafficFacilities.js';
const input={lat:37.4836248649455,lng:127.032683002019,width:1000,height:1000,region:'seoul'};
const scope=facilityScope(input);
const bytes=readFileSync(new URL('../data/facilities/facilities.json.gz',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../data/facilities/manifest.json',import.meta.url)));
const rows=JSON.parse(gunzipSync(bytes));
test('facility survey validates resolved region, finite coordinates and full rectangle dimensions',()=>{
  for(const change of [{lat:''},{lat:NaN},{region:'busan'},{width:0},{height:10001},{lng:0}])assert.throws(()=>facilityScope({...input,...change}));
  assert.ok(Math.abs((scope.north-scope.south)*111320-1000)<.001);
  assert.ok(facilityScope({...input,region:'gyeonggi',lat:37.263,lng:127.028}));
});
test('packaged official snapshot is complete relative to its manifest and contains unique valid IDs',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.equal(rows.length,manifest.count);assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
  assert.ok(rows.every(r=>r[2]>=36.8&&r[2]<=38.4&&r[3]>=126.2&&r[3]<=128&&manifest.sources[r[7]]));
  for(const [id,s] of Object.entries(manifest.sources))assert.equal(rows.filter(r=>r[7]===id).length,s.count);
});
test('Seocho and Suwon snapshots select only in-scope points and preserve unknown intersection classifications',()=>{
  for(const s of [scope,facilityScope({...input,region:'gyeonggi',lat:37.263,lng:127.028,width:1600,height:1600})]){
    const result=selectFacilityRows(rows,s);assert.ok(result.some(p=>p.kind==='crosswalk'));
    assert.ok(result.every(p=>p.lat>=s.south&&p.lat<=s.north&&p.lng>=s.west&&p.lng<=s.east));
  }
  assert.equal(rows.filter(r=>r[1]==='unsignal_intersection').length,0);
  assert.ok(rows.some(r=>r[1]==='unknown_intersection'));
  assert.ok(rows.filter(r=>r[1]==='signal_intersection').every(r=>r[9].includes('과거 차량신호 제어기 연결')));
});
test('official physical and painted hump codes cannot be mixed',()=>{
  for(const row of rows.filter(r=>r[7]==='seoul-humps'))assert.ok(row[1]==='speed_hump'?row[9].endsWith('001'):row[1]==='image_hump'&&row[9].endsWith('002'));
  assert.equal(manifest.counts.speed_hump,6791);assert.equal(manifest.counts.image_hump,10937);
  assert.equal(manifest.excluded['hump:geometry'],656);
});
test('missing source coverage is not a zero-facility claim and geocoded facilities remain approximate',()=>{
  assert.equal(facilityCoverage('seoul').find(c=>c.key==='unsignal_intersection').status,'unavailable');
  assert.equal(facilityCoverage('gyeonggi','failed').find(c=>c.key==='bus_stop').status,'failed');
  assert.ok(rows.filter(r=>['footbridge','roundabout'].includes(r[1])).every(r=>r[10]==='주소 변환 근사위치'));
  assert.ok(rows.filter(r=>r[7]==='yangpyeong-round').every(r=>r[8]===''), 'Publication date must not become a field reference date');
});
test('bus map records are scoped and deduplicated, numbering is stable independent of input order',()=>{
  const bus=busFacilityPoints({busStops:[{id:'1',stationName:'테스트',latitude:scope.lat,longitude:scope.lng,routes:[]},{id:'2',latitude:35,longitude:127}]},scope);
  assert.equal(bus.length,1);assert.ok(bus[0].remark.includes('수동확인필요'));
  const p=selectFacilityRows(rows,scope);const numbered=numberFacilityPoints([...p,...bus,...bus],scope);
  assert.equal(numbered.length,p.length+1);
  assert.deepEqual(numberFacilityPoints([...p,...bus].reverse(),scope),numbered);
  assert.ok(numbered.every(p=>p.roadviewUrl.startsWith('https://map.kakao.com/link/roadview/')));
  assert.throws(()=>numberFacilityPoints(p,scope,1));
});
test('CSV preserves provenance and neutralizes formula cells',()=>{
  const p=numberFacilityPoints([{id:'x',kind:'crosswalk',lat:scope.lat,lng:scope.lng,name:'=1+1',sourceId:'s',positionBasis:'공식 좌표'}],scope);
  const text=facilityCsv(p,{s:{url:'https://www.data.go.kr/',fileVersion:'2026'}});
  assert.ok(text.includes("'=1+1"));assert.ok(text.includes('추가확인필요'));assert.ok(text.includes('https://www.data.go.kr/'));
  assert.equal(text.split('\r\n').length,2);
});
