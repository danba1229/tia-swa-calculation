import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { validateAccidentQuery, parseRadiusResult, decodeKoroadKey, radiusQualityWarnings, radiusQuality, collisionFilterValues } from '../lib/accidentSurvey.js';
import { findStatisticsRegion, getKoroadRows } from '../lib/koroad.js';
const query = { lat: 37.5, lng: 127, radius: 500, year: 2025, type: 'all' };
test('distinguish TAAS injury-only label from genuine mismatch without changing source values', () => {
  const counts = { casualties: 158, deaths: 2, serious: 31, minor: 116, reported: 11 };
  const result = radiusQuality(counts);
  assert.deepEqual(result.warnings, []);
  assert.match(result.notes[0], /부상자 합계/);
  assert.equal(result.injuries, 158);
  assert.equal(result.total, 160);
  assert.equal(counts.casualties, 158);
  assert.equal(radiusQuality({ ...counts, casualties: 160 }).notes.length, 0);
  assert.equal(radiusQuality({ ...counts, casualties: 159 }).warnings.length, 1);
  assert.equal(radiusQuality({ ...counts, deaths: 0 }).notes.length, 0);
  assert.equal(radiusQuality({ ...counts, minor: null }).total, null);
});
test('collision selection uses active labels and rejects missing or malformed categories', () => {
  const options = [{ title: '차대차', value: '210' }, { title: '차대차', value: '235' }, { title: '차대사람', value: '110' }];
  assert.deepEqual(collisionFilterValues(options, 'vehicleVehicle'), ['210', '235']);
  assert.deepEqual(collisionFilterValues(options, 'vehiclePerson'), ['110']);
  assert.throws(() => collisionFilterValues(options, 'railway'), /변경/);
  assert.throws(() => collisionFilterValues([...options, options[0]], 'vehicleVehicle'), /중복/);
  assert.throws(() => collisionFilterValues([{ title: '차대차', value: 'bad' }], 'vehicleVehicle'));
  assert.equal(validateAccidentQuery({ ...query, type: 'singleVehicle' }).type, 'singleVehicle');
});
test('reject missing coordinates, unsupported type, excessive radius and noninteger year', () => {
  assert.deepEqual(validateAccidentQuery(query), query);
  for (const change of [{ lat: '' }, { lng: null }, { year: 2025.5 }, { radius: 2001 }, { type: 'intersection' }, { lat: 0 }]) assert.throws(() => validateAccidentQuery({ ...query, ...change }));
});
test('parse verified zero and positive counts; reject missing, stale and inconsistent responses', () => {
  const text = '장소 : TIA_test 입력좌표 : 202444.56 , 444275.49 사고건수 : 79, 사상자수 : 84 사망자수 : 0, 중상자수 : 16 경상자수 : 61, 부상신고자수 : 7';
  const xy = [202444.56, 444275.49];
  assert.equal(parseRadiusResult(text, 'TIA_test', xy).accidents, 79);
  assert.equal(parseRadiusResult(text.replace(/79|84|16|61|7(?=$)/g, '0'), 'TIA_test', xy).accidents, 0);
  assert.throws(() => parseRadiusResult(text, 'other', xy));
  assert.throws(() => parseRadiusResult(text, 'TIA_test', [1, 2]));
  const discrepant = parseRadiusResult(text.replace('84', '85'), 'TIA_test', xy);
  assert.equal(discrepant.casualties, 85);
  assert.equal(radiusQualityWarnings(discrepant).length, 1);
  assert.equal(radiusQualityWarnings(parseRadiusResult(text, 'TIA_test', xy)).length, 0);
  assert.throws(() => parseRadiusResult(text.replace('중상자수 : 16', ''), 'TIA_test', xy));
});
test('official Gangnam EPSG:5181 sample round trips to WGS84 without swapping axes', () => {
  const def = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs';
  const ll = proj4(def, 'EPSG:4326', [202444.56, 444275.49]);
  assert.ok(ll[0] > 127.02 && ll[0] < 127.04 && ll[1] > 37.49 && ll[1] < 37.51);
  assert.ok(Math.abs(proj4('EPSG:4326', def, ll)[0] - 202444.56) < .001);
});
test('statistics codes use official mapping, including city aggregate and renamed provinces', () => {
  assert.equal(findStatisticsRegion({ region_1depth_name: '서울특별시', region_2depth_name: '노원구' }).guGun, '1122');
  assert.equal(findStatisticsRegion({ region_1depth_name: '경기도', region_2depth_name: '수원시 영통구' }).guGun, '1302');
  assert.equal(findStatisticsRegion({ region_1depth_name: '제주특별자치도', region_2depth_name: '제주시' }).siDo, '2100');
  assert.throws(() => findStatisticsRegion({ region_1depth_name: '서울특별시', region_2depth_name: '없는구' }));
});
test('key decoded exactly once; URLSearchParams preserves literal plus', async () => {
  assert.equal(decodeKoroadKey('abc%2B%2F%3D'), 'abc+/=');
  assert.equal(decodeKoroadKey('abc+/='), 'abc+/=');
  await getKoroadRows('stt', {}, { key: 'abc%2B%2F%3D', fetchImpl: async url => { assert.equal(url.searchParams.get('authKey'), 'abc+/='); return { ok: true, json: async () => ({ resultCode: '00', totalCount: 1, items: { item: [{ acc_cnt: '0' }] } }) }; } });
});
test('authentication errors and incomplete pages never become zero', async () => {
  const response = data => async () => ({ ok: true, json: async () => data });
  await assert.rejects(getKoroadRows('stt', {}, { key: 'x', fetchImpl: response({ resultCode: '30' }) }), /30/);
  await assert.rejects(getKoroadRows('stt', {}, { key: 'x', fetchImpl: response({ resultCode: '00', totalCount: 2, items: { item: [] } }) }), /누락/);
  const empty = await getKoroadRows('stt', {}, { key: 'x', fetchImpl: response({ resultCode: '03' }) });
  assert.equal(empty.status, 'no_data');
});
