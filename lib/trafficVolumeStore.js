import { neon } from "@neondatabase/serverless";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

let sql, ready;
export function trafficDatabaseConfigured() {
  return Boolean(process.env.TRAFFIC_DATABASE_URL || process.env.SEOUL_BUS_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL);
}
async function db() {
  if (!trafficDatabaseConfigured()) throw new Error("교통량 저장소가 연결되지 않았습니다.");
  sql ||= neon(String(process.env.TRAFFIC_DATABASE_URL || process.env.SEOUL_BUS_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL).replace(/^["']|["']$/g, "").trim());
  if (!ready) ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS traffic_volume_months (
      month TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, metadata JSONB NOT NULL,
      packed TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_base64 TEXT NOT NULL,
      source_filename TEXT NOT NULL, collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS traffic_volume_sync (
      id BIGSERIAL PRIMARY KEY, month TEXT NOT NULL, status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS traffic_volume_versions (
      month TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_base64 TEXT NOT NULL,
      source_filename TEXT NOT NULL, metadata JSONB NOT NULL, packed TEXT NOT NULL,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(month, source_sha256))`;
  })().catch((e) => { ready = null; throw e; });
  await ready;
  return sql;
}
export async function listTrafficMonths() {
  const q = await db();
  const months = await q`SELECT month, metadata, collected_at, checked_at FROM traffic_volume_months ORDER BY month DESC`;
  const runs = await q`SELECT DISTINCT ON (month) month, status, note, checked_at FROM traffic_volume_sync ORDER BY month, checked_at DESC, id DESC`;
  return { months: months.map((m) => ({ month: m.month, ...m.metadata, collectedAt: m.collected_at, checkedAt: m.checked_at })), sync: runs };
}
export async function storedTrafficMonth(month, { source = false } = {}) {
  const q = await db();
  const rows = source
    ? await q`SELECT source_base64, source_filename, source_sha256 FROM traffic_volume_months WHERE month=${month}`
    : await q`SELECT fingerprint, packed, metadata, collected_at, checked_at FROM traffic_volume_months WHERE month=${month}`;
  const row = rows[0];
  if (!row) return null;
  if (source) {
    const bytes = Buffer.from(row.source_base64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== row.source_sha256) throw new Error("원본 파일 무결성 검증 실패");
    return { bytes, fileName: row.source_filename };
  }
  return { fingerprint: row.fingerprint, metadata: row.metadata, collectedAt: row.collected_at, checkedAt: row.checked_at,
    data: JSON.parse(gunzipSync(Buffer.from(row.packed, "base64"), { maxOutputLength: 30 * 1024 * 1024 }).toString("utf8")) };
}
export async function recordTrafficSync(month, status, note = "") {
  const q = await db();
  await q`INSERT INTO traffic_volume_sync (month, status, note) VALUES (${month},${status},${note.slice(0, 500)})`;
  if (status === "NO_CHANGE") await q`UPDATE traffic_volume_months SET checked_at=NOW() WHERE month=${month}`;
}
export async function saveTrafficMonth(item, data, bytes) {
  const q = await db();
  const metadata = { points: data.points, rowCount: data.rowCount, missingValues: data.missingValues,
    sourceSha256: data.sourceSha256, fileName: item.fileName, sourceUpdatedAt: item.sourceUpdatedAt,
    sourceUrl: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily" };
  const packed = gzipSync(JSON.stringify(data)).toString("base64");
  const source = bytes.toString("base64");
  // Immutable source versions remain available even after an official correction.
  await q.transaction([
    q`INSERT INTO traffic_volume_versions (month, source_sha256, source_base64, source_filename, metadata, packed)
      VALUES (${item.month},${data.sourceSha256},${source},${item.fileName},${JSON.stringify(metadata)}::jsonb,${packed}) ON CONFLICT DO NOTHING`,
    q`INSERT INTO traffic_volume_months (month,fingerprint,metadata,packed,source_sha256,source_base64,source_filename)
      VALUES (${item.month},${item.fingerprint},${JSON.stringify(metadata)}::jsonb,${packed},${data.sourceSha256},${source},${item.fileName})
      ON CONFLICT(month) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,metadata=EXCLUDED.metadata,
      packed=EXCLUDED.packed,source_sha256=EXCLUDED.source_sha256,source_base64=EXCLUDED.source_base64,
      source_filename=EXCLUDED.source_filename,collected_at=NOW(),checked_at=NOW()`,
    q`INSERT INTO traffic_volume_sync (month,status) VALUES (${item.month},'UPDATED')`,
  ]);
}
