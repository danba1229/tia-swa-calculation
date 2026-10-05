import { REPORT_SOURCE, reportCell } from '../lib/accidentReport';

export default function AccidentReportTables({ tables }) {
  return <div className="accident-report-tables">{tables.map(table => <section className="accident-report" key={table.id}>
    <h3>{table.title}</h3><p className="report-scope">{table.subtitle}</p>
    <div className="table-wrap"><table aria-label={table.title}>
      <colgroup>{table.widths.map((width, i) => <col key={i} style={{ width: `${width / table.widths.reduce((a, b) => a + b, 0) * 100}%` }} />)}</colgroup>
      <thead>{Array.from({ length: table.headerRows }, (_, row) => <tr key={row}>{table.headers.filter(h => h.row === row).map(h => <th key={h.col} scope={h.colSpan > 1 ? 'colgroup' : 'col'} rowSpan={h.rowSpan || 1} colSpan={h.colSpan || 1}>{h.label}</th>)}</tr>)}</thead>
      <tbody>{table.rows.length ? table.rows.map((row, i) => <tr className={row.rate ? 'report-growth' : ''} key={i}>{row.values.map((value, col) => col === 0 ? <th scope="row" key={col}>{value}</th> : <td className={value === null || value === '미수집' ? 'report-unavailable' : ''} key={col}>{reportCell(value, row.rate)}</td>)}</tr>) : <tr><td colSpan={table.widths.length}>{table.empty}</td></tr>}</tbody>
    </table></div>
    <p className="report-source">{REPORT_SOURCE}</p>
    {table.notes.map((note, i) => <p className="report-note" key={i}>{note}</p>)}
  </section>)}</div>;
}
