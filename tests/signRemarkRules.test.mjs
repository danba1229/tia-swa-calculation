import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySign, visibleSigns } from '../lib/signClassification.js';

const point = sourceRemark => ({ id: 'S:sample', label: 'sample', source: 'S', sourceIndex: '751', sourceRemark, lat: 37.5, lng: 127 });
const codes = remark => classifySign(point(remark)).policeCodes;

test('approved protection, speed, slowdown and release components combine across formatting', () => {
  for (const [zone, code] of [['노인', '323'], ['어린이', '324']]) {
    for (const speed of [20, 30, 40, 60]) {
      assert.deepEqual(codes(`${zone}보호구역 / ${speed} / 여기서부터 속도를 줄이시오 / LED`), [code, '224', '415']);
      assert.deepEqual(codes(`${speed}, ${zone}보호구역`), [code, '224']);
      assert.deepEqual(codes(`${zone}보호구역 해제, ${speed} 해제`), [code, '224', '427']);
    }
    assert.deepEqual(codes(`${zone}보호(해제)`), [code, '427']);
    assert.deepEqual(codes(`${zone}보호구역/여기부터/LED`), [code]);
    assert.deepEqual(codes(`${zone}보호구역/속도를 줄이시오`), [code, '415']);
  }
  assert.deepEqual(codes('30/여기부터/LED'), ['224']);
});

test('distance varies independently of speed; explicit arrow meanings survive', () => {
  for (const distance of ['50m', '150m', '300m', '0.5km']) {
    assert.deepEqual(codes(`여기서부터 ${distance} 속도를 줄이시오`), ['418', '415']);
    assert.deepEqual(codes(`노인보호구역 / 여기부터 ${distance} 속도를 줄이시오`), ['323', '418', '415']);
    assert.deepEqual(codes(`${distance} 앞부터`), ['401']);
    assert.deepEqual(codes(`전방 ${distance} 앞부터`), ['401']);
  }
  assert.deepEqual(codes('30, 여기부터 속도를 줄이시오 →'), ['224', '415', '420']);
  assert.deepEqual(codes('여기부터 속도를 줄이시오 ← / LED'), ['415', '421']);
  assert.deepEqual(codes('여기부터300m'), ['402']);
  assert.deepEqual(codes('30m'), []);
});

test('weight and labeled height map independently of limits without assuming other dimensions', () => {
  for (const weight of ['3.6t', '32톤', '40T']) assert.deepEqual(codes(`${weight} 제한`), ['220']);
  for (const height of ['3.5m', '4M', '5미터']) assert.deepEqual(codes(`높이 ${height} 제한`), ['221']);
  const raw = '차량운행제한 / 총중량 32t 축하중 10t / 높이 4.0m 길이 16.7m 폭 2.5m / 07:00~21:00';
  const p = point(raw), original = structuredClone(p), result = classifySign(p);
  assert.deepEqual(result.policeCodes, ['220', '221']);
  assert.equal(result.sourceRemark, raw);
  assert.match(result.reason, /길이·폭·시간/);
  assert.deepEqual(p, original);
  assert.deepEqual(codes('차량운행제한 40t 4.0m 2.5m'), ['220']);
  assert.deepEqual(codes('4.5t/LED'), ['220']);
  for (const raw of ['4m', '길이16.7m 폭2.5m', '높이 확인 필요', '높이4m제한해제', '30km/h 화물차 주의']) assert.deepEqual(codes(raw), []);
});

test('only approved exclusions disappear; bicycle and crosswalk records remain pending', () => {
  for (const raw of ['통합표지', '(통합표지)', '(통합표지) / LED', '토요일 공휴일 제외', '중앙차로 버스 전용 / 24시간 전일제', '청색차로 버스전용 07:00~21:00',
    '24시간 전일제', '07:00-10:00, 17:00-21:00 / 토요일 공휴일 제외', '사고많은곳', '사고가 잦은 곳']) {
    assert.equal(visibleSigns([point(raw)]).length, 0, raw);
  }
  assert.deepEqual(codes('사고잦은곳 / 속도를 줄이시오'), ['415']);
  for (const raw of ['자전거주의', '(통합표지) 자전거주의', '전방50m 횡단보도', '주차허용시간 22:00~07:00',
    '시간제 차량통행제한 여기부터70m 08:00~09:00', '우회전금지,좌일방통행통합판']) {
    const result = classifySign(point(raw));
    assert.equal(result.ignored, false, raw);
    assert.equal(result.label, '?', raw);
  }
});

test('751 one-way text is not a police number and existing 526 and other sources remain scoped', () => {
  const result = classifySign(point('일방통행 / LED'));
  assert.equal(result.label, '일방');
  assert.equal(result.policeCode, null);
  assert.equal(result.displayOnly, true);
  assert.doesNotMatch(result.reason, /526/);
  assert.deepEqual(codes('일방통행→'), ['326']);
  assert.deepEqual(codes('일방통행←'), ['327']);
  assert.deepEqual(codes('일방통행↑'), ['328']);
  assert.equal(classifySign({ ...point('노인보호구역'), source: 'R' }).label, '?');
  assert.equal(classifySign({ ...point('버스전용'), sourceIndex: '330' }).policeCode, '330');
});

test('separators, unrelated numeric units and unknown compound fragments cannot invent a mapping', () => {
  for (const raw of ['30/40', '30,40', '30 40', '10/2', '219', '노인보호구역70%축소형', '노인보호구역-이설됨',
    '노인보호구역 30 진입금지', '여기부터 속도를 줄이시오 ↓', '노인보호구역 어린이보호구역', '구립노인복지관 200m',
    '어린이보호구역 24시간', '노인보호구역 여기부터 250m 05:00~22:00', '30 속도제한 40']) {
    const result = classifySign(point(raw));
    assert.equal(result.label, '?', raw);
    assert.equal(result.ignored, false, raw);
  }
});
