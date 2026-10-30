// User-approved 751 display rules. These are not an official code crosswalk.
const mapped = codes => ({ ignored: false, codes: [...new Set(codes)], basis: 'remark' });
const ignored = () => ({ ignored: true, codes: [], basis: 'remark' });

function timeOnly(text) {
  let found = /요일|공휴일|휴교일|평일|전일|매일/.test(text);
  const rest = text.replace(/(?:[01]?\d|2[0-4]):[0-5]\d|24시간/g, () => { found = true; return ''; })
    .replace(/토요일|일요일|월요일|화요일|수요일|목요일|금요일|공휴일|휴교일|평일|전일제|전일|매일|오전|오후|제외|시간제|시간|토|일/g, '')
    .replace(/[~∼〜\-–—:.,/()\s]/g, '');
  return found && !rest;
}

export function seoul751RemarkRule(rawRemark) {
  const raw = String(rawRemark || '').trim();
  const compact = raw.replace(/LED/gi, '').replace(/\s+/g, '').toLowerCase();
  // Full, unambiguous bicycle types approved by the user. Do not infer the
  // shape of a caution/crosswalk sign from its name alone. Road names below
  // are exact source aliases, not a catch-all prefix that drops conditions.
  const bicycle = /^(?:(?:연서로|연세로))?(자전거전용도로|자전거전용차로|자전거[·및]?보행자겸용도로|자전거및보행자전용도로)(해제)?$/.exec(compact);
  if (bicycle) {
    const code = bicycle[1] === '자전거전용도로' ? '302'
      : bicycle[1] === '자전거전용차로' ? '318' : '303';
    return mapped(bicycle[2] ? [code, '427'] : [code]);
  }
  // Keep unresolved bicycle/crosswalk compounds pending, even with other words.
  if (/자전거|횡단보도/.test(compact)) return null;
  if (/버스전용/.test(compact)) return ignored();
  if (/^통합표지(?:판)?$/.test(compact.replace(/[(),/]/g, ''))) return ignored();
  if (timeOnly(compact)) return ignored();

  // Recognize a restriction's subject, never infer height from an unlabeled m.
  // Unlabeled lengths and road-width descriptions are not vehicle restrictions.
  const weight = /(?:총중량|축하중|중량제한|중량\d)/.test(compact)
    || (/\d+(?:\.\d+)?(?:t|톤)/.test(compact) && /제한|통행|운행|차량/.test(compact))
    || /^\d+(?:\.\d+)?(?:t|톤)$/.test(compact.replace(/^[(/,]+|[)/,]+$/g, ''));
  const height = /높이(?:제한)?(?:\d+(?:\.\d+)?(?:m|미터)|제한)|차고제한/.test(compact);
  const width = /(?<!도로|차로|노)(?:차량폭|차폭|너비|폭)(?:제한)?(?:\d+(?:\.\d+)?(?:m|미터)|제한)/.test(compact);
  if ((weight || height || width) && !/해제/.test(compact)) {
    return { ...mapped([...(weight ? ['220'] : []), ...(height ? ['221'] : []), ...(width ? ['222'] : [])]),
      note: '중량·높이·폭 제한은 수치와 무관하게 표시합니다. 길이·시간 등 나머지 조건과 실제 제한값은 원본 비고를 확인하세요.' };
  }

  // Do not concatenate separate numeric values into a speed or distance.
  if (/\d[\s/,]+\d/.test(raw)) return null;
  let text = compact.replace(/km\/h/g, 'kmh').replace(/여기서부터/g, '여기부터')
    .replace(/[\s/,()]+/g, '');
  if (!text || text === '우회전시' || text === '여기부터') return ignored();

  const releaseSpeed = /^속도해제(\d{1,3})$/.exec(text);
  if (releaseSpeed && Number(releaseSpeed[1]) > 0 && Number(releaseSpeed[1]) <= 130) return mapped(['224', '427']);
  if (/^(?:전방)?\d+(?:\.\d+)?(?:km|m)(?:앞)?부터$/.test(text)) return mapped(['401']);

  let zone = null, speed = null, distance = false, here = false, slow = false, release = false, accident = false, oneWay = false;
  const directions = new Set();
  while (text) {
    let match;
    if ((match = /^(노인|어린이)보호(?:구역)?/.exec(text))) {
      if (zone) return null;
      zone = match[1] === '노인' ? '323' : '324';
    } else if ((match = /^여기부터\d+(?:\.\d+)?(?:km|m)/.exec(text))) {
      if (distance) return null;
      distance = true;
    } else if ((match = /^여기부터/.exec(text))) {
      here = true;
    } else if ((match = /^속도를줄이시오/.exec(text))) {
      slow = true;
    } else if ((match = /^사고(?:가)?(?:잦은|많은)곳/.exec(text))) {
      accident = true;
    } else if ((match = /^도심부(?:시점|종점)?/.exec(text))) {
      // Place context on a release plate, e.g. "60해제 도심부(시점)" (2026-10-30).
    } else if ((match = /^일방통행/.exec(text))) {
      oneWay = true;
    } else if ((match = /^해제/.exec(text))) {
      release = true;
    } else if ((match = /^[→←↑]/.exec(text))) {
      directions.add(match[0]);
    } else if ((match = /^(?:(?:최고)?속도(?:제한)?|제한속도)?(\d{1,3})(?:kmh?|㎞h?)?(?:속도(?:제한)?)?/.exec(text))) {
      if (speed !== null || Number(match[1]) < 1 || Number(match[1]) > 130) return null;
      speed = Number(match[1]);
    } else {
      return null; // Unknown context must not silently disappear.
    }
    text = text.slice(match[0].length);
  }
  if (oneWay) {
    if (zone || speed !== null || slow || distance || release || accident || directions.size > 1) return null;
    if (directions.size) return mapped([{ '→': '326', '←': '327', '↑': '328' }[[...directions][0]]]);
    return { ...mapped([]), displayLabel: '일방' };
  }
  // An isolated ignored fragment does not create a numbered sign.
  if (!zone && speed === null && !slow && !distance) {
    return !release && !directions.size && (here || accident) ? ignored() : null;
  }
  // Release + slowdown/section is not an approved compound.
  if (release && (slow || distance)) return null;
  const codes = [
    ...(zone ? [zone] : []), ...(speed !== null ? ['224'] : []),
    ...(distance ? [slow ? '418' : '402'] : []), ...(slow ? ['415'] : []),
    ...(release ? ['427'] : []),
    ...[...directions].map(direction => ({ '→': '420', '←': '421', '↑': '422' })[direction]),
  ];
  return mapped(codes);
}
