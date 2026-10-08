export const MANUAL_CHECK = "수동확인필요";

export function transportCell(value) {
  if (value === null || value === undefined) return MANUAL_CHECK;
  const text = String(value).trim();
  return !text || /^-+$/.test(text) || /수동\s*확인|미제공|미확인|미조회/.test(text) ? MANUAL_CHECK : text;
}

// Display the provider's clock time without converting the service date/time zone.
// Extended service hours (e.g. 25:10) must not wrap to the wrong operating day.
export function transportTime(value) {
  const text = transportCell(value);
  const match = text.match(/^(?:\d{4}[-/.]\d{2}[-/.]\d{2}[T\s]+)?(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  return match && Number(match[1]) < 48 ? `${match[1].padStart(2, "0")}:${match[2]}` : MANUAL_CHECK;
}

export function transportMissingNote(rows, reasons = []) {
  const columns = rows[0] || [];
  const missing = columns.filter((_, index) => rows.slice(1).some(row => String(row[index]).includes(MANUAL_CHECK)));
  const details = [...new Set(reasons.filter(Boolean).map(reason => String(reason).replace(/[\s·.]*수동\s*확인\s*필요[.!]?$/, "").trim()))];
  const fields = missing.length <= 3 ? missing.join("·") : "일부 항목";
  return [missing.length ? `${MANUAL_CHECK}: ${fields}의 공식 자료 미제공 또는 조회 미완료.` : "", ...details].filter(Boolean).join(" / ");
}
