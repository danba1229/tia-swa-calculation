import test from 'node:test';
import assert from 'node:assert/strict';
import proj4 from 'proj4';
import { buildSignDxf, groupSigns, projectSign, signKind, SIGN_DXF_CRS, SAME_SPOT_METERS } from '../lib/signDxf.js';

// Minimal DXF reader: group-code/value pairs → entities of the ENTITIES section.
function entities(dxf) {
  const lines = dxf.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const start = pairs.findIndex(([c, v], i) => c === '2' && v === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  const list = [];
  for (const [code, value] of pairs.slice(start + 1)) {
    if (code === '0' && value === 'ENDSEC') break;
    if (code === '0') list.push({ type: value, x: [], y: [], codes: {} });
    else if (list.length) {
      const e = list.at(-1);
      if (code === '8') e.layer = value; else if (code === '1') e.text = value;
      else if (code === '10') e.x.push(Number(value)); else if (code === '20') e.y.push(Number(value));
      else e.codes[code] = value;
    }
  }
  return list;
}

const cityHall = { lat: 37.566370776634, lng: 126.977918351844 };
const scope = { north: 37.5679, south: 37.5649, east: 126.9799, west: 126.9759 };
// Two plates on one pole (≈0.1m apart), one more sign nearby, a road sign and an unmatched sign.
const signs = [
  { id: 'S:1', source: 'S', lat: 37.5665000, lng: 126.9780000, label: '224, 427', managementId: '04-001', policeCodes: ['224', '427'], sourceIndex: '224', specification: '002', installedOn: '2020-01-01' },
  { id: 'S:2', source: 'S', lat: 37.5665008, lng: 126.9780006, label: '135', managementId: '04-002', policeCodes: ['135'], sourceIndex: '135' },
  { id: 'S:3', source: 'S', lat: 37.5666000, lng: 126.9781000, label: '322', managementId: '04-003', policeCodes: ['322'], sourceIndex: '322' },
  { id: 'R:1', source: 'R', lat: 37.5668000, lng: 126.9783000, label: '?', managementId: 'WR(서울특별시 중구)-[세종대로]-상-1', policeCodes: [], sourceIndex: '단일노선표지' },
  { id: 'S:4', source: 'S', lat: 37.5667000, lng: 126.9786000, label: '일방', managementId: '04-004', policeCodes: [], sourceIndex: '999' },
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

test('signs on one pole become one spot listing every chart number once, in order', () => {
  assert.deepEqual(signs.map(s => signKind(s, 'police')), ['일람표', '일람표', '일람표', '도로표지', '미확인']);
  const groups = groupSigns(signs, 'police', '5186');
  assert.equal(groups.length, 4);
  assert.deepEqual(groups[0].labels, ['135', '224', '427']);
  assert.equal(groups[0].signs.length, 2);
  assert.deepEqual(groups.slice(1).map(g => g.labels), [['322'], ['도로표지'], ['일방']]);
  assert.ok(SAME_SPOT_METERS <= 1);
});

test('each spot is a black dot, a leader and a white box with a black border around its numbers', () => {
  const { dxf, csv, counts, spots, overlapping } = buildSignDxf({ points: signs, scope, site: cityHall, crs: '5186', mode: 'police', address: '서울특별시 중구 세종대로 110', generatedAt: new Date('2026-10-25T00:00:00Z') });
  assert.match(dxf, /\$ACADVER\s*\r?\n\s*1\s*\r?\nAC1021/);
  const styleAt = dxf.indexOf('Standard');
  assert.ok(styleAt >= 0 && dxf.slice(styleAt, styleAt + 400).includes('malgun.ttf'), 'Hangul TrueType font');
  assert.equal(spots, 4); assert.equal(overlapping, 0);
  assert.deepEqual(counts, { 표지판: 2, 도로표지: 1, 표지판_번호미확인: 1 });
  const list = entities(dxf);
  const on = layer => list.filter(e => e.layer === layer);

  const dots = on('표지판_점');
  assert.equal(dots.length, 2);
  // Filled dot: solid hatch with two half-circle vertices (after the hatch's 0,0 elevation point).
  const centre = e => ({ x: (e.x.at(-1) + e.x.at(-2)) / 2, y: e.y.at(-1) });
  assert.equal(dots[0].type, 'HATCH'); assert.equal(dots[0].codes['2'], 'SOLID'); assert.equal(dots[0].codes['420'], '0', 'black');
  const pole = projectSign(signs[0].lat, signs[0].lng, '5186');
  assert.ok(Math.abs(centre(dots[0]).x - pole.x) < 0.01 && Math.abs(centre(dots[0]).y - pole.y) < 0.01, 'dot at the installation point');

  const leaders = on('표지판_인출선');
  assert.equal(leaders.length, 2); assert.ok(leaders.every(e => e.type === 'LINE' && e.codes['420'] === '0'));
  assert.ok(Math.abs(leaders[0].x[0] - pole.x) < 0.01 && Math.abs(leaders[0].y[0] - pole.y) < 0.01, 'leader starts at the dot');

  const box = on('표지판_박스');
  const fill = box.find(e => e.type === 'HATCH'), border = box.find(e => e.type === 'LWPOLYLINE');
  assert.equal(fill.codes['62'], '255', 'white fill'); assert.equal(fill.codes['2'], 'SOLID');
  assert.equal(border.codes['420'], '0', 'black border');
  // LINE stores its end point in group codes 11/21.
  const [lx, ly] = [Number(leaders[0].codes['11']), Number(leaders[0].codes['21'])];
  const [bx1, bx2, by1, by2] = [Math.min(...border.x), Math.max(...border.x), Math.min(...border.y), Math.max(...border.y)];
  assert.ok(lx >= bx1 - 0.01 && lx <= bx2 + 0.01 && ly >= by1 - 0.01 && ly <= by2 + 0.01 && (Math.abs(lx - bx1) < 0.01 || Math.abs(lx - bx2) < 0.01 || Math.abs(ly - by1) < 0.01 || Math.abs(ly - by2) < 0.01), 'leader ends on the box edge');
  assert.ok(list.indexOf(fill) > list.indexOf(leaders[1]), 'white boxes drawn after leaders so they cover crossings');

  const numbers = on('표지판_번호');
  assert.deepEqual(numbers.map(e => e.text), ['135 224 427', '322']);
  assert.ok(numbers.every(e => e.codes['420'] === '0' && e.codes['72'] === '1' && e.codes['73'] === '2'), 'black, centred');
  assert.ok(numbers[0].x[0] > bx1 && numbers[0].x[0] < bx2, 'number inside its box');
  assert.equal(on('도로표지_번호')[0].text, '도로표지');
  const roadBox = on('도로표지_박스').find(e => e.type === 'LWPOLYLINE');
  assert.ok(Math.max(...roadBox.x) - Math.min(...roadBox.x) >= 4 * 1.0, 'box wide enough for four Hangul characters');
  assert.equal(on('표지판_번호미확인_번호')[0].text, '일방');
  assert.ok(on('도면정보').some(e => /EPSG:5186/.test(e.text)));
  assert.ok(on('도면정보').some(e => /설치지점 4곳/.test(e.text)));
  assert.equal(on('조사범위').length, 1);

  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^번호,설치지점,레이어,박스표시,/);
  assert.match(lines[1], /^1,1,표지판_번호,135 224 427,04-001,안전표지,224,224 427,002,2020-01-01,/);
  assert.match(lines[2], /^2,1,표지판_번호,135 224 427,04-002,/);
});

test('the 5174 export places the dot in Bessel coordinates and labels the CRS', () => {
  const { dxf } = buildSignDxf({ points: signs.slice(2, 3), scope, site: cityHall, crs: '5174' });
  const dot = entities(dxf).find(e => e.layer === '표지판_점');
  const expected = projectSign(signs[2].lat, signs[2].lng, '5174');
  assert.ok(Math.abs((dot.x.at(-1) + dot.x.at(-2)) / 2 - expected.x) < 0.01 && Math.abs(dot.y.at(-1) - expected.y) < 0.01);
  assert.ok(dxf.includes(SIGN_DXF_CRS[5174].label));
});

test('dense spots get boxes that do not overlap each other', () => {
  const grid = Array.from({ length: 60 }, (_, i) => ({ id: `S:${i}`, source: 'S', lat: 37.5660 + Math.floor(i / 10) * 0.00003, lng: 126.9780 + (i % 10) * 0.00004, label: '224', policeCodes: ['224'] }));
  const { overlapping, spots } = buildSignDxf({ points: grid, scope, site: cityHall, crs: '5186' });
  assert.equal(spots, 60);
  assert.equal(overlapping, 0);
});
