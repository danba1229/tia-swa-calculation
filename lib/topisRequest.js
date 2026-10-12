const ORIGIN = "https://topis.seoul.go.kr";
export const TOPIS_PAGE = `${ORIGIN}/refRoom/openRefRoom_2.do?tab=trafficvolDaily`;
export const TOPIS_MAX_BYTES = 30 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = (value) => typeof value === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(value) ? value : undefined;

// Allowlist diagnostic fields: never serialize request bodies, URLs with secrets,
// raw error messages, response bodies, or database connection strings.
export function networkErrorDetails(error, depth = 0) {
  if (!error || depth > 3) return undefined;
  return {
    name: token(error.name), code: token(error.code), syscall: token(error.syscall),
    cause: networkErrorDetails(error.cause, depth + 1),
    errors: Array.isArray(error.errors) ? error.errors.slice(0, 4).map((e) => networkErrorDetails(e, depth + 1)) : undefined,
  };
}

function codesFrom(detail) {
  if (!detail) return [];
  return [detail.code, ...codesFrom(detail.cause), ...(detail.errors || []).flatMap(codesFrom)].filter(Boolean);
}

function requestError(code, retryable, status) {
  return Object.assign(new Error(code), { code, retryable, status });
}

export async function topisPost(path, params, {
  fetchImpl = fetch, timeout = 60000, binary = false, sleepImpl = sleep,
  retryDelays = [1500, 3000], logger = (entry) => console.log(JSON.stringify(entry)),
} = {}) {
  let last;
  for (let attempt = 1; attempt <= retryDelays.length + 1; attempt++) {
    const started = Date.now();
    let stage = "connect", response, reader, retryAfterMs = 0;
    try {
      response = await fetchImpl(`${ORIGIN}${path}`, {
        method: "POST", body: new URLSearchParams(params), redirect: "error",
        signal: AbortSignal.timeout(timeout),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Referer: TOPIS_PAGE },
      });
      stage = "http";
      if (!response.ok) {
        const header = response.headers.get("retry-after");
        const seconds = header && /^\d+$/.test(header) ? Number(header) : NaN;
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header || "") - Date.now();
        retryAfterMs = Math.min(60000, Math.max(0, delay || 0));
        throw requestError("TOPIS_HTTP", [408, 429].includes(response.status) || response.status >= 500, response.status);
      }
      stage = "body";
      if (Number(response.headers.get("content-length")) > TOPIS_MAX_BYTES) throw requestError("TOPIS_SIZE_LIMIT", false);
      reader = response.body?.getReader();
      if (!reader) throw requestError("TOPIS_EMPTY_BODY", false);
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > TOPIS_MAX_BYTES) throw requestError("TOPIS_SIZE_LIMIT", false);
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      stage = "decode";
      let result;
      try { result = binary ? bytes : JSON.parse(bytes.toString("utf8")); }
      catch { throw requestError("TOPIS_INVALID_JSON", false); }
      logger({ event: "topis_request_success", host: "topis.seoul.go.kr", path, attempt, status: response.status, elapsedMs: Date.now() - started, bytes: length });
      return result;
    } catch (error) {
      if (reader) await reader.cancel().catch(() => {});
      else if (response?.body) await response.body.cancel().catch(() => {});
      const detail = networkErrorDetails(error);
      const codes = [...new Set(codesFrom(detail))];
      const permanentTransport = codes.some((c) => /CERT|TLS|SSL|REDIRECT/.test(c));
      const retryable = error.retryable ?? (!permanentTransport && stage !== "decode");
      const retrying = retryable && attempt <= retryDelays.length;
      const delayMs = retrying ? Math.max(retryDelays[attempt - 1], retryAfterMs) : 0;
      const diagnostic = { event: "topis_request_failure", host: "topis.seoul.go.kr", path, stage, attempt,
        status: response?.status, elapsedMs: Date.now() - started, retryable, retrying, delayMs, error: detail };
      logger(diagnostic);
      const reason = [token(error.code) || codes[0] || token(error.name) || "NETWORK_ERROR", response?.status].filter(Boolean).join(" ");
      last = Object.assign(new Error(`TOPIS 원자료 수집 실패: ${reason} (${stage}, ${attempt}회)`), { retryable, diagnostic, cause: error });
      if (!retrying) throw last;
      await sleepImpl(delayMs);
    }
  }
  throw last;
}
