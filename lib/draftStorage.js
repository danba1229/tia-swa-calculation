const currentDrafts = new Map();
const pendingWrites = new Map();
let lastWrite = 0;
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tia-survey-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('저장소가 다른 탭에서 사용 중입니다.'));
  });
}
async function transact(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const request = action(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function readDraft(key) {
  let primary, backup;
  try {
    primary = await transact('readonly', store => store.get(key));
  } catch { /* Read the previous storage format when IndexedDB is unavailable. */ }
  try { backup = JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { if (primary === undefined) throw new Error('저장자료 읽기 실패'); }
  const unwrap = value => value?.draftEnvelope === 1 ? value.value : value;
  if (backup?.draftEnvelope === 1 && (!primary || backup.savedAt > (primary.savedAt || 0))) return unwrap(backup);
  return unwrap(primary ?? backup ?? null);
}
export function rememberDraft(key, value) { currentDrafts.set(key, value); }
export function writeDraft(key, value) {
  rememberDraft(key, value);
  lastWrite = Math.max(Date.now(), lastWrite + 1);
  const envelope = { draftEnvelope: 1, savedAt: lastWrite, value };
  const pending = (pendingWrites.get(key) || Promise.resolve()).catch(() => {}).then(() => persistDraft(key, envelope));
  pendingWrites.set(key, pending);
  return pending;
}
async function persistDraft(key, envelope) {
  try { await transact('readwrite', store => store.put(envelope, key)); return 'saved'; }
  catch {
    try { localStorage.setItem(key, JSON.stringify(envelope)); return 'fallback'; }
    catch { return 'failed'; }
  }
}
export function downloadDraftBackup() {
  const data = { format: 'tia-draft-backup-v1', exportedAt: new Date().toISOString(), drafts: Object.fromEntries(currentDrafts) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `TIA-조사백업-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validateDraftBackup(data) {
  if (data?.format !== 'tia-draft-backup-v1' || !data.drafts || typeof data.drafts !== 'object') throw new Error('TIA 조사 백업 파일이 아닙니다.');
  const main = data.drafts['tia-research-builder-next-v3-kosis'];
  if (!main?.basics || typeof main.basics.siteAddress !== 'string' || !Array.isArray(main.roads)) throw new Error('조사 백업의 기본정보가 올바르지 않습니다.');
  const accident = data.drafts['tia-accident-survey-v1'];
  if (accident && (!accident.form || !Array.isArray(accident.results))) throw new Error('사고조사 백업 형식이 올바르지 않습니다.');
  return data.drafts;
}
