import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import bundled from "../data/seoul-bus-snapshot.json" with { type: "json" };

let sql, ready, cached, cachedUntil = 0;
const databaseUrl = () => String(process.env.SEOUL_BUS_DATABASE_URL || process.env.SEOUL_BUS_POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || "").replace(/^["']|["']$/g, "").trim();
export const isBusStoreConfigured = () => Boolean(databaseUrl());
async function db() {
  if (!isBusStoreConfigured()) throw new Error("BUS_DATABASE_NOT_CONFIGURED");
  sql ||= neon(databaseUrl());
  if (!ready) {
    ready = sql`CREATE TABLE IF NOT EXISTS seoul_bus_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1), snapshot JSONB, previous_snapshot JSONB,
      status TEXT NOT NULL DEFAULT 'NEVER_CHECKED', error_code TEXT,
      checked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      lease_token TEXT, lease_until TIMESTAMPTZ
    )`.catch(error=>{ ready = null; throw error; });
  }
  await ready;
  return sql;
}

function usable(snapshot) {
  return snapshot?.schemaVersion === 1 && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.baseDate)
    && Array.isArray(snapshot.stations) && snapshot.stations.length >= 1000
    && snapshot.stations.every(s=>s.id && s.stationId && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
      && Array.isArray(s.routes) && s.routes.every(r=>r.busRouteId && r.routeName))
    && Array.isArray(snapshot.sources) && snapshot.sources.length === 2;
}
export function selectBusSnapshot(row) {
  const useStored = usable(row?.snapshot) && row.snapshot.baseDate >= bundled.baseDate;
  return {
    snapshot: useStored ? row.snapshot : bundled,
    refresh: { status: row?.snapshot && !usable(row.snapshot) ? "INVALID_STORED_DATA" : row?.status || "NEVER_CHECKED",
      checkedAt: row?.checked_at || "", updatedAt: row?.updated_at || "", errorCode: row?.error_code || "",
      storage: useStored ? "DATABASE" : "BUNDLED", automatic: Boolean(process.env.CRON_SECRET) },
  };
}
export async function getBusSnapshot() {
  if (!isBusStoreConfigured()) return { snapshot: bundled, refresh: { status: "NOT_CONFIGURED", storage: "BUNDLED", automatic: false } };
  if (cached && Date.now() < cachedUntil) return cached;
  try {
    const query = await db();
    const rows = await query`SELECT snapshot, status, checked_at, updated_at, error_code FROM seoul_bus_snapshot WHERE id = 1`;
    cached = selectBusSnapshot(rows[0]); cachedUntil = Date.now() + 60000;
    return cached;
  } catch {
    return { snapshot: cached?.snapshot || bundled,
      refresh: { ...cached?.refresh, status: "STORE_UNAVAILABLE", automatic: false, storage: cached?.refresh?.storage || "BUNDLED" } };
  }
}

export function createBusSnapshotStore() {
  return {
    async claim() {
      const query = await db(), token = randomUUID();
      const rows = await query`INSERT INTO seoul_bus_snapshot (id, lease_token, lease_until)
        VALUES (1, ${token}, NOW() + INTERVAL '2 minutes')
        ON CONFLICT (id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
        WHERE seoul_bus_snapshot.lease_until IS NULL OR seoul_bus_snapshot.lease_until < NOW()
        RETURNING lease_token`;
      return rows[0]?.lease_token || null;
    },
    async current() {
      const query = await db();
      const rows = await query`SELECT snapshot FROM seoul_bus_snapshot WHERE id = 1`;
      return selectBusSnapshot(rows[0]).snapshot;
    },
    async finish(token, result) {
      const query = await db();
      // Promote the complete pair in one statement; retain the prior successful version.
      const promote = result.status === "UPDATED";
      const payload = promote ? JSON.stringify(result.snapshot) : null;
      const rows = await query`UPDATE seoul_bus_snapshot SET
        previous_snapshot = CASE WHEN ${promote} THEN snapshot ELSE previous_snapshot END,
        snapshot = CASE WHEN ${promote} THEN ${payload}::jsonb ELSE snapshot END,
        updated_at = CASE WHEN ${promote} THEN NOW() ELSE updated_at END,
        status = ${result.status}, error_code = ${result.errorCode || null}, checked_at = NOW(),
        lease_token = NULL, lease_until = NULL
        WHERE id = 1 AND lease_token = ${token} AND lease_until > NOW()
        RETURNING id`;
      cachedUntil = 0;
      return rows.length === 1;
    },
  };
}
