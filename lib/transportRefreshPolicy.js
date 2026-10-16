// Shared by server caches and browser retry decisions; no server-only imports.
export function nextTransportMonth(now = Date.now()) {
  const date = new Date(now);
  // Refresh on the first request after the fifth day, 04:00 KST, every month.
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 4, 19);
  return next > now ? next : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 4, 19);
}

export function isCurrentTransportMonth(checkedAt, now = Date.now()) {
  return Number.isFinite(checkedAt) && checkedAt <= now && now < nextTransportMonth(checkedAt);
}
