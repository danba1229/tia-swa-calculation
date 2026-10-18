// Dry run by default. An explicit --apply writes only hash-addressed Word
// summaries to the already provisioned PRIVATE Blob store, never originals.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { summaryBlobPath, verifiedSummaryBytes, WORD_TYPE } from '../lib/planDownload.js';

async function main() {
  const auditPath = process.argv[2];
  if (!auditPath) throw new Error('Usage: node scripts/upload_plan_summaries.mjs <chapter2_style_delivery_audit.json> [--apply]');
  const apply = process.argv.includes('--apply');
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  const registry = JSON.parse(await readFile(new URL('../data/plans/registry.json', import.meta.url), 'utf8'));
  const files = [];
  for (const plan of registry.plans.filter(p => p.summary)) {
    const source = audit.files.find(f => f.sha256 === plan.summary.sha256);
    if (!source || path.basename(source.output) !== plan.summary.fileName) throw new Error(`Audit mismatch: ${plan.planId}`);
    const bytes = await readFile(source.output);
    if (bytes.length !== plan.summary.bytes || createHash('sha256').update(bytes).digest('hex') !== plan.summary.sha256) throw new Error(`Hash mismatch: ${plan.planId}`);
    files.push({ plan, bytes });
  }
  console.log(JSON.stringify({ mode: apply ? 'private-upload' : 'dry-run', count: files.length, bytes: files.reduce((n,f)=>n+f.bytes.length,0) }));
  if (!apply) return;
  for (const { plan, bytes } of files) {
    const pathname = summaryBlobPath(plan);
    let metadata;
    try { metadata = await head(pathname); }
    catch (error) { if (error.name !== 'BlobNotFoundError') throw error; }
    if (!metadata) await put(pathname, bytes, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: WORD_TYPE });
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) throw new Error(`Readback failed: ${plan.planId}`);
    await verifiedSummaryBytes(plan, result.stream);
    console.log(JSON.stringify({ planId: plan.planId, verified: true, reused: !!metadata }));
  }
}
main().catch(error => {
  // Never print provider response bodies, URLs or credentials.
  console.error(JSON.stringify({ failed: true, errorClass: error.name, message: /^(Usage:|Audit mismatch:|Hash mismatch:|Readback failed:)/.test(error.message) ? error.message : 'Private summary upload failed. Check storage configuration.' }));
  process.exitCode = 1;
});
