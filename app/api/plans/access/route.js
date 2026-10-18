import { planAccess } from '../../../../lib/server/planAccess';
import { PRIVATE_HEADERS } from '../../../../lib/planDownload';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try { const access = await planAccess(request); return Response.json(access, { status: access.status, headers: PRIVATE_HEADERS }); }
  catch { return Response.json({ allowed: false, message: '다운로드 권한 확인에 실패했습니다.' }, { status: 503, headers: PRIVATE_HEADERS }); }
}
