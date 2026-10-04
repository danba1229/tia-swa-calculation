export const MANUAL_TRANSPORT = "미제공 · 수동 확인 필요";
const cache = new Map();

export function transportKey(name) {
  const value = process.env[name]?.trim().replace(/^["']|["']$/g, "");
  if (!value || value === "[SENSITIVE]" || /^https?:/i.test(value)) throw new Error(`${name} 설정을 확인해 주세요.`);
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function transportJson(base, params, keyName, keyParam = "serviceKey", timeoutMs = 10000) {
  const url = new URL(base);
  url.searchParams.set(keyParam, transportKey(keyName));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    // Upstream errors may contain a credential-bearing URL. Never forward them.
    throw new Error(`${keyName.replace(/_API_KEY$/, "")} API 연결 또는 응답 형식 오류`);
  }
}

export function cachedTransport(key, loader, ttl = 3600000) {
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.promise;
  if (cache.size >= 300) cache.delete(cache.keys().next().value);
  const promise = Promise.resolve().then(loader).catch((error) => { cache.delete(key); throw error; });
  cache.set(key, { promise, expires: Date.now() + ttl });
  return promise;
}

export const arrayItems = (value) => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
export const inTransportBounds = (lat, lng, b) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
export function intervalRange(a, b = a) {
  const values = [Number(a), Number(b)].filter((n) => Number.isFinite(n) && n > 0 && n <= 1440);
  if (!values.length) return "";
  return `${Math.min(...values)}${Math.max(...values) !== Math.min(...values) ? `~${Math.max(...values)}` : ""}분`;
}
