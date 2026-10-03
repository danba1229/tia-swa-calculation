import { normalizeGeocodeAddress, selectPreciseAddress, GEOCODE_SYSTEM_ERRORS } from "./projectGeocode.js";

export function createKakaoAddressLookup({ fetchImpl = fetch, getApiKey = () => process.env.KAKAO_REST_API_KEY, now = Date.now } = {}) {
  const cache = new Map();
  return async function lookup(address, { timeoutMs = 5000 } = {}) {
    const query = String(address || "").trim();
    if (!query) return { success: false, code: "EMPTY_ADDRESS", message: "주소가 비어 있습니다." };
    const apiKey = String(getApiKey() || "").replace(/^["']|["']$/g, "").trim();
    if (!apiKey) return { success: false, code: "MISSING_API_KEY", message: "KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다." };
    const cached = cache.get(query);
    if (cached?.expiresAt > now()) return cached.result;
    const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
    url.searchParams.set("query", query);
    url.searchParams.set("analyze_type", "exact");
    url.searchParams.set("size", "30");
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `KakaoAK ${apiKey}` }, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
      });
      if (!response.ok) {
        const auth = response.status === 401 || response.status === 403;
        return {
          success: false, status: response.status,
          code: auth ? "AUTH_ERROR" : response.status === 429 ? "RATE_LIMITED" : "API_ERROR",
          message: auth ? "카카오 API 인증키 오류가 발생했습니다."
            : response.status === 429 ? "카카오 API 호출 한도를 초과했습니다. 잠시 후 다시 검색해 주세요." : "카카오 API 호출에 실패했습니다.",
        };
      }
      let payload;
      try { payload = await response.json(); }
      catch { return { success: false, code: "INVALID_RESPONSE", message: "카카오 주소검색 응답 형식 오류" }; }
      const result = selectPreciseAddress(query, payload?.documents, payload?.meta?.total_count);
      // Do not persist failures: addresses and upstream availability can change.
      if (result.success) {
        if (cache.size >= 500) cache.delete(cache.keys().next().value);
        cache.set(query, { result, expiresAt: now() + 600000 });
      }
      return result;
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      return { success: false, code: timeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: timeout ? "카카오 주소검색 응답 시간이 초과되었습니다." : "카카오 주소검색 연결 실패. 다시 검색해 주세요." };
    }
  };
}

export const lookupKakaoAddress = createKakaoAddressLookup();

export async function geocodeAddress(address) {
  const original = String(address || "").trim();
  let result = await lookupKakaoAddress(original);
  const normalized = normalizeGeocodeAddress(original);
  if (!result.success && !GEOCODE_SYSTEM_ERRORS.has(result.code) && normalized !== original) {
    result = await lookupKakaoAddress(normalized);
  }
  return result;
}
