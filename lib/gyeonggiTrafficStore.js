import { neon } from "@neondatabase/serverless";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { collectGgTraffic, GgTrafficError } from "./gyeonggiTraffic.js";

const TTL = 24 * 60 * 60 * 1000;
let sql, ready, memory, pending, fallback, retryAfter = 0;
async function db() {
  const connection = process.env.TRAFFIC_DATABASE_URL || process.env.SEOUL_BUS_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connection) throw new GgTrafficError("교통량 저장소가 연결되지 않았습니다. DB 환경변수를 확인해 주세요.");
  sql ||= neon(String(connection).replace(/^["']|["']$/g, "").trim());
  ready ||= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS gg_traffic_snapshot (
      id INTEGER PRIMARY KEY CHECK (id=1), packed TEXT, updated_at TIMESTAMPTZ,
      lease_owner TEXT, lease_until TIMESTAMPTZ, last_error TEXT)`;
    await sql`CREATE TABLE IF NOT EXISTS gg_traffic_versions (
      sha256 TEXT PRIMARY KEY, packed TEXT NOT NULL, collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`INSERT INTO gg_traffic_snapshot (id) VALUES (1) ON CONFLICT DO NOTHING`;
  })().catch((error) => { ready = null; throw error; });
  await ready;
  return sql;
}
const fresh = (snapshot) => snapshot && Date.now() - Date.parse(snapshot.collectedAt) < TTL;

async function loadOrCollect() {
  const q = await db();
  const [stored] = await q`SELECT packed, last_error FROM gg_traffic_snapshot WHERE id=1`;
  const saved = stored?.packed ? JSON.parse(gunzipSync(Buffer.from(stored.packed, "base64"), { maxOutputLength: 128 * 1024 * 1024 }).toString("utf8")) : null;
  if (fresh(saved)) { memory = saved; return { snapshot: saved, stale: false }; }
  const owner = randomUUID();
  const lease = await q`UPDATE gg_traffic_snapshot SET lease_owner=${owner}, lease_until=NOW()+INTERVAL '4 minutes'
    WHERE id=1 AND (lease_until IS NULL OR lease_until < NOW()) RETURNING id`;
  if (!lease.length) {
    if (saved) return { snapshot: saved, stale: true, warning: "경기도 원문 갱신 대기 중입니다. 이전 수집자료로 분석합니다." };
    throw new GgTrafficError("경기도 교통량을 최초 수집 중입니다. 잠시 후 저장자료 새로고침을 눌러 주세요.");
  }
  try {
    const snapshot = await collectGgTraffic();
    const packed = gzipSync(JSON.stringify(snapshot)).toString("base64");
    // The lease guards cross-instance collections. Old source versions stay immutable.
    const completed = await q.transaction([
      q`INSERT INTO gg_traffic_versions (sha256, packed) VALUES (${snapshot.sourceSha256},${packed}) ON CONFLICT DO NOTHING`,
      q`UPDATE gg_traffic_snapshot SET packed=${packed},updated_at=NOW(),lease_owner=NULL,lease_until=NULL,last_error=NULL
        WHERE id=1 AND lease_owner=${owner} RETURNING id`,
    ]);
    if (!completed[1].length) throw new GgTrafficError("경기도 수집 잠금이 만료됐습니다. 저장자료를 다시 확인해 주세요.");
    memory = snapshot;
    return { snapshot, stale: false };
  } catch (error) {
    const message = error instanceof GgTrafficError ? error.message : "경기도 교통량 저장에 실패했습니다.";
    retryAfter = Date.now() + 120000;
    await q`UPDATE gg_traffic_snapshot SET lease_owner=NULL,lease_until=NOW()+INTERVAL '2 minutes',last_error=${message}
      WHERE id=1 AND lease_owner=${owner}`;
    if (saved) {
      fallback = { snapshot: saved, stale: true, warning: `${message} 이전 수집자료로 분석합니다.` };
      return fallback;
    }
    throw new GgTrafficError(message);
  }
}

export async function getGgTrafficSnapshot() {
  if (fresh(memory)) return { snapshot: memory, stale: false };
  if (Date.now() < retryAfter) {
    if (fallback) return fallback;
    throw new GgTrafficError("경기도 자료 갱신 실패 후 재시도 대기 중입니다. 2분 후 다시 확인해 주세요.");
  }
  pending ||= loadOrCollect().finally(() => { pending = null; });
  return pending;
}
