import test from 'node:test';
import assert from 'node:assert/strict';
import { signScope, selectSigns, layoutSignLabels } from '../lib/trafficSigns.js';
import { loadSignSnapshot, querySeoulSigns } from '../lib/server/seoulSigns.js';
import { classifySign, signRoadviewUrl, visibleSigns } from '../lib/signClassification.js';
import { POLICE_SIGN_CODES } from '../lib/policeSignCodes.js';
import { SEOUL_SIGN_CODE_MAPPINGS } from '../lib/seoulSignCodeMappings.js';

test('sixteen user-approved codes map regardless of remarks while retaining original records', () => {
  const expected = {
    '205-2': '205의2', '206-2': '206의2', '309-2': '309의2', '320-2': '320의2',
    '320-3': '320의3', '320-4': '320의4', '321-2': '321의2', '415-2': '415의2',
    '220-1': '224', '220-2': '224', '220-3': '224', '220-4': '224',
    '220-5': '224', '220-6': '224', '220-7': '224', '220-8': '224',
  };
  assert.deepEqual(SEOUL_SIGN_CODE_MAPPINGS, expected);
  for (const [code, target] of Object.entries(expected)) {
    for (const remark of ['', '30', '40', '직진및유턴', '보행자주의', '소방차 출동시']) {
      const point = { id: 'S:one', source: 'S', label: 'one', sourceIndex: code, lat: 37.48, lng: 127.03, remark };
      const original = structuredClone(point);
      const result = classifySign(point);
      assert.equal(result.label, target);
      assert.equal(result.policeCode, target);
      assert.ok(POLICE_SIGN_CODES.includes(target));
      assert.equal(result.mappingBasis, 'user');
      assert.match(result.reason, /사용자 지정 매핑.*추가 확인/);
      assert.equal(result.sourceIndex, code);
      assert.ok(result.sourceCodeRemark.endsWith(code));
      assert.equal(result.managementId, 'one');
      assert.equal(result.color, '#2563eb');
      assert.equal(result.roadviewUrl, 'https://map.kakao.com/link/roadview/37.48,127.03');
      assert.deepEqual(point, original);
      assert.equal(classifySign({ ...point, source: 'R' }).policeCode, null);
    }
  }
});

test('fixed-code mapping covers 10213 records alongside the approved 514 families', async () => {
  const { rows } = await loadSignSnapshot();
  let mapped = 0, speedMapped = 0;
  for (const [id, lat, lng, sourceIndex] of rows) {
    const source = id.slice(0, 1);
    const result = classifySign({ id, source, label: id.slice(2), lat, lng, sourceIndex });
    if (Object.hasOwn(SEOUL_SIGN_CODE_MAPPINGS, sourceIndex) && source === 'S') {
      mapped++;
      if (result.policeCode === '224') speedMapped++;
    }
    else if (source === 'S' && sourceIndex.startsWith('514')) assert.ok(['417', '418', '419'].includes(result.policeCode));
    else assert.equal(result.policeCode, source === 'S' && POLICE_SIGN_CODES.includes(sourceIndex) ? sourceIndex : null);
  }
  assert.equal(mapped, 10213);
  assert.equal(speedMapped, 9860);
});

test('514 families prioritize subtype over distance and reject malformed or unrelated suffixes', () => {
  for (const [sourceIndex, expected] of [['514', '417'], ['514-100', '417'], ['514-200', '417'], ['514-400', '417'],
    ['514-1', '418'], ['514-1-50', '418'], ['514-1-200', '418'], ['514-1-600', '418'],
    ['514-2', '419'], ['514-2-100', '419'], ['514-2-400', '419']]) {
    for (const sourceRemark of ['', '2000m', '구간끝 190m', '보수요망']) {
      const point = { id: 'S:one', source: 'S', label: 'one', lat: 37.5, lng: 127, sourceIndex, sourceRemark };
      const result = classifySign(point);
      assert.equal(result.label, expected);
      assert.equal(result.sourceIndex, sourceIndex);
      assert.equal(result.sourceRemark, sourceRemark);
      assert.equal(result.mappingBasis, 'user');
      assert.match(result.reason, /원본 비고와 관계없이/);
      assert.equal(result.ignored, false);
      assert.equal(classifySign({ ...point, source: 'R' }).label, '?');
    }
  }
  for (const sourceIndex of ['514-Z', '514-1-Z', '514-2-100-extra', '514-100-200', '1514-100', '521', '538', '563']) {
    assert.equal(classifySign({ source: 'S', sourceIndex }).label, '?');
  }
});

test('513 maps only the two approved full phrases after whitespace normalization', () => {
  for (const [sourceRemark, expected] of [['보행자 작동신호기', '407의4'], ['보행자작동신호기', '407의4'],
    ['속도를 줄이시오', '415'], [' 속도를줄이시오 ', '415']]) {
    const result = classifySign({ source: 'S', sourceIndex: '513', sourceRemark });
    assert.equal(result.label, expected);
    assert.equal(result.sourceRemark, sourceRemark);
    assert.match(result.reason, /원본 비고에 따라/);
  }
  for (const sourceRemark of ['', '보행시 작동신호기', '보행자 작동신호기 안내', '여기부터 속도를 줄이시오', '속도를 줄이시오/LED', '신호준수']) {
    assert.equal(classifySign({ source: 'S', sourceIndex: '513', sourceRemark }).label, '?');
  }
  assert.equal(classifySign({ source: 'R', sourceIndex: '513', sourceRemark: '속도를 줄이시오' }).label, '?');
});

test('514 and 513 keep their mapped records while unmatched 513 records are hidden', async () => {
  const { rows } = await loadSignSnapshot();
  const counts = {};
  for (const [id, lat, lng, sourceIndex, , , sourceRemark] of rows) {
    if (id[0] !== 'S' || !(sourceIndex.startsWith('514') || sourceIndex === '513')) continue;
    const result = classifySign({ source: 'S', sourceIndex, sourceRemark, lat, lng });
    const key = `${sourceIndex === '513' ? '513' : '514'}:${result.ignored ? 'ignored' : result.label}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  assert.deepEqual(counts, { '514:417': 261, '514:418': 211, '514:419': 60, '513:407의4': 4, '513:415': 4, '513:ignored': 89 });
});

test('chart number equality never verifies meaning or invents codes for unknown/road signs', () => {
  const base = { id: 'S:one', source: 'S', label: 'one', lat: 37.48, lng: 127.03 };
  assert.equal(POLICE_SIGN_CODES.length, 144);
  for (const code of ['220', '224', '219', '322', '428', '110의2']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, code);
    assert.equal(result.color, '#2563eb');
    assert.equal(result.managementId, 'one');
  }
  for (const code of ['220-0', '220-9', '220-10', '110-2', '309-3', '415-3', '751', '704', '513', '999', '', 'toString', '__proto__']) {
    const result = classifySign({ ...base, sourceIndex: code });
    assert.equal(result.label, '?');
    assert.equal(result.policeCode, null);
  }
  assert.equal(classifySign({ ...base, source: 'R', sourceIndex: '219' }).label, '?');
});

test('Seoul codes remain verbatim in notes and every source uses the same color', () => {
  for (const [source, code] of [['S', '220-1'], ['S', '751'], ['S', '219'], ['R', '3방향표지']]) {
    const point = { id: `${source}:one`, source, label: 'one', sourceIndex: code, lat: 37.48, lng: 127.03 };
    const result = classifySign(point);
    assert.equal(result.sourceIndex, code);
    assert.ok(result.sourceCodeRemark.endsWith(code));
    assert.equal(result.color, '#2563eb');
    assert.equal(result.roadviewUrl, 'https://map.kakao.com/link/roadview/37.48,127.03');
    assert.equal(result.managementId, 'one');
    assert.equal(Object.hasOwn(result, 'verified'), false, 'Color does not communicate verification');
  }
});

test('roadview links use latitude then longitude and reject absent or invalid coordinates', () => {
  assert.equal(signRoadviewUrl({ lat: 37.483625, lng: 127.032683 }), 'https://map.kakao.com/link/roadview/37.483625,127.032683');
  for (const patch of [{ lat: null }, { lat: '' }, { lng: undefined }, { lng: ' ' }, { lat: Infinity }, { lng: 'javascript:bad' }, { lat: 91 }, { lng: 181 }]) assert.equal(signRoadviewUrl({ lat: 37.48, lng: 127.03, ...patch }), null);
});

test('Seocho display excludes 704 and maps the actual 751 remark without guessing composites', async () => {
  const result = await querySeoulSigns({ lat: 37.483625, lng: 127.032683, width: 500, height: 500 });
  assert.equal(result.points.length, 119);
  const classified = visibleSigns(result.points);
  assert.equal(classified.length, 115);
  assert.ok(classified.every(p => p.color === '#2563eb'));
  assert.ok(classified.every(p => p.sourceCodeRemark.includes(p.sourceIndex)));
  assert.equal(classified.filter(p => p.mappingBasis === 'code-match').length, 95);
  const mapped = classified.filter(p => p.mappingBasis === 'user');
  assert.equal(mapped.length, 8);
  assert.equal(mapped.filter(p => p.sourceIndex === '220-1' && p.policeCode === '224').length, 5);
  assert.equal(mapped.find(p => p.sourceIndex === '751' && p.policeCode === '224').sourceRemark, '30/LED');
  assert.equal(mapped.filter(p => p.sourceRemark === '어린이보호구역/30' && p.label === '324, 224').length, 2);
  assert.equal(classified.filter(p => p.policeCode).length, 103);
  assert.equal(classified.filter(p => p.label === '?').length, 12);
});

test('751 generalizes speed and release phrases and excludes blank or right-turn-only remarks', () => {
  const base = { source: 'S', sourceIndex: '751', label: 'one', lat: 37.5, lng: 127 };
  for (const [sourceRemark, codes] of [
    ['30', ['224']], ['30/LED', ['224']], ['30 / LED', ['224']],
    ['20', ['224']], ['50', ['224']], ['80/LED', ['224']], ['130km/h', ['224']],
    ['최고속도제한 40 해제', ['224', '427']], ['속도해제(30)', ['224', '427']],
    ['30속도 해제', ['224', '427']], ['50 km 속도제한 해제', ['224', '427']],
    ['30 해제', ['224', '427']], ['30해제 / LED', ['224', '427']],
    ['여기부터 속도를 줄이시오', ['415']], ['여기부터 속도를줄이시오 / LED', ['415']],
    ['어린이보호구역 해제', ['324', '427']], ['어린이보호 해제', ['324', '427']],
    ['30/여기부터속도를줄이시오/LED', ['224', '415']], ['30 여기부터 속도를 줄이시오', ['224', '415']],
    ['어린이보호구역 30', ['324', '224']], ['어린이보호구역/30', ['324', '224']],
    ['30, 여기부터 속도를 줄이시오', ['224', '415']], ['30, 여기부터 속도를 줄이시오 / LED', ['224', '415']],
    ['여기부터 300m 속도를 줄이시오', ['418', '415']], ['여기부터300m속도를줄이시오/LED', ['418', '415']],
    ['어린이보호구역', ['324']], ['어린이 보호구역 / LED', ['324']],
  ]) {
    const result = classifySign({ ...base, sourceRemark });
    assert.deepEqual(result.policeCodes, codes);
    assert.equal(result.label, codes.join(', '));
    assert.equal(result.ignored, false);
    assert.equal(result.sourceRemark, sourceRemark);
    assert.equal(result.mappingBasis, 'user');
  }
  for (const sourceRemark of ['LED', ' led / ', '', '  ', '우회전시', '우회전시 / LED', '07:00~21:00 토요일 공휴일 제외', '07:00 ~ 21:00 / 토요일 공휴일 제외', '여기부터', '여기부터/LED', '여기부터 / LED', 'LED 여기부터', '07:00~10:00 17:00~21:00 토요일 공휴일 제외', '07:00~10:00 / 17:00~21:00 토요일 공휴일 제외 / LED', '사고잦은곳', '사고 잦은 곳 / LED']) assert.equal(visibleSigns([{ ...base, sourceRemark }]).length, 0);
  for (const sourceRemark of ['219', '0', '30m', '4.5t', '07:00~21:00', '안전속도50', '30/40', '1/20', '10/2', '어린이보호구역해제/30해제', '30 주의', '우회전시 자전거주의', '20/여기부터속도를줄이시오', '어린이보호구역40', '07:00-21:00 토요일 공휴일 제외', '07:00~21:00 일요일 제외', '여기부터300m', '여기부터 150m 속도를 줄이시오', '자전거주의', '30,40', '사고잦은곳 전방100m', '07:00~10:00 17:00~21:00 일요일 제외', '30/여기부터/LED', '어린이보호구역/여기부터']) {
    const result = classifySign({ ...base, sourceRemark });
    assert.equal(result.label, '?');
    assert.equal(result.ignored, false);
  }
  assert.equal(classifySign({ ...base, source: 'R', sourceRemark: '30 해제' }).label, '?');
});

test('ignored source codes are removed from display only, not raw records or other sources', () => {
  const points = ['704', '750', '232', '712-1', '540', '543', '532', '534', '559', '751'].map(sourceIndex => ({ source: 'S', sourceIndex, label: sourceIndex, sourceRemark: '미지정 문구' }));
  const original = structuredClone(points);
  assert.deepEqual(visibleSigns(points).map(p => p.sourceIndex), ['751']);
  assert.deepEqual(points, original);
  assert.equal(visibleSigns(points.map(p => ({ ...p, source: 'R' }))).length, points.length);
  for (const sourceIndex of ['540-1', '543-1', '532-1', '534-1', '559-1']) {
    assert.equal(classifySign({ source: 'S', sourceIndex, sourceRemark: '보행신호시' }).ignored, true);
  }
});

test('526 requires an explicit one-way arrow direction and preserves incomplete remarks', () => {
  for (const [sourceRemark, code] of [['일방통행 (오른쪽 화살표)', '326'], ['일방통행→', '326'],
    ['학교내 일방통행(좌측)', '327'], ['일방통행←', '327'], ['일방통행 위쪽', '328'], ['일방통행(↑)', '328']]) {
    const point = { source: 'S', sourceIndex: '526', sourceRemark };
    const result = classifySign(point);
    assert.equal(result.policeCode, code);
    assert.equal(result.sourceRemark, sourceRemark);
    assert.equal(result.mappingBasis, 'user');
    assert.equal(classifySign({ ...point, source: 'R' }).policeCode, null);
  }
  for (const sourceRemark of ['', '일방통행', '학교내 일방통행', '학교앞', '일반통행', '일방통행(오른쪽/왼쪽)', '일방통행 우측통행 주의', '일방통행(좌측 화살표 철거)']) {
    const result = classifySign({ source: 'S', sourceIndex: '526', sourceRemark, direction: '002' });
    assert.equal(result.policeCode, null);
    assert.equal(result.label, '일방');
    assert.equal(result.displayOnly, true);
    assert.deepEqual(result.policeCodes, []);
    assert.match(result.reason, /방향이 미확인/);
    assert.equal(result.ignored, false);
  }
});

test('distance templates map type independently of distance and retain unrecognized contexts', () => {
  for (const sourceIndex of ['521', '538', '563']) {
    for (const [sourceRemark, code] of [['100m 앞부터', '401'], ['전방10m부터', '401'], ['전방 0.5km 앞부터', '401'],
      ['여기부터500M', '402'], ['여기서부터 300m', '402'], ['구간시작 100m', '417'], ['구간 내', '418'],
      ['구간끝 30m', '419'], ['↑ 전방 50m', '422'], ['전방50m ↑', '422'], ['100', '425'], ['250m', '425'], ['전방100m', '422'],
      ['좌측 전방 50m', '421'], ['우전방5m', '420'], ['전방100m육교', '422'],
      ['여기부터100m (휴교일제외)', '402'], ['SCHOOL20 M 여기부터300M', '402'],
      ['전방 250m 시간X학교앞', '422'], ['160m 유치원앞', '425']]) {
      const point = { source: 'S', sourceIndex, sourceRemark };
      const result = classifySign(point);
      assert.equal(result.policeCode, code);
      assert.equal(result.sourceRemark, sourceRemark);
      assert.equal(result.mappingBasis, 'user');
      assert.equal(classifySign({ ...point, source: 'R' }).policeCode, null);
    }
    for (const sourceRemark of ['', '250ㅡ', '시간X', '목동교방향70m', '막다른길진입금지', '교차로내주차금지',
      '구간끝130m 구간내200m', '200m앞부터/LED', '구간시작점검', '전방#', '100m/200m', '전방100m높이4.5m']) {
      assert.equal(classifySign({ source: 'S', sourceIndex, sourceRemark }).policeCode, null);
    }
  }
  assert.equal(classifySign({ source: 'S', sourceIndex: '559', sourceRemark: '보행신호시' }).policeCode, null);
});

test('distance types cover 202 records and 526 uses text while exclusions retain exact scope', async () => {
  const { rows } = await loadSignSnapshot();
  const counts = {};
  for (const [id, , , sourceIndex, , , sourceRemark] of rows) {
    if (id[0] !== 'S' || !['526', '521', '538', '563', '540', '543', '532', '534', '559'].includes(sourceIndex)) continue;
    const result = classifySign({ source: 'S', sourceIndex, sourceRemark });
    const key = `${sourceIndex}:${result.ignored ? 'ignored' : result.label}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  assert.deepEqual(counts, { '526:일방': 165, '521:401': 8, '521:402': 4, '521:422': 5, '521:425': 86, '521:ignored': 95,
    '538:401': 3, '538:420': 1, '538:421': 1, '538:422': 36, '538:425': 40, '538:ignored': 10,
    '563:401': 1, '563:420': 1, '563:422': 16, '563:ignored': 5,
    '540:ignored': 25, '543:ignored': 5, '532:ignored': 35, '534:ignored': 8, '559:ignored': 41 });
});

test('751 raw remark ingestion reconciles all records with exact mapping and exclusion totals', async () => {
  const { rows } = await loadSignSnapshot();
  const counts = {};
  for (const [id, lat, lng, sourceIndex, , , sourceRemark] of rows) {
    if (id[0] !== 'S' || sourceIndex !== '751') continue;
    const p = classifySign({ source: 'S', sourceIndex, sourceRemark, lat, lng });
    const key = p.ignored ? 'ignored' : p.label;
    counts[key] = (counts[key] || 0) + 1;
  }
  assert.deepEqual(counts, { '224': 3787, '415': 1505, '224, 427': 1446, '324, 427': 483, '224, 415': 629, '324, 224': 130, '418, 415': 57, '324': 40, ignored: 9664, '?': 3807 });
});

test('non-751 unmatched safety signs are hidden without dropping mappings, labels or road signs', async () => {
  const { rows } = await loadSignSnapshot();
  const counts = {};
  for (const [id, lat, lng, sourceIndex, , , sourceRemark] of rows) {
    const point = { id, label: id.slice(2), source: id[0], lat, lng, sourceIndex, sourceRemark };
    const result = classifySign(point);
    const state = result.ignored ? 'excluded' : result.displayOnly ? 'text' : result.policeCode ? result.mappingBasis : 'unmapped';
    const key = `${point.source}:${state}`;
    counts[key] = (counts[key] || 0) + 1;
    if (point.source === 'S' && state === 'unmapped') assert.equal(sourceIndex, '751');
    assert.equal(result.sourceRemark, sourceRemark);
    assert.equal(result.managementId, point.label);
  }
  assert.deepEqual(counts, { 'S:user': 19032, 'S:code-match': 182707, 'S:text': 165,
    'S:excluded': 14376, 'S:unmapped': 3807, 'R:unmapped': 12008 });
  const points = [
    { source: 'S', sourceIndex: '513', sourceRemark: '미지정 문구' },
    { source: 'S', sourceIndex: '513', sourceRemark: '속도를 줄이시오' },
    { source: 'S', sourceIndex: '526', sourceRemark: '' },
    { source: 'S', sourceIndex: '751', sourceRemark: '30/여기부터 속도를 줄이시오' },
    { source: 'R', sourceIndex: '513', sourceRemark: '' },
  ];
  const original = structuredClone(points);
  assert.deepEqual(visibleSigns(points).map(p => p.label), ['415', '일방', '224, 415', '?']);
  assert.deepEqual(points, original);
});

test('labels avoid reserved legend area without discarding any points', () => {
  const points = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: '219', number: i, x: 610 + i * 8, y: 370 + i * 5 }));
  const legend = { x: 664, y: 328, w: 228, h: 248 };
  const result = layoutSignLabels(points, 900, 600, '0', [legend]);
  assert.equal(result.points.length, points.length);
  assert.ok(result.labels.length > 0);
  for (const { box: b } of result.labels) assert.ok(b.x + b.w <= legend.x || b.x >= legend.x + legend.w || b.y + b.h <= legend.y || b.y >= legend.y + legend.h);
});

test('sign scope rejects missing, non-finite, oversized and non-Seoul coordinates', () => {
  const input = { lat: 37.48, lng: 127.03, width: 500, height: 800 };
  for (const patch of [{ lat: '' }, { lng: null }, { width: 0 }, { height: 10001 }, { lat: 35.1 }, { width: Infinity }]) assert.throws(() => signScope({ ...input, ...patch }));
  const scope = signScope(input);
  assert.ok(Math.abs((scope.north - scope.south) * 111320 - 800) < 1e-6);
  assert.ok(Math.abs((scope.east - scope.west) * 111320 * Math.cos(input.lat * Math.PI / 180) - 500) < 1e-6);
});

test('rectangular selection includes edges, preserves official identifiers and deterministically sorts', () => {
  const scope = { north: 2, south: 1, west: 1, east: 2 };
  const a = ['S:04-0000000001', 2, 1, '322', '', '001'];
  const b = ['R:공식-서울-1', 1, 2, '3방향표지', '', ''];
  const outside = ['S:outside', 2.000001, 1, '', '', ''];
  const result = selectSigns([b, outside, a], scope);
  assert.deepEqual(result.map(p => p.label), ['04-0000000001', '공식-서울-1']);
  assert.deepEqual(result, selectSigns([a, outside, b], scope));
  assert.throws(() => selectSigns([a, b], scope, 1), /범위를 줄여/);
});

test('official snapshot counts reconcile, identifiers unique and coordinates valid', async () => {
  const { rows, manifest } = await loadSignSnapshot();
  assert.equal(rows.length, 232095);
  assert.equal(new Set(rows.map(r => r[0])).size, rows.length);
  assert.ok(rows.every(r => Number.isFinite(r[1]) && Number.isFinite(r[2])));
  assert.equal(manifest.sources[0].rawCount - 720 - 20, manifest.counts.S);
  assert.equal(manifest.sources[1].rawCount - 8 - 4, manifest.counts.R);
  const result = await querySeoulSigns({ lat: 37.483, lng: 127.034, width: 500, height: 500 });
  assert.ok(result.points.length > 0);
  assert.ok(result.points.every(p => p.lat >= result.scope.south && p.lat <= result.scope.north && p.lng >= result.scope.west && p.lng <= result.scope.east));
});

test('callouts retain real point locations and never overlap or clip official labels', () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ id: `S:${i}`, label: `04-${String(i).padStart(10, '0')}`, number: i + 1, x: 250 + i % 3, y: 230 + i % 5 }));
  const original = structuredClone(points);
  const { labels, points: visible } = layoutSignLabels(points, 900, 600, 'S:39');
  assert.deepEqual(points, original);
  assert.equal(visible.length, 40);
  assert.equal(labels[0].id, 'S:39', 'Selected coincident point receives priority');
  assert.ok(labels.length > 0 && labels.length < points.length, 'Dense points remain while labels are selectively shown');
  for (const p of labels) {
    assert.ok(p.box.x >= 8 && p.box.x + p.box.w <= 858 && p.box.y >= 8 && p.box.y + p.box.h <= 564);
    for (const q of labels) if (p !== q) assert.ok(p.box.x + p.box.w <= q.box.x || q.box.x + q.box.w <= p.box.x || p.box.y + p.box.h <= q.box.y || q.box.y + q.box.h <= p.box.y);
  }
});
