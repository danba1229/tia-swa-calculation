import { neon } from "@neondatabase/serverless";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const local = new Map();
let query, ready;
const databaseUrl = () => String(process.env.SEOUL_BUS_DATABASE_URL || process.env.SEOUL_BUS_POSTGRES_URL || "").replace(/^["']|["']$/g, "").trim();
export const transportCacheConfigured = () => Boolean(databaseUrl()) && databaseUrl() !== "[SENSITIVE]";
export function nextTransportMonth(now = Date.now()) {
  const date = new Date(now);
  // Refresh on the first request after the fifth day, 04:00 KST, every month.
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 4, 19);
  return next > now ? next : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 4, 19);
}
export function packTransport(value) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 45000000) throw new Error("교통자료 캐시 크기 초과");
  return gzipSync(json).toString("base64");
}
export function unpackTransport(value) {
  return JSON.parse(gunzipSync(Buffer.from(value, "base64"), { maxOutputLength: 45000000 }).toString("utf8"));
}
async function db() {
  if (!transportCacheConfigured()) return null;
  query ||= neon(databaseUrl());
  if (!ready) ready = query`CREATE TABLE IF NOT EXISTS transport_response_cache (
    cache_key TEXT PRIMARY KEY, payload TEXT, expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ, lease_token TEXT, lease_until TIMESTAMPTZ,
    retry_after TIMESTAMPTZ
  )`.catch((error) => { ready = null; throw error; });
  await ready;
  return query;
}
export const transportDatabaseStore = {
  async read(key) {
    const sql = await db();
    if (!sql) return null;
    const rows = await sql`SELECT payload, expires_at, updated_at, retry_after FROM transport_response_cache WHERE cache_key=${key}`;
    const row = rows[0];
    let value = null;
    try { value = row?.payload ? unpackTransport(row.payload) : null; } catch { /* A corrupt cache is replaced, never returned. */ }
    return row ? { value, expires: new Date(row.expires_at).getTime(),
      updated: new Date(row.updated_at).getTime(), retry: new Date(row.retry_after).getTime() } : null;
  },
  async claim(key, token) {
    const sql = await db();
    const rows = await sql`INSERT INTO transport_response_cache (cache_key, lease_token, lease_until)
      VALUES (${key}, ${token}, NOW() + INTERVAL '90 seconds')
      ON CONFLICT (cache_key) DO UPDATE SET lease_token=EXCLUDED.lease_token, lease_until=EXCLUDED.lease_until
      WHERE (transport_response_cache.lease_until IS NULL OR transport_response_cache.lease_until < NOW())
        AND (transport_response_cache.retry_after IS NULL OR transport_response_cache.retry_after < NOW())
      RETURNING cache_key`;
    return rows.length === 1;
  },
  async save(key, token, value, expires) {
    const sql = await db();
    const packed = packTransport(value);
    const rows = await sql`UPDATE transport_response_cache SET payload=${packed}, expires_at=${new Date(expires).toISOString()},
      updated_at=NOW(), retry_after=NULL, lease_token=NULL, lease_until=NULL
      WHERE cache_key=${key} AND lease_token=${token} AND lease_until > NOW() RETURNING cache_key`;
    return rows.length === 1;
  },
  async fail(key, token) {
    const sql = await db();
    await sql`UPDATE transport_response_cache SET lease_token=NULL, lease_until=NULL, retry_after=NOW()+INTERVAL '5 minutes'
      WHERE cache_key=${key} AND lease_token=${token}`;
  },
};

// The factory makes concurrency, stale fallback and failed refresh testable without a live DB.
export function createPersistentTransportCache({ store, memory = new Map(), now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return async function cached(key, loader, { ttl, valid = () => true, complete = () => true, staleMs = 45 * 86400000 } = {}) {
    const hash = createHash("sha256").update(`transport-v2:${key}`).digest("hex");
    const old = memory.get(hash);
    if (old?.until > now()) return old.promise;
    const entry = { until: now() + 60000 };
    const run = async () => {
      let saved, activeStore = store;
      try { saved = await activeStore?.read(hash); } catch { activeStore = null; }
      const usable = saved?.value != null && valid(saved.value);
      const annotate = (value, storage, stale = false, updated = saved?.updated) => value && typeof value === "object" && !Array.isArray(value)
        ? { ...value, cacheInfo: { storage, stale, updatedAt: updated ? new Date(updated).toISOString() : "" } } : value;
      if (usable && saved.expires > now()) {
        entry.until = Math.min(saved.expires, now() + 300000);
        return annotate(saved.value, "DATABASE");
      }
      const stale = usable && now() - saved.updated < staleMs;
      if (saved?.retry > now()) {
        if (stale) return annotate(saved.value, "DATABASE", true);
        throw new Error("교통자료 재조회 대기 중입니다. 잠시 후 다시 시도해 주세요.");
      }
      const token = randomUUID();
      let claimed = false;
      if (activeStore) {
        try { claimed = await activeStore.claim(hash, token); } catch { activeStore = null; }
        if (activeStore && !claimed) {
          if (stale) return annotate(saved.value, "DATABASE", true);
          for (let i = 0; i < 8; i++) {
            await sleep(500);
            const other = await activeStore.read(hash);
            if (other?.value != null && other.expires > now() && valid(other.value)) return annotate(other.value, "DATABASE", false, other.updated);
          }
          throw new Error("다른 요청에서 교통자료를 갱신 중입니다. 잠시 후 다시 조회해 주세요.");
        }
      }
      try {
        const result = await loader();
        if (!valid(result)) throw new Error("교통자료 응답 검증 실패");
        const expires = complete(result) ? (ttl ? now() + ttl : nextTransportMonth(now())) : now() + 300000;
        // Never replace a previous good result with a failed/partial refresh.
        if (!complete(result) && stale) {
          if (activeStore && claimed) await activeStore.fail(hash, token);
          return annotate(saved.value, "DATABASE", true);
        }
        let persisted = false;
        if (activeStore && claimed) {
          try { persisted = await activeStore.save(hash, token, result, expires); } catch { /* keep valid live data */ }
        }
        entry.until = Math.min(expires, now() + 300000);
        return annotate(result, persisted ? "DATABASE" : "MEMORY", false, now());
      } catch (error) {
        if (activeStore && claimed) { try { await activeStore.fail(hash, token); } catch { /* preserve original error */ } }
        if (stale) return annotate(saved.value, "DATABASE", true);
        throw error;
      }
    };
    entry.promise = run().catch((error) => { entry.until = now() + 30000; throw error; });
    if (memory.size >= 300) memory.delete(memory.keys().next().value);
    memory.set(hash, entry);
    return entry.promise;
  };
}
export function persistentTransport(key, loader, options) {
  return shared(key, loader, options);
}
const shared = createPersistentTransportCache({
  store: {
    read: (key) => transportCacheConfigured() ? transportDatabaseStore.read(key) : Promise.resolve(null),
    claim: (key, token) => transportCacheConfigured() ? transportDatabaseStore.claim(key, token) : Promise.reject(new Error("NO_STORE")),
    save: (...args) => transportDatabaseStore.save(...args), fail: (...args) => transportDatabaseStore.fail(...args),
  }, memory: local,
});
