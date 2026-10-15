import { sinCatalog, sinTimetable, korailTimetable } from '../../../../lib/operatorSubway.js';
import { getGitsCatalog } from '../../../../lib/gitsTraffic.js';
import { transportCacheConfigured } from '../../../../lib/transportCache.js';
export const maxDuration = 180;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!transportCacheConfigured()) return Response.json({ success: false, status: 'NOT_CONFIGURED' }, { status: 503 });
  const results = [];
  async function run(name, task) {
    try {
      const result = await task();
      const success = !result.cacheInfo?.stale && result.cacheInfo?.storage === 'DATABASE';
      results.push({ name, success, checkedAt: result.checkedAt || result.cacheInfo?.updatedAt, status: success ? 'SUCCESS' : 'STALE_OR_NOT_PERSISTED' });
      return result;
    } catch { results.push({ name, success: false, status: 'FAILED_PREVIOUS_DATA_RETAINED' }); return null; }
  }
  await Promise.all([
    run('GITS 공개 연도·지점 목록', getGitsCatalog),
    run('코레일 수인분당선', korailTimetable),
    (async () => {
      const catalog = await run('신분당선 역 목록', sinCatalog);
      for (let i = 0; i < (catalog?.stations.length || 0); i += 3) await Promise.all(catalog.stations.slice(i, i + 3).map(entry => run(`신분당선 ${entry.name}`, () => sinTimetable(entry))));
    })(),
  ]);
  const success = results.every(r => r.success);
  return Response.json({ success, results }, { status: success ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
