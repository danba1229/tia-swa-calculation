import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySign, visibleSigns } from '../lib/signClassification.js';
import { POLICE_SIGN_CODES } from '../lib/policeSignCodes.js';

const point = sourceRemark => ({ source: 'S', sourceIndex: '751', sourceRemark });

test('all chart supplementary signs are hidden except release 427 and tow zone 428', () => {
  const supplementary = POLICE_SIGN_CODES.filter(code => code.startsWith('4'));
  assert.ok(supplementary.includes('407의4'));
  for (const sourceIndex of supplementary) {
    const p = { source: 'S', sourceIndex }, result = classifySign(p);
    const retained = ['427', '428'].includes(sourceIndex);
    assert.equal(result.ignored, !retained, sourceIndex);
    assert.deepEqual(result.policeCodes, retained ? [sourceIndex] : []);
    assert.deepEqual(result.omittedPoliceCodes, retained ? [] : [sourceIndex]);
  }
  for (const sourceIndex of ['111', '134', '220', '221', '222', '224', '302', '322']) {
    assert.equal(classifySign({ source: 'S', sourceIndex }).policeCode, sourceIndex);
  }
});

test('mixed signs retain main numbers and exceptions without mutating source or inventing meanings', () => {
  for (const [raw, expected] of [
    ['30, 여기부터 속도를 줄이시오', ['224']],
    ['어린이보호구역/여기부터300m/속도를 줄이시오', ['324']],
    ['노인보호구역 30 해제', ['323', '224', '427']],
    ['해제', ['427']], ['자전거전용 해제', ['427']],
    ['버스전용 해제', ['427']], ['LED 견인지역', ['428']],
    ['주차금지,견인지역통합판', ['428']], ['견인지역/해제', ['427', '428']],
  ]) {
    const p = point(raw), original = structuredClone(p), result = classifySign(p);
    assert.deepEqual(result.policeCodes, expected, raw);
    assert.equal(result.ignored, false);
    assert.deepEqual(p, original);
  }
  for (const raw of ['여기부터300m 속도를 줄이시오', '차량운행제한',
    '우전방50m앞부터', '해제아님', '해제미확인', '지정된차량만주차(무단주차시견인)']) {
    assert.equal(visibleSigns([point(raw)]).length, 0, raw);
  }
  assert.equal(classifySign(point('일방통행')).label, '일방');
  assert.equal(visibleSigns([{ source: 'R', sourceIndex: '415' }]).length, 1);
  for (const sourceIndex of ['551', '232', '416', '403', '505-1']) {
    const result = classifySign({ source: 'S', sourceIndex, sourceRemark: '견인 지역' });
    assert.deepEqual(result.policeCodes, ['428']);
    assert.equal(result.ignored, false);
  }
  assert.deepEqual(classifySign({ source: 'S', sourceIndex: '219', sourceRemark: '주차금지, 견인지역' }).policeCodes, ['219', '428']);
  assert.deepEqual(classifySign({ source: 'S', sourceIndex: '706', sourceRemark: '자전거전용도로 해제' }).policeCodes, ['427']);
});

test('vehicle weight height and width are independent of values and never inferred from unlabeled dimensions', () => {
  for (const value of ['2', '2.5', '4', '16.7']) {
    assert.deepEqual(classifySign(point(`총중량 ${value}t`)).policeCodes, ['220']);
    assert.deepEqual(classifySign(point(`높이 ${value}m`)).policeCodes, ['221']);
    assert.deepEqual(classifySign(point(`차폭 ${value}m 제한`)).policeCodes, ['222']);
    assert.deepEqual(classifySign(point(`총중량 ${value}톤 높이 ${value}미터 폭 ${value}m`)).policeCodes, ['220', '221', '222']);
  }
  assert.deepEqual(classifySign(point('길이16.7m 폭2.5m')).policeCodes, ['222']);
  assert.deepEqual(classifySign(point('차량운행제한 40t 4.0m 2.5m')).policeCodes, ['220']);
  for (const raw of ['도로폭2.5m', '차로폭3m', '노폭2m', '폭좁아짐', '높이 미확인', '4m/2.5m']) {
    assert.deepEqual(classifySign(point(raw)).policeCodes, [], raw);
  }
});
