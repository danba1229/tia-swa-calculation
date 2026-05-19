export function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
}
