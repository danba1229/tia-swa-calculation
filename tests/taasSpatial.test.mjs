import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { spatialRequest, parseSpatialResult, surveyTaasSpatial } from '../lib/taasSpatial.js';

const query = { lat: 37.483625, lng: 127.032683, year: 2025, radius: 1000, type: 'all' };
const utm = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';
const point = proj4('EPSG:4326', utm, [query.lng, query.lat]);
const fixture = () => ({ totalFeatures: 1, crs: { properties: { name: 'urn:ogc:def:crs:EPSG::5179' } }, features: [{ geometry: { type: 'Point', coordinates: point }, properties: { acdnt_no: 'test-1', acdnt_year: '2025', acdnt_hdc: '차량단독', acdnt_code: '341', acdnt_dc: '전도', acdnt_gae_code: '02', acc_cls_08yn: '0', acc_cls_49yn: '1', dprs_cnt: 0, sep_cnt: 1, slp_cnt: 0, inj_aplcnt_cnt: 0 } }] });
test('spatial request uses official year, severity and distinct vulnerable road user flags', () => {
  assert.match(spatialRequest(query).body.get('CQL_FILTER'), /acdnt_year='2025'/);
  assert.match(spatialRequest({ ...query, type: 'pedestrian' }).body.get('CQL_FILTER'), /acc_cls_08yn='1'/);
  assert.match(spatialRequest({ ...query, type: 'bicycle' }).body.get('CQL_FILTER'), /acc_cls_49yn='1'/);
  assert.match(spatialRequest({ ...query, type: 'singleVehicle' }).body.get('CQL_FILTER'), /acdnt_hdc='차량단독'/);
  assert.throws(() => spatialRequest({ ...query, radius: 1001 }));
  assert.throws(() => spatialRequest({ ...query, year: "2025' OR 1=1" }));
});
test('spatial rows preserve code 341 and compute casualty total, not TAAS label', () => {
  const { counts, records } = parseSpatialResult(fixture(), query);
  assert.equal(counts.accidents, 1); assert.equal(counts.serious, 1); assert.equal(counts.casualties, 1);
  assert.equal(records[0].acdnt_code, '341');
  assert.equal(parseSpatialResult({ totalFeatures: 0, features: [] }, query).counts.accidents, 0);
});
test('spatial result rejects truncation, duplicates, missing values and wrong conditions', () => {
  const changes = [
    data => data.totalFeatures = 2,
    data => { data.features.push(data.features[0]); data.totalFeatures = 2; },
    data => data.features[0].properties.sep_cnt = null,
    data => data.features[0].properties.acdnt_year = '2024',
    data => data.features[0].properties.acdnt_gae_code = '00',
    data => data.features[0].geometry.coordinates = [point[0] + 3000, point[1]],
    data => data.crs.properties.name = 'EPSG:4326',
    data => data.features[0].properties.acdnt_no = '',
  ];
  for (const change of changes) { const data = fixture(); change(data); assert.throws(() => parseSpatialResult(data, query)); }
  assert.throws(() => parseSpatialResult(fixture(), { ...query, type: 'pedestrian' }));
  assert.throws(() => parseSpatialResult(fixture(), { ...query, type: 'vehicleVehicle' }));
});
test('spatial fetch preserves provenance and never treats an error as zero', async () => {
  const result = await surveyTaasSpatial(query, { fetchImpl: async (url, options) => {
    assert.equal(new URL(url).host, 'taas.koroad.or.kr'); assert.equal(options.redirect, 'error');
    return { ok: true, text: async () => JSON.stringify(fixture()) };
  } });
  assert.equal(result.collectionMethod, 'spatial-records-v1');
  assert.equal(result.sourceHash.length, 64);
  assert.match(result.qualityNotes[0], /계산값/);
  await assert.rejects(surveyTaasSpatial(query, { fetchImpl: async () => ({ ok: false }) }), /실패/);
  await assert.rejects(surveyTaasSpatial(query, { fetchImpl: async () => ({ ok: true, text: async () => '<xml>error</xml>' }) }), /형식/);
});
