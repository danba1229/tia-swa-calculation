import { createHash } from 'node:crypto';

export const sourceDigest = value => createHash('sha256').update(value).digest('hex');
export function plainHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
export const htmlRows = table => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plainHtml(cell[1])));
export async function officialBytes(url, { fetchImpl = fetch, limit = 8 * 1024 * 1024, timeout = 15000, ...options } = {}) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout), ...options });
  if (!response.ok) throw new Error('공식 자료 연결 실패');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('공식 자료 크기 초과'); }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks), headers: response.headers };
}
