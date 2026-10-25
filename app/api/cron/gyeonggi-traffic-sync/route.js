import { refreshGgTrafficSnapshot } from '../../../../lib/gyeonggiTrafficStore.js';
export const maxDuration = 180;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await refreshGgTrafficSnapshot();
    return Response.json({ success: !result.stale, stale: result.stale, warning: result.warning || '', collectedAt: result.snapshot?.collectedAt }, { status: result.stale ? 503 : 200 });
  } catch { return Response.json({ success: false, status: 'REFRESH_FAILED' }, { status: 503 }); }
}
