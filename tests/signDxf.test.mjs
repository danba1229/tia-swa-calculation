import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { buildSignDxf, projectSign, signLayerKey, SIGN_DXF_CRS } from '../lib/signDxf.js';

// Minimal DXF reader: group-code/value pairs → entities of the ENTITIES section.
function entities(dxf) {
  const lines = dxf.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const start = pairs.findIndex(([c, v], i) => c === '2' && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  const list = [];
  for (const [code, value] of pairs.slice(start + 1)) {
    if (code === '0' && value === 'ENDSEC') break;
    if (code === '0') list.push({ type: value, x: [], y: [] });
    else if (list.length) {
      const e = list.at(-1);
      if (code === '8') e.layer = value; else if (code === '1') e.text = value;
      else if (code === '10') e.x.push(Number(value)); else if (code === '20') e.y.push(Number(value));
    }
  }
  return list;
}

const cityHall = { lat: 37.566370776634, lng: 126.977918351844 };
const scope = { north: 37.5679, south: 37.5649, east: 126.9799, west: 126.9759 };
const signs = [
  { id: 'S:1', source: 'S', lat: 37.5665, lng: 126.9780, label: '224', managementId: '04-001', policeCodes: ['224'], sourceIndex: '224', specification: '002', installedOn: '2020-01-01' },
  { id: 'S:2', source: 'S', lat: 37.5666, lng: 126.9781, label: '135', managementId: '04-002', policeCodes: ['135'], sourceIndex: '135' },
  { id: 'S:3', source: 'S', lat: 37.5667, lng: 126.9782, label: '일방', managementId: '04-003', policeCodes: [], sourceIndex: '999' },
  { id: 'R:1', source: 'R', lat: 37.5668, lng: 126.9783, label: '?', managementId: 'WR(서울특별시 중구)-[세종대로]-상-1', policeCodes: [], sourceIndex: '단일노선표지' },
];

test('EPSG:5186 matches the 5181 transform already accepted by TAAS, shifted 100,000m north', () => {
  const p5181 = proj4('EPSG:4326', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs', [cityHall.lng, cityHall.lat]);
  const p = projectSign(cityHall.lat, cityHall.lng, '5186');
  assert.ok(Math.abs(p.x - p5181[0]) < 0.001 && Math.abs(p.y - (p5181[1] + 100000)) < 0.001);
  assert.ok(Math.abs(p.x - 198049) < 2 && Math.abs(p.y - 551871) < 2, JSON.stringify(p));
});

test('EPSG:5174 lands within the known Bessel-GRS80 shift of 5186', () => {
  const a = projectSign(cityHall.lat, cityHall.lng, '5186'), b = projectSign(cityHall.lat, cityHall.lng, '5174');
  const shift = Math.hypot(b.x - a.x, (b.y + 100000) - a.y);
  assert.ok(shift > 200 && shift < 450, `shift ${shift}`);
  assert.throws(() => projectSign(37.5, 127, '4326'), /지원하지 않는 좌표계/);
});

test('signs go to layers by police chart group, road signs and unmatched codes separately', () => {
  assert.deepEqual(signs.map(s => signLayerKey(s, 'police')), ['규제', '주의', '미확인', '도로표지']);
  assert.equal(signLayerKey(signs[0], 'seoul'), '서울시코드');
});

test('DXF holds every sign with symbol, point and label in the chosen coordinates', () => {
  const { dxf, csv, counts } = buildSignDxf({ points: signs, scope, site: cityHall, crs: '5186', mode: 'police', address: '서울특별시 중구 세종대로 110', generatedAt: new Date('2026-10-25T00:00:00Z') });
  assert.match(dxf, /\$ACADVER\s*\r?\n\s*1\s*\r?\nAC1021/, 'DXF 2007 stores Korean text as UTF-8');
  const styleAt = dxf.indexOf('Standard');
  assert.ok(styleAt >= 0 && dxf.slice(styleAt, styleAt + 400).includes('malgun.ttf'), 'the Standard text style uses a Hangul TrueType font');
  const list = entities(dxf);
  const points = list.filter(e => e.type === 'POINT');
  assert.equal(points.length, 4);
  const expected = projectSign(signs[0].lat, signs[0].lng, '5186');
  const first = points.find(e => e.layer === '표지판_규제');
  assert.ok(Math.abs(first.x[0] - expected.x) < 0.01 && Math.abs(first.y[0] - expected.y) < 0.01);
  const texts = list.filter(e => e.type === 'TEXT');
  for (const label of ['224', '135', '일방', 'WR(서울특별시 중구)-[세종대로]-상-1', '사업지']) assert.ok(texts.some(t => t.text === label), label);
  assert.ok(texts.some(t => t.layer === '도면정보' && /EPSG:5186/.test(t.text)));
  assert.ok(list.some(e => e.layer === '조사범위' && e.type === 'LWPOLYLINE'));
  assert.deepEqual(counts, { 표지판_규제: 1, 표지판_주의: 1, 표지판_번호미확인: 1, 도로표지: 1 });
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /X_EPSG5186,Y_EPSG5186$/);
  assert.match(lines[1], /^1,표지판_규제,224,04-001,안전표지,224,224,002,2020-01-01,/);
  assert.ok(lines[1].endsWith(`,${expected.x},${expected.y}`));
});

test('the 5174 export uses Bessel coordinates and labels the CRS', () => {
  const { dxf } = buildSignDxf({ points: signs.slice(0, 1), scope, site: cityHall, crs: '5174' });
  const point = entities(dxf).find(e => e.type === 'POINT');
  const expected = projectSign(signs[0].lat, signs[0].lng, '5174');
  assert.ok(Math.abs(point.x[0] - expected.x) < 0.01 && Math.abs(point.y[0] - expected.y) < 0.01);
  assert.match(dxf, new RegExp(SIGN_DXF_CRS[5174].label.slice(0, 9)));
});
