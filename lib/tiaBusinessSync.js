import { buildApiUrl, configuredEndpoints, extractItems, normalizeProject, readFirstEnv, readTotalCount, rawProjectKey } from "./tiaApi.js";
import { ensureTiaSchema, saveTiaSyncPeriod, upsertTiaProjects } from "./tiaDatabase.js";

async function requestJson(url, label) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} 호출 실패(${response.status})`);
  }
  if (text.trim().startsWith("<")) {
    throw new Error(`${label} 응답이 JSON이 아닙니다.`);
  }
  const payload = JSON.parse(text);
  const code = payload?.response?.header?.resultCode;
  if (code != null && !["00", "0", "0000"].includes(String(code))) throw new Error(`${label} 오류 응답`);
  return payload;
}

async function requestPage(url, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await requestJson(url, label); }
    catch { if (attempt === 1) throw new Error(`${label} 페이지 재시도 실패`); }
  }
}

function systemEndpoint() {
  return configuredEndpoints().find((endpoint) => endpoint.source === "TIA_SYSTEM_API");
}

function toDateText(value) {
  return String(value || "").replace(/-/g, "").trim();
}

export async function collectTiaBusinessPeriod({
  startDate,
  endDate,
  maxPages = 250,
  concurrency = 8,
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('수집 페이지 또는 동시 요청 설정이 올바르지 않습니다.');
  const serviceKey = readFirstEnv(["DATA_GO_KR_SERVICE_KEY", "TIA_DATAGOKR"]);
  const endpoint = systemEndpoint();
  if (!serviceKey || !endpoint) {
    throw new Error("TIA_DATAGOKR와 TIA_SYSTEM_API_BASE_URL/TIA_SYSTEM_API_OPERATION_PATH 환경변수가 필요합니다.");
  }

  const criteria = {
    startYear: "",
    endYear: "",
  };
  const baseUrl = buildApiUrl(endpoint, criteria, serviceKey);
  baseUrl.searchParams.set("numOfRows", "1");
  baseUrl.searchParams.set("resultType", "JSON");
  if (startDate) baseUrl.searchParams.set("reqstDdSt", toDateText(startDate));
  if (endDate) baseUrl.searchParams.set("reqstDdEd", toDateText(endDate));

  const seen = new Set();
  const rawItems = [];
  const pages = [];
  const failedPages = [];

  function pageUrl(pageNo) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("pageNo", String(pageNo));
    return url;
  }

  const firstPayload = await requestPage(pageUrl(1), endpoint.label);
  const totalCount = readTotalCount(firstPayload);
  const requestedPages = Math.min(Math.max(1, totalCount || 1), maxPages);

  function addPayload(payload, pageNo) {
    const items = extractItems(payload);
    let addedCount = 0;
    for (const item of items) {
      const key = rawProjectKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      rawItems.push(item);
      addedCount += 1;
    }
    pages.push({ pageNo, responseItemCount: items.length, addedCount, totalCount: readTotalCount(payload) });
  }

  addPayload(firstPayload, 1);

  for (let startPage = 2; startPage <= requestedPages; startPage += concurrency) {
    const pageNumbers = Array.from(
      { length: Math.min(concurrency, requestedPages - startPage + 1) },
      (_, index) => startPage + index,
    );
    const settled = await Promise.allSettled(pageNumbers.map(async (pageNo) => ({
      pageNo,
      payload: await requestPage(pageUrl(pageNo), endpoint.label),
    })));
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") addPayload(result.value.payload, result.value.pageNo);
      else failedPages.push(pageNumbers[index]);
    }
  }

  let stable = false;
  try {
    const final = await requestPage(pageUrl(1), endpoint.label);
    stable = readTotalCount(final) === totalCount && JSON.stringify(extractItems(final).map(rawProjectKey)) === JSON.stringify(extractItems(firstPayload).map(rawProjectKey));
  } catch { failedPages.push(1); }
  return {
    projects: rawItems.map((item, index) => normalizeProject(item, index, "TIA_SYSTEM_API")),
    totalCount,
    requestedPages,
    complete: stable && totalCount !== null && totalCount <= maxPages && !failedPages.length
      && rawItems.length === totalCount && pages.every(p => p.totalCount === totalCount),
    failedPages,
    pages,
  };
}

export async function syncTiaBusinessPeriod(options = {}) {
  await ensureTiaSchema();
  const result = await collectTiaBusinessPeriod(options);
  const syncedCount = await upsertTiaProjects(result.projects);
  const summary = {
    startDate: options.startDate,
    endDate: options.endDate,
    status: result.complete ? "SUCCESS" : "PARTIAL",
    totalCount: result.totalCount,
    requestedPages: result.requestedPages,
    complete: result.complete,
    syncedCount,
    error: result.complete ? "" : `수집 불완전: ${syncedCount}/${result.totalCount ?? '미확인'}건, 실패 페이지 ${result.failedPages.join(', ') || '없음'} (중복·총건수·조회한도 확인 필요)`,
    failedPages: result.failedPages,
  };
  await saveTiaSyncPeriod(summary);
  return { ...summary, pageSamples: result.pages.slice(0, 5) };
}

export function defaultSyncPeriod() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const fmt = (date) => date.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}
