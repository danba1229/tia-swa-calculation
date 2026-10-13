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

// User-approved remark types; distances are deliberately ignored for the code.
// Full templates retain the distinction between plain distance, section and
// direction. Context text stays in sourceRemark, not in the display number.
const DISTANCE_TEMPLATES = new Map(Object.entries({
  '401': ['#앞부터', '전방#부터', '전방#앞부터', '전방#부터시간없음', '어린이보호구역=전방#부터=(휴교일제외)'],
  '402': ['여기부터#', '여기서부터#', '여기부터#(휴교일제외)', 'school#여기부터#'],
  '417': ['구간시작', '구간시작#'],
  '418': ['구간내', '구간내#'],
  '419': ['구간끝', '구간끝#'],
  '420': ['우방향', '우방향#', '우측#', '우전방#', '우전방#(통합표지)', '→', '→#'],
  '421': ['좌방향', '좌방향#', '좌측#', '좌전방#', '좌측전방#', '←', '←#'],
  '422': ['전방#', '↑전방#', '전방#↑', '전방#앞', '전방교차로까지', 'schoolzone전방#',
    '전방#시간x학교앞', '전방#시간제한없음', '전방#육교', '전방#지하차도', '전방#터널',
    '전방#우합류도로', '전방#철탑', '전방#한강철교', '전방#앞유턴', '전방#교량',
    '전방#금호터널구간', '전방#1차로버스전용차로', '전방#성동교구간', '전방#서행!!안전운행!!',
    '전방#유턴', '유턴차량전방#좌회전후유턴', '전방#교량하부에서유턴', '전방#우회전금지',
    '전방#공사중', '전방#서울교구간', '전방#자전거우선도로'],
  '425': ['#', '#유치원앞', '#시간없음'],
}).flatMap(([code, templates]) => templates.map(template => [template, code])));

export function seoulSignDisplayRule(point) {
  if (point.source !== 'S') return null;
  if (['704', '750', '232', '712-1', '540', '543', '532', '534', '559'].includes(point.sourceIndex)) return { ignored: true, codes: [], basis: 'code' };
  // Never infer one-way arrow direction from coordinates or installation codes.
  const remark = String(point.sourceRemark || '').replace(/\s+/g, '').toLowerCase();
  if (point.sourceIndex === '526') {
    const directions = { '오른쪽': '326', '우측': '326', '→': '326', '왼쪽': '327', '좌측': '327', '←': '327', '위쪽': '328', '상향': '328', '↑': '328' };
    const match = /^(?:학교내)?일방통행(?:\((오른쪽|우측|→|왼쪽|좌측|←|위쪽|상향|↑)(?:화살표)?\)|(오른쪽|우측|→|왼쪽|좌측|←|위쪽|상향|↑)(?:화살표)?)$/.exec(remark);
    return match ? { ignored: false, codes: [directions[match[1] || match[2]]], basis: 'remark' }
      : { ignored: false, codes: [], displayLabel: '일방', basis: 'label' };
  }
  if (['521', '538', '563'].includes(point.sourceIndex)) {
    // '#' is internal only; source text containing it must not match a template.
    if (remark.includes('#')) return null;
    const template = /^\d+(?:\.\d+)?$/.test(remark) ? '#'
      : remark.replace(/\d+(?:\.\d+)?(?:km|m)/g, '#');
    const code = DISTANCE_TEMPLATES.get(template);
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
  // Generalize the approved speed rule, not arbitrary numbers inside distances,
  // times, weights, safety-speed advice or other compound signs.
  const raw = String(point.sourceRemark || '').trim();
  const text = raw.replace(/LED/gi, '').replace(/[\s/]+/g, '');
  if (!raw || text === '우회전시' || text === '07:00~21:00토요일공휴일제외') return { ignored: true, codes: [], basis: 'remark' };
  if (raw && !text && /LED/i.test(raw)) return { ignored: true, codes: [], basis: 'remark' };
  if (/\d\s*\/\s*\d/.test(raw)) return null;
  const speed = /^(?:(?:최고)?속도(?:제한)?|제한속도)?(\d{1,3})(?:kmh?|㎞h?)?(?:속도(?:제한)?)?(해제)?$/i.exec(text);
  const release = /^속도해제\((\d{1,3})\)$/.exec(text);
  const value = Number(speed?.[1] || release?.[1]);
  // A bare 219 in the actual remarks is not a plausible road speed. Retain
  // it for review instead of turning a possible source code into a speed sign.
  if (value > 0 && value <= 130) return { ignored: false, codes: speed?.[2] || release ? ['224', '427'] : ['224'], basis: 'remark' };
  const rules = {
    '여기부터속도를줄이시오': ['415'],
    '30여기부터속도를줄이시오': ['224', '415'],
    '어린이보호구역30': ['324', '224'],
    '어린이보호구역해제': ['324', '427'],
    '어린이보호해제': ['324', '427'],
  };
  return Object.hasOwn(rules, text) ? { ignored: false, codes: rules[text], basis: 'remark' } : null;
}
