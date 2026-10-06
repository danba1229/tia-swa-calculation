import { neon } from '@neondatabase/serverless';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

let sql, ready;
export class AccidentBusyError extends Error {
  constructor(message, status = 429, retryAfter = 10) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
async function database() {
  const url = process.env.SEOUL_BUS_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new AccidentBusyError('사고조사 호출 제한 저장소가 연결되지 않았습니다.', 503, 30);
  sql ||= neon(String(url).replace(/^["']|["']$/g, '').trim());
  ready ||= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS accident_query_cache (key TEXT PRIMARY KEY, payload TEXT, expires_at TIMESTAMPTZ)`;
    await sql`CREATE TABLE IF NOT EXISTS accident_query_lease (key TEXT PRIMARY KEY, token TEXT, expires_at TIMESTAMPTZ)`;
    await sql`CREATE TABLE IF NOT EXISTS accident_query_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TIMESTAMPTZ)`;
  })().catch(error => { ready = null; throw error; });
  await ready;
  return sql;
}
export function accidentClientKey(request) {
  const address = request.headers.get('x-vercel-forwarded-for') || (process.env.NODE_ENV !== 'production' ? request.headers.get('x-forwarded-for') : '') || 'unknown';
  return createHash('sha256').update(`tia-accident:${address.split(',')[0].trim()}`).digest('hex');
}
export const accidentStore = {
  async read(key) {
    const q = await database();
    const [row] = await q`SELECT payload FROM accident_query_cache WHERE key=${key} AND expires_at>NOW()`;
    if (!row?.payload) return null;
    try { return JSON.parse(gunzipSync(Buffer.from(row.payload, 'base64'), { maxOutputLength: 20 * 1024 * 1024 }).toString()); }
    catch { return null; }
  },
  async permit(client) {
    const q = await database();
    const hourKey = `client:${client}:${Math.floor(Date.now() / 3600000)}`;
    const dayKey = `global:${Math.floor(Date.now() / 86400000)}`;
    for (const [key, limit] of [[hourKey, 180], [dayKey, 2000]]) {
      const rows = await q`INSERT INTO accident_query_rate (key,count,expires_at) VALUES (${key},1,NOW()+INTERVAL '2 days')
        ON CONFLICT (key) DO UPDATE SET count=accident_query_rate.count+1 WHERE accident_query_rate.count<${limit} RETURNING count`;
      if (!rows.length) throw new AccidentBusyError('사고조사 호출 한도에 도달했습니다. 저장 결과를 이용하거나 나중에 다시 조회해 주세요.', 429, 3600);
    }
    await q`DELETE FROM accident_query_rate WHERE expires_at<NOW()`;
    await q`DELETE FROM accident_query_cache WHERE expires_at<NOW()`;
  },
  async claim(token) {
    const q = await database();
    const rows = await q`INSERT INTO accident_query_lease (key,token,expires_at) VALUES ('global',${token},NOW()+INTERVAL '4 minutes')
      ON CONFLICT (key) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
      WHERE accident_query_lease.expires_at<NOW() RETURNING key`;
    return rows.length === 1;
  },
  async save(key, value) {
    const q = await database();
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 20 * 1024 * 1024) return;
    const payload = gzipSync(data).toString('base64');
    await q`INSERT INTO accident_query_cache (key,payload,expires_at) VALUES (${key},${payload},NOW()+INTERVAL '1 hour')
      ON CONFLICT (key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`;
  },
  async release(token) {
    const q = await database();
    await q`DELETE FROM accident_query_lease WHERE key='global' AND token=${token}`;
  },
};
export async function guardedAccidentSurvey(request, kind, query, loader, store = accidentStore) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new AccidentBusyError('동일 사이트에서 요청해 주세요.', 403, 0);
  const key = createHash('sha256').update(JSON.stringify(['accident-v2', kind, query])).digest('hex');
  const cached = await store.read(key);
  if (cached) return { ...cached, cached: true };
  const token = randomUUID();
  if (!await store.claim(token)) throw new AccidentBusyError('다른 사고조사가 진행 중입니다. 순서를 기다린 뒤 자동 재시도합니다.');
  try {
    const again = await store.read(key);
    if (again) return { ...again, cached: true };
    await store.permit(accidentClientKey(request));
    const value = await loader(query);
    if (!Object.values(value.sections || {}).some(section => section.status === 'error')) {
      try { await store.save(key, value); } catch { /* A completed result remains usable without persistence. */ }
    }
    return value;
  } finally { await store.release(token).catch(() => {}); }
}
