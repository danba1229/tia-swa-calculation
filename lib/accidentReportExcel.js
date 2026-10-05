import { REPORT_SOURCE } from './accidentReport.js';

// ExcelJS is injected so the large browser writer is loaded only when downloading.
export function buildReportWorkbook(ExcelJS, tables, rawSheets) {
  const book = new ExcelJS.Workbook();
  book.creator = 'TIA Support';
  book.calcProperties.fullCalcOnLoad = true;
  for (const table of tables) {
    const sheet = book.addWorksheet(table.sheet, { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: table.widths.length > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: .3, right: .3, top: .4, bottom: .4, header: .15, footer: .15 } } });
    const columns = table.widths.length, head = 4, body = head + table.headerRows;
    sheet.columns = table.widths.map(width => ({ width }));
    function fullRow(row, text, size = 10, bold = false) {
      sheet.mergeCells(row, 1, row, columns);
      const cell = sheet.getCell(row, 1); cell.value = text;
      cell.font = { name: '맑은 고딕', size, bold };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      const visualLength = [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
      sheet.getRow(row).height = Math.max(22, Math.ceil(visualLength / (table.widths.reduce((a, b) => a + b, 0) * .9)) * 17);
    }
    fullRow(1, table.title, 13, true); fullRow(2, table.subtitle);
    const bottom = body + Math.max(1, table.rows.length) - 1;
    for (let row = head; row <= bottom; row++) {
      sheet.getRow(row).height = row < body ? (table.headerRows === 1 ? 40 : 28) : 30;
      for (let col = 1; col <= columns; col++) {
        const cell = sheet.getCell(row, col);
        cell.font = { name: '맑은 고딕', size: 10, bold: row < body || col === 1 };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.numFmt = '#,##0';
        const line = { style: 'thin', color: { argb: 'FF555555' } };
        cell.border = { top: line, left: line, bottom: line, right: line };
        if (row < body) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      }
    }
    for (const h of table.headers) {
      const row = head + h.row, col = h.col + 1;
      if (h.rowSpan > 1 || h.colSpan > 1) sheet.mergeCells(row, col, row + (h.rowSpan || 1) - 1, col + (h.colSpan || 1) - 1);
      sheet.getCell(row, col).value = h.label;
    }
    table.rows.forEach((record, index) => record.values.forEach((value, col) => {
      const cell = sheet.getCell(body + index, col + 1);
      cell.value = value ?? (record.rate ? '산정 불가' : '—');
      if (record.rate && col > 0 && value !== null) {
        const letter = sheet.getColumn(col + 1).letter, first = `${letter}${body}`, last = `${letter}${body + index - 1}`, span = table.years.at(-1) - table.years[0];
        cell.value = { formula: `IF(AND(COUNT(${first}:${last})=${index},${first}>0),(${last}/${first})^(1/${span})-1,"산정 불가")`, result: value };
        cell.numFmt = '0.00%';
      }
      if (record.rate) cell.font = { name: '맑은 고딕', size: 10, bold: true };
    }));
    if (!table.rows.length) { sheet.mergeCells(body, 1, body, columns); sheet.getCell(body, 1).value = table.empty; }
    let row = bottom + 1;
    fullRow(row++, REPORT_SOURCE);
    for (const note of table.notes) fullRow(row++, note);
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns).letter}${row - 1}`;
    sheet.pageSetup.printTitlesRow = `${head}:${body - 1}`;
  }
  // Original collected values, including casualties and error evidence, remain available.
  for (const [name, rows] of rawSheets) {
    const sheet = book.addWorksheet(name);
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    sheet.columns = keys.map(key => ({ header: key, key, width: /오류|원문|내용|출처/.test(key) ? 55 : 20 }));
    rows.forEach(row => sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value && typeof value === 'object' ? JSON.stringify(value) : value]))));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { name: '맑은 고딕', bold: true };
  }
  return book;
}
