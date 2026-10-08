export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const DAY_MS = 86400000;

export function isoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("날짜 형식이 올바르지 않습니다.");
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("유효하지 않은 날짜입니다.");
  return date;
}

export function shiftDate(date, days) {
  return new Date(isoDate(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function trafficDateLabel(value) {
  const date = isoDate(value);
  const weekday = WEEKDAYS[(date.getUTCDay() + 6) % 7];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${weekday})`;
}

export function mondayOf(date) {
  return shiftDate(date, -((isoDate(date).getUTCDay() + 6) % 7));
}

export function weekDates(date) {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function monthWeeks(month) {
  isoDate(`${month}-01`);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const weeks = [];
  for (let first = mondayOf(`${month}-01`); first <= last; first = shiftDate(first, 7)) weeks.push(weekDates(first));
  return weeks;
}

export function countValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!/^\d+(?:\.0+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

// A point/date/direction is one published row, not an independently additive sensor.
export function buildWeekAnalysis({ records, station, week, direction = "both" }) {
  if (!["both", "in", "out"].includes(direction)) throw new Error("방향 선택이 올바르지 않습니다.");
  const dates = weekDates(week);
  const required = direction === "both" ? ["in", "out"] : [direction];
  const index = new Map();
  for (const record of records) {
    if (record.station !== station || !dates.includes(record.date)) continue;
    const key = `${record.date}|${record.direction}`;
    if (index.has(key)) throw new Error("중복 교통량 행이 있어 분석을 중단했습니다.");
    index.set(key, record);
  }
  const days = dates.map((date, dayIndex) => {
    const rows = required.map((dir) => index.get(`${date}|${dir}`));
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const values = rows.map((row) => countValue(row?.hours?.[hour]));
      return values.some((v) => v === null) ? null : values.reduce((a, b) => a + b, 0);
    });
    const complete = hours.every((value) => value !== null);
    const total = complete ? hours.reduce((a, b) => a + b, 0) : null;
    const max = complete ? Math.max(...hours) : null;
    return { date, label: WEEKDAYS[dayIndex], hours, complete, total,
      sourceDayType: [...new Set(rows.map((r) => r?.dayType).filter(Boolean))].join(" / "),
      sourceWeekday: [...new Set(rows.map((r) => r?.weekday).filter(Boolean))].join(" / "),
      peakHours: max > 0 ? hours.flatMap((v, h) => v === max ? [h] : []) : [] };
  });
  const complete = days.every((day) => day.complete);
  const dailyMax = complete ? Math.max(...days.map((day) => day.total)) : null;
  const weeklyMax = complete ? Math.max(...days.flatMap((day) => day.hours)) : null;
  const peakDays = dailyMax > 0 ? days.filter((day) => day.total === dailyMax).map((day) => day.date) : [];
  const peakCells = weeklyMax > 0 ? days.flatMap((day) => day.hours.flatMap((v, h) => v === weeklyMax ? [`${day.date}|${h}`] : [])) : [];
  return { station, direction, weekStart: dates[0], weekEnd: dates[6], days, complete, peakDays, peakCells,
    dailyMax, weeklyMax, validHours: days.reduce((n, day) => n + day.hours.filter((v) => v !== null).length, 0),
    warning: complete ? "" : "결측 또는 미수집 날짜가 있어 주간 첨두일·주간 최대시간을 확정하지 않습니다. 완전한 날짜만 일별 첨두시간을 표시합니다." };
}
