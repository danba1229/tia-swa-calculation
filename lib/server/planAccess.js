import { readSession } from '../indicatorAuth';
import { findUser } from '../indicatorBlob';
import { isPlanUserApproved } from '../planDownload';

export async function planAccess(request) {
  const session = readSession(request);
  if (!session) return { allowed: false, status: 401, message: '계산기 계정으로 로그인해 주세요.' };
  const ids = process.env.TIA_PLAN_APPROVED_USER_IDS || '';
  if (!ids.split(',').map(s => s.trim()).includes(session.userId)) {
    return { allowed: false, status: 403, message: 'Word 다운로드는 별도로 승인된 사용자만 가능합니다.' };
  }
  const record = await findUser(session.username);
  const allowed = isPlanUserApproved(session, record, ids);
  return { allowed, status: allowed ? 200 : 403, message: allowed ? 'Word 다운로드 승인됨' : '계정의 다운로드 권한을 확인해 주세요.' };
}
