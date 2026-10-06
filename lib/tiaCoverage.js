export function assessStoredCoverage(periods, criteria, now = Date.now()) {
  const first = Number(criteria.startYear), last = Number(criteria.endYear);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) return false;
  let cursor = Date.UTC(first, 0, 1);
  const end = Math.min(Date.UTC(last + 1, 0, 1), Date.parse(new Date(now).toISOString().slice(0, 10)) + 86400000);
  if (cursor >= end) return false;
  const usable = periods.filter(p => p.collector_version === 2 && p.complete && p.status === 'SUCCESS'
    && now - Date.parse(p.synced_at) < 7 * 86400000 && now >= Date.parse(p.synced_at))
    .map(p => [Date.parse(p.start_date), Date.parse(p.end_date) + 86400000]).sort((a, b) => a[0] - b[0]);
  for (const [start, stop] of usable) {
    if (start > cursor) break;
    if (stop > cursor) cursor = stop;
    if (cursor >= end) return true;
  }
  return false;
}

export function mergeStoredAndLive(stored, live) {
  const rows = new Map();
  for (const project of [...stored, ...live]) {
    const key = project.id && !/^TIA_.*-\d+$/.test(project.id) ? project.id : `${project.projectName}|${project.location}`;
    rows.set(key, project);
  }
  return [...rows.values()];
}
