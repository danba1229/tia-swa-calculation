import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildWeekAnalysis, countValue, weekDates, monthWeeks, isoDate, trafficDateLabel } from "../lib/trafficPeak.js";
import { parseTopisWorkbook, listTopisMonths } from "../lib/topisMonthly.js";

const week = "2026-08-03";
const records = () => weekDates(week).flatMap((date, d) => ["in", "out"].map((direction) => ({ station: "D-13", date, direction,
  hours: Array.from({ length: 24 }, (_, h) => d === 4 && h === 17 ? 1000 : (d + 1) * 10), weekday: "월", dayType: "평일" })));
const analyze = (rows, extra = {}) => buildWeekAnalysis({ records: rows, station: "D-13", week, ...extra });
function workbook(rows, header) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header || ["일자", "요일", "요일(2)", "지점명", "지점번호", "방향", "구분", ...Array.from({ length: 24 }, (_, h) => `${h}시`)], ...rows]), "자료");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const sourceRow = (overrides = {}) => Object.assign([20260803, "월", "평일", "동일로(노원역)", "D-13", "유입", "노원역->중계역", ...Array(24).fill(10)], overrides);

test("calendar always Monday to Sunday, including year and month boundaries", () => {
  assert.deepEqual(weekDates("2026-01-01"), ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.equal(monthWeeks("2026-08").length, 6);
  assert.throws(() => isoDate("2026-02-30"));
});
test("daily sums and peaks use simultaneous in/out counts", () => {
  const a = analyze(records());
  assert.equal(a.complete, true); assert.equal(a.validHours, 168);
  assert.deepEqual(a.peakDays, ["2026-08-07"]);
  assert.deepEqual(a.peakCells, ["2026-08-07|17"]);
  assert.equal(a.dailyMax, 4300); assert.equal(a.weeklyMax, 2000);
});

test("summary date labels use calendar weekdays across month and year boundaries", () => {
  assert.equal(trafficDateLabel("2026-08-03"), "8/3(월)");
  assert.equal(trafficDateLabel("2026-08-09"), "8/9(일)");
  assert.equal(trafficDateLabel("2025-12-31"), "12/31(수)");
  assert.equal(trafficDateLabel("2026-01-01"), "1/1(목)");
  assert.equal(trafficDateLabel("2024-02-29"), "2/29(목)");
  assert.throws(() => trafficDateLabel("2026-02-30"));
  const rows = records().map((r) => ({ ...r, weekday: "일" }));
  assert.deepEqual(analyze(rows).peakDays.map(trafficDateLabel), ["8/7(금)"]);
});
test("missing direction does not become zero or partial daily total", () => {
  const a = analyze(records().filter((r) => !(r.date === week && r.direction === "out")));
  assert.equal(a.days[0].total, null); assert.equal(a.days[0].hours[0], null);
  assert.deepEqual(a.peakDays, []); assert.deepEqual(a.peakCells, []);
  assert.equal(a.complete, false);
});
test("single missing hour blocks daily and weekly definitive peaks", () => {
  const rows = records(); rows[0].hours[0] = null;
  const a = analyze(rows); assert.equal(a.days[0].total, null); assert.deepEqual(a.days[0].peakHours, []); assert.deepEqual(a.peakDays, []);
  assert.equal(a.days[0].hours[0], null);
  assert.equal(a.days[0].hours[1], 20);
  assert.equal(a.days[1].total, 960);
  assert.equal(a.days[1].peakHours.length, 24);
  assert.equal(a.dailyMax, null);
  assert.equal(a.weeklyMax, null);
  assert.equal(a.validHours, 167);
});
test("explicit single-direction selection supports one direction without doubling", () => {
  const a = analyze(records().filter((r) => r.direction === "in"), { direction: "in" });
  assert.equal(a.complete, true); assert.equal(a.weeklyMax, 1000);
});
test("ties are all highlighted, all-zero week has no peak", () => {
  const rows = records().map((r) => ({ ...r, hours: Array(24).fill(1) }));
  assert.equal(analyze(rows).peakDays.length, 7); assert.equal(analyze(rows).peakCells.length, 168);
  assert.equal(analyze(rows.map((r) => ({ ...r, hours: Array(24).fill(0) }))).peakCells.length, 0);
});
test("duplicate directions fail closed and unrelated stations ignored", () => {
  assert.throws(() => analyze([...records(), records()[0]]), /중복/);
  assert.equal(analyze([...records(), { ...records()[0], station: "A-01" }]).complete, true);
});
test("source weekday does not overwrite calendar weekday on a holiday", () => {
  const rows = records().map((r) => ({ ...r, weekday: "일", dayType: "주말" }));
  assert.equal(analyze(rows).days[0].label, "월"); assert.equal(analyze(rows).days[0].sourceWeekday, "일");
});
test("count parser preserves unknown, negative and nonnumeric cells as missing", () => {
  for (const value of [null, undefined, "", "-", "N/A", -1, "1.5"]) assert.equal(countValue(value), null);
  assert.equal(countValue("1,234"), 1234); assert.equal(countValue(0), 0);
});
test("TOPIS header-based parser preserves missing and source metadata", () => {
  const data = parseTopisWorkbook(workbook([sourceRow({ 8: null, 9: "-", 10: 0 })]), "2026-08");
  assert.equal(data.records[0].hours[1], null); assert.equal(data.records[0].hours[3], 0);
  assert.equal(data.missingValues, 2); assert.equal(data.points[0].directions.in, "노원역->중계역");
  assert.equal(data.sourceSha256.length, 64);
});
test("TOPIS parser rejects wrong month, duplicate, missing header and HTML error", () => {
  assert.throws(() => parseTopisWorkbook(workbook([sourceRow()]), "2026-07"), /일자/);
  assert.throws(() => parseTopisWorkbook(workbook([sourceRow(), sourceRow()]), "2026-08"), /중복/);
  assert.throws(() => parseTopisWorkbook(workbook([], ["설명"]), "2026-08"), /추출/);
  assert.throws(() => parseTopisWorkbook(Buffer.from("<html>error</html>"), "2026-08"), /엑셀/);
});
test("month discovery excludes unpublished entries", async () => {
  const list = await listTopisMonths(2026, { fetchImpl: async () => new Response(JSON.stringify({ rows: [
    { months: "08", apndFileNm: "08월.xlsx", apndFilePathNm: "file.xlsx", bdwrSeq: "123" },
    { months: "09", apndFileNm: null },
  ] })) });
  assert.equal(list.length, 1); assert.equal(list[0].month, "2026-08");
});
