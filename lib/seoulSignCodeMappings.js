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
  if (['704', '750', '232'].includes(point.sourceIndex)) return { ignored: true, codes: [], basis: 'code' };
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
