import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { selectSigns, signScope } from '../trafficSigns.js';

let snapshot;
export async function loadSignSnapshot() {
  if (!snapshot) snapshot = (async () => {
    const directory = path.join(process.cwd(), 'data', 'signs');
    const [compressed, metadata] = await Promise.all([readFile(path.join(directory, 'seoul-signs.json.gz')), readFile(path.join(directory, 'manifest.json'), 'utf8')]);
    const manifest = JSON.parse(metadata);
    if (createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) throw new Error('표지판 자료 무결성 확인에 실패했습니다.');
    return { rows: JSON.parse(gunzipSync(compressed).toString('utf8')), manifest };
  })().catch(error => { snapshot = undefined; throw error; });
  return snapshot;
}

export async function querySeoulSigns(input) {
  const scope = signScope(input);
  const { rows, manifest } = await loadSignSnapshot();
  return { scope, points: selectSigns(rows, scope), manifest };
}
