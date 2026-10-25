import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTiaBusinessPeriod, dailySyncPeriods } from '../lib/tiaBusinessSync.js';
import { assessStoredCoverage } from '../lib/tiaCoverage.js';

const month = (year, m) => {
  const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  return { start_date: `${year}-${String(m).padStart(2, '0')}-01`, end_date: end };
};

test('daily sync covers the current and previous month and rotates through every older month', () => {
  const first = dailySyncPeriods(new Date('2026-10-25T18:00:00Z'));
  assert.deepEqual(first.slice(0, 2), [{ startDate: '2026-10-01', endDate: '2026-10-31' }, { startDate: '2026-09-01', endDate: '2026-09-30' }]);
  assert.equal(first.length, 6);
  // Simulate daily runs across a month boundary: each run marks its months synced.
  const lastSynced = new Map(), seen = new Set();
  for (let day = 0; day < 18; day++) {
    const now = new Date(Date.UTC(2026, 9, 25 + day, 18));
    for (const period of dailySyncPeriods(now, { lastSynced })) { seen.add(period.startDate); lastSynced.set(period.startDate, now.toISOString()); }
  }
  // 2021-01 .. 2026-09 is 69 older months by November; 4 per day cover them all within 18 days.
  for (let y = 2021; y <= 2026; y++) for (let m = 1; m <= (y === 2026 ? 9 : 12); m++) assert.ok(seen.has(`${y}-${String(m).padStart(2, '0')}-01`), `${y}-${m}`);
  const never = dailySyncPeriods(new Date('2026-10-25T18:00:00Z'), { lastSynced: new Map([['2021-01-01', '2026-10-24T00:00:00Z']]) });
  assert.equal(never[2].startDate, '2021-02-01', 'never-synced months go before recently synced ones');
  assert.deepEqual(dailySyncPeriods(new Date('2021-01-15T00:00:00Z'), { startYear: 2021 }).length, 2);
});

test('coverage accepts older months synced within 45 days but needs recent months within 2 days', () => {
  const now = Date.parse('2026-10-25T20:00:00Z'), criteria = { startYear: 2026, endYear: 2026 };
  const base = { collector_version: 2, complete: true, status: 'SUCCESS' };
  const rows = Array.from({ length: 10 }, (_, i) => ({ ...base, ...month(2026, i + 1), synced_at: i < 8 ? '2026-10-01T00:00:00Z' : '2026-10-25T18:00:00Z' }));
  assert.equal(assessStoredCoverage(rows, criteria, now), true);
  assert.equal(assessStoredCoverage(rows.map((r, i) => i === 9 ? { ...r, synced_at: '2026-10-22T00:00:00Z' } : r), criteria, now), false, 'stale current month');
  assert.equal(assessStoredCoverage(rows.map((r, i) => i === 0 ? { ...r, synced_at: '2026-08-01T00:00:00Z' } : r), criteria, now), false, 'older month past 45 days');
  assert.equal(assessStoredCoverage(rows.filter((_, i) => i !== 4), criteria, now), false, 'missing month');
});

test('sync paging handles multi-row pages and rejects repeated rows within a page', async () => {
  const original = globalThis.fetch, names = ['DATA_GO_KR_SERVICE_KEY', 'TIA_SYSTEM_API_BASE_URL', 'TIA_SYSTEM_API_OPERATION_PATH'];
  const old = names.map(n => process.env[n]);
  process.env.DATA_GO_KR_SERVICE_KEY = 'test'; process.env.TIA_SYSTEM_API_BASE_URL = 'https://example.invalid/'; process.env.TIA_SYSTEM_API_OPERATION_PATH = 'businessSearch';
  try {
    for (const repeat of [false, true]) {
      const requested = [];
      globalThis.fetch = async url => {
        const u = new URL(url), page = Number(u.searchParams.get('pageNo')), size = Number(u.searchParams.get('numOfRows'));
        requested.push(page);
        const ids = Array.from({ length: Math.max(0, Math.min(size, 250 - (page - 1) * size)) }, (_, i) => (page - 1) * size + i + 1);
        return Response.json({ totalCount: 250, items: ids.map(id => ({ bsnsNo: String(repeat ? page : id), bsnsNm: 'sample', rno: String(id) })) });
      };
      const result = await collectTiaBusinessPeriod({ startDate: '2026-10-01', endDate: '2026-10-31', pageSize: 100 });
      assert.equal(result.requestedPages, 3);
      assert.ok(!requested.some(page => page > 3));
      assert.equal(result.complete, !repeat);
      assert.equal(result.projects.length, repeat ? 3 : 250);
    }
  } finally { globalThis.fetch = original; names.forEach((n, i) => { if (old[i] == null) delete process.env[n]; else process.env[n] = old[i]; }); }
});
