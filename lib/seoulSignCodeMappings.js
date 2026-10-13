// User-approved display rules (2026-10-12), not an official Seoul code dictionary.
// Apply only these exact safety-sign codes, regardless of source remarks.
// Keep the original index and management ID for review and future exceptions.
export const SEOUL_SIGN_CODE_MAPPINGS = Object.freeze({
  '205-2': '205의2',
  '206-2': '206의2',
  // Speed-limit type only: these codes do not determine a numeric speed value.
  '220-1': '224',
  '220-2': '224',
  '220-3': '224',
  '220-4': '224',
  '220-5': '224',
  '220-6': '224',
  '220-7': '224',
  '220-8': '224',
  '309-2': '309의2',
  '320-2': '320의2',
  '320-3': '320의3',
  '320-4': '320의4',
  '321-2': '321의2',
  '415-2': '415의2',
});

export function seoulSignDisplayRule(point) {
  if (point.source !== 'S') return null;
  if (['704', '750', '232', '712-1', '540', '543', '532', '534', '559'].includes(point.sourceIndex)) return { ignored: true, codes: [], basis: 'code' };
  // Full remark patterns only: never infer arrow direction from coordinates,
  // installation direction, a bare distance, or an unrelated word in a sentence.
  const remark = String(point.sourceRemark || '').replace(/\s+/g, '').toLowerCase();
  if (point.sourceIndex === '526') {
    const directions = { '오른쪽': '326', '우측': '326', '→': '326', '왼쪽': '327', '좌측': '327', '←': '327', '위쪽': '328', '상향': '328', '↑': '328' };
    const match = /^(?:학교내)?일방통행(?:\((오른쪽|우측|→|왼쪽|좌측|←|위쪽|상향|↑)(?:화살표)?\)|(오른쪽|우측|→|왼쪽|좌측|←|위쪽|상향|↑)(?:화살표)?)$/.exec(remark);
    return match ? { ignored: false, codes: [directions[match[1] || match[2]]], basis: 'remark' } : null;
  }
  if (['521', '538', '563'].includes(point.sourceIndex)) {
    const distance = '\\d+(?:\\.\\d+)?(?:km|m)';
    let code = null;
    if (new RegExp(`^(?:${distance}앞부터|전방${distance}(?:앞)?부터)$`).test(remark)) code = '401';
    else if (new RegExp(`^여기(?:서)?부터${distance}$`).test(remark)) code = '402';
    else if (new RegExp(`^구간시작(?:${distance})?$`).test(remark)) code = '417';
    else if (new RegExp(`^구간내(?:${distance})?$`).test(remark)) code = '418';
    else if (new RegExp(`^구간끝(?:${distance})?$`).test(remark)) code = '419';
    else if (new RegExp(`^(?:↑전방${distance}|전방${distance}↑)$`).test(remark)) code = '422';
    // A bare distance can also belong to a section/arrow sign; keep it unknown.
    return code ? { ignored: false, codes: [code], basis: 'remark' } : null;
  }
  // User-approved families (2026-10-13). Match subtype before numeric distance;
  // never interpret a distance suffix or source remark as an actual distance.
  if (/^514-1(?:-\d+)?$/.test(point.sourceIndex)) return { ignored: false, codes: ['418'], basis: 'code' };
  if (/^514-2(?:-\d+)?$/.test(point.sourceIndex)) return { ignored: false, codes: ['419'], basis: 'code' };
  if (/^514(?:-\d+)?$/.test(point.sourceIndex)) return { ignored: false, codes: ['417'], basis: 'code' };
  if (point.sourceIndex === '513') {
    const text = String(point.sourceRemark || '').replace(/\s+/g, '');
    if (text === '보행자작동신호기') return { ignored: false, codes: ['407의4'], basis: 'remark' };
    if (text === '속도를줄이시오') return { ignored: false, codes: ['415'], basis: 'remark' };
    return null;
  }
  if (point.sourceIndex !== '751') return null;
  // Only whitespace, slash separators and the LED installation notation are
  // insignificant. Do not substring-match other speeds, conditions or releases.
  const raw = String(point.sourceRemark || '').trim();
  const text = raw.replace(/LED/gi, '').replace(/[\s/]+/g, '');
  if (raw && !text && /LED/i.test(raw)) return { ignored: true, codes: [], basis: 'remark' };
  const rules = {
    '30': ['224'],
    '30해제': ['224', '427'],
    '여기부터속도를줄이시오': ['415'],
    '어린이보호구역해제': ['324', '427'],
  };
  return Object.hasOwn(rules, text) ? { ignored: false, codes: rules[text], basis: 'remark' } : null;
}
