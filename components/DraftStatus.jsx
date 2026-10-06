'use client';
import { downloadDraftBackup, validateDraftBackup } from '../lib/draftStorage';
const labels = { loading: '저장자료 확인 중', saving: '변경사항 저장 중', saved: '이 브라우저에 저장됨', fallback: '보조 저장소에 저장됨', failed: '저장 실패: 백업을 다운로드하고 이 창을 닫지 마세요.' };
export default function DraftStatus({ status, restore }) {
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('백업은 50MB 이하만 복원할 수 있습니다.');
      const drafts = validateDraftBackup(JSON.parse(await file.text()));
      if (window.confirm('현재 화면의 조사 내용을 백업 내용으로 교체할까요?')) restore(drafts);
    } catch (error) { window.alert(error.message || '백업 복원 실패'); }
    event.target.value = '';
  }
  return <div className={`draft-status ${status === 'failed' ? 'draft-error' : ''}`}>
    <span role="status">{labels[status]}</span>
    <button type="button" className="ghost" onClick={downloadDraftBackup}>조사 백업</button>
    {restore && <label className="ghost">백업 복원<input type="file" accept=".json" onChange={upload} /></label>}
  </div>;
}
