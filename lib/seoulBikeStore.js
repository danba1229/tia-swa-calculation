import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import stations from "../app/seoul-bike-stations.json" with { type: "json" };

export const bundledBikeSnapshot = { schemaVersion: 1, baseMonth: "2025-12", stations,
  source: { filename: "공공자전거 대여소 정보(25.12월 기준).xlsx", url: "https://data.seoul.go.kr/dataList/OA-13252/F/1/datasetView.do" } };
const databaseUrl = () => String(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SEOUL_BUS_DATABASE_URL || process.env.SEOUL_BUS_POSTGRES_URL || "").replace(/^["']|["']$/g, "").trim();
export const isBikeStoreConfigured = () => Boolean(databaseUrl());
let sql, ready, cached, cachedUntil = 0;
async function db() {
  if (!isBikeStoreConfigured()) throw new Error("BIKE_DATABASE_NOT_CONFIGURED");
  sql ||= neon(databaseUrl());
  ready ||= sql`CREATE TABLE IF NOT EXISTS seoul_bike_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1), snapshot JSONB, previous_snapshot JSONB,
    status TEXT NOT NULL DEFAULT 'NEVER_CHECKED', error_code TEXT,
    checked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, lease_token TEXT, lease_until TIMESTAMPTZ
  )`.catch(error => { ready = null; throw error; });
  await ready; return sql;
}
export function usableBikeSnapshot(snapshot) {
  return snapshot?.schemaVersion === 1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.baseMonth)
    && Array.isArray(snapshot.stations) && snapshot.stations.length >= 1000
    && new Set(snapshot.stations.map(s => String(s.stationNumber))).size === snapshot.stations.length
    && snapshot.stations.every(s => s.stationNumber && s.stationName && typeof s.address === "string"
      && Number.isFinite(s.latitude) && s.latitude >= 37.3 && s.latitude <= 37.8
      && Number.isFinite(s.longitude) && s.longitude >= 126.7 && s.longitude <= 127.3
      && (s.rackCount === null || (Number.isInteger(s.rackCount) && s.rackCount >= 0)))
    && Boolean(snapshot.source?.filename);
}
export function selectBikeSnapshot(row) {
  const useStored = usableBikeSnapshot(row?.snapshot) && row.snapshot.baseMonth >= bundledBikeSnapshot.baseMonth;
  const usePrevious = !useStored && usableBikeSnapshot(row?.previous_snapshot) && row.previous_snapshot.baseMonth >= bundledBikeSnapshot.baseMonth;
  return { snapshot: useStored ? row.snapshot : usePrevious ? row.previous_snapshot : bundledBikeSnapshot,
    refresh: { status: row?.snapshot && !usableBikeSnapshot(row.snapshot) ? "INVALID_STORED_DATA" : row?.status || "NEVER_CHECKED",
      checkedAt: row?.checked_at || "", updatedAt: row?.updated_at || "", errorCode: row?.error_code || "",
      storage: useStored ? "DATABASE" : usePrevious ? "PREVIOUS" : "BUNDLED" } };
}
export async function getBikeSnapshot() {
  if (!isBikeStoreConfigured()) return { snapshot: bundledBikeSnapshot, refresh: { status: "NOT_CONFIGURED", storage: "BUNDLED" } };
  if (cached && Date.now() < cachedUntil) return cached;
  try {
    const query = await db();
    const rows = await query`SELECT snapshot, previous_snapshot, status, checked_at, updated_at, error_code FROM seoul_bike_snapshot WHERE id = 1`;
    cached = selectBikeSnapshot(rows[0]); cachedUntil = Date.now() + 60000;
    return cached;
  } catch {
    return { snapshot: cached?.snapshot || bundledBikeSnapshot, refresh: { ...cached?.refresh, status: "STORE_UNAVAILABLE", storage: cached?.refresh?.storage || "BUNDLED" } };
  }
}
export function createBikeSnapshotStore() {
  return {
    async claim() {
      const query = await db(), token = randomUUID();
      const rows = await query`INSERT INTO seoul_bike_snapshot (id, lease_token, lease_until)
        VALUES (1, ${token}, NOW() + INTERVAL '2 minutes')
        ON CONFLICT (id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
        WHERE seoul_bike_snapshot.lease_until IS NULL OR seoul_bike_snapshot.lease_until < NOW() RETURNING lease_token`;
      return rows[0]?.lease_token || null;
    },
    async current() {
      const query = await db();
      const rows = await query`SELECT snapshot, previous_snapshot FROM seoul_bike_snapshot WHERE id = 1`;
      return selectBikeSnapshot(rows[0]).snapshot;
    },
    async finish(token, result) {
      const query = await db(), promote = result.status === "UPDATED";
      if (promote && !usableBikeSnapshot(result.snapshot)) throw new Error("INVALID_SNAPSHOT");
      const payload = promote ? JSON.stringify(result.snapshot) : null;
      const fallback = JSON.stringify(bundledBikeSnapshot);
      // A single atomic statement retains the last successful data; failures never erase it.
      const rows = await query`UPDATE seoul_bike_snapshot SET
        previous_snapshot = CASE WHEN ${promote} THEN COALESCE(snapshot, ${fallback}::jsonb) ELSE previous_snapshot END,
        snapshot = CASE WHEN ${promote} THEN ${payload}::jsonb ELSE snapshot END,
        updated_at = CASE WHEN ${promote} THEN NOW() ELSE updated_at END,
        status = ${result.status}, error_code = ${result.errorCode || null}, checked_at = NOW(),
        lease_token = NULL, lease_until = NULL
        WHERE id = 1 AND lease_token = ${token} AND lease_until > NOW() RETURNING id`;
      cachedUntil = 0; return rows.length === 1;
    },
  };
}
