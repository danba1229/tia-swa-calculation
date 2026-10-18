import { createHash } from 'node:crypto';

export const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export function selectSummary(registry, versionId) {
  const plan = registry.plans.find(p => p.versionId === versionId);
  if (!plan?.summary) throw new Error('SUMMARY_NOT_FOUND');
  return plan;
}

export function summaryBlobPath(plan) {
  if (!/^[a-f0-9]{64}$/.test(plan.summary?.sha256 || '')) throw new Error('INVALID_MANIFEST');
  return `tia-plan-summaries-v1/${plan.summary.sha256}.docx`;
}

export async function verifiedSummaryBytes(plan, stream) {
  const expected = plan.summary;
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > 2_000_000) throw new Error('INVALID_SIZE');
  const reader = stream.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > expected.bytes) throw new Error('SIZE_MISMATCH');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (total !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('HASH_MISMATCH');
  return bytes;
}

export function attachmentHeader(name) {
  return `attachment; filename="plan-summary.docx"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
}
