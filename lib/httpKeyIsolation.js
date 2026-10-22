// Keys sent to official endpoints that only answer over plain HTTP travel
// unencrypted. Such a key must be dedicated to that one service so a leak
// cannot unlock any other API the app uses over HTTPS.

// Every server-side credential the app reads. A plain-HTTP key may not match
// any of these except the names reserved for the same HTTP service.
export const KNOWN_API_KEY_NAMES = Object.freeze([
  "KAKAO_JS_KEY",
  "KAKAO_REST_API_KEY",
  "KOROAD_API_KEY",
  "KOSIS_API_KEY",
  "SEOUL_BUS_API_KEY",
  "SEOUL_BUS_SERVICE_KEY",
  "SEOUL_SUBWAY_API_KEY",
  "SEOUL_TDATA_API_KEY",
  "GYEONGGI_BUS_STATION_API_KEY",
  "GYEONGGI_BUS_ROUTE_API_KEY",
  "GYEONGGI_BUS_BASE_API_KEY",
  "GG_DATA_DREAM_API_KEY",
  "TAGO_SUBWAY_API_KEY",
  "TIA_DATAGOKR",
  "DATA_GO_KR_SERVICE_KEY",
  "JUSO_SEARCH_CONFM_KEY",
]);

export function normalizeApiKey(value) {
  const raw = String(value ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!raw || raw === "[SENSITIVE]") return "";
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Reads the first configured key among `names` and verifies it is not shared
 * with any other credential. Never returns or reports the key of another name.
 *
 * @returns {{ status: "ok", key: string, name: string } | { status: "missing" | "shared", key: "" }}
 */
export function readDedicatedHttpKey(names, { env = process.env } = {}) {
  const name = names.find((candidate) => normalizeApiKey(env[candidate]));
  if (!name) return { status: "missing", key: "" };
  const key = normalizeApiKey(env[name]);
  if (/^https?:/i.test(key)) return { status: "missing", key: "" };
  const shared = KNOWN_API_KEY_NAMES
    .filter((other) => !names.includes(other))
    .some((other) => normalizeApiKey(env[other]) === key);
  if (shared) return { status: "shared", key: "" };
  return { status: "ok", key, name };
}

export function sharedHttpKeyMessage(primaryName, serviceLabel) {
  return `${primaryName}가 다른 API와 같은 공용 인증키입니다. ${serviceLabel}는 암호화되지 않는 HTTP로만 제공되므로, 이 서비스만을 위해 별도로 발급한 전용 키를 설정해야 조회합니다.`;
}
