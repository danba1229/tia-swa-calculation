import { buildApiUrl, configuredEndpoints, extractItems, normalizeProject, readFirstEnv, readTotalCount, rawProjectKey } from "./tiaApi.js";
import { ensureTiaSchema, saveTiaSyncPeriod, upsertTiaProjects } from "./tiaDatabase.js";

async function requestJson(url, label) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} 호출 실패(${response.status}): ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  if (text.trim().startsWith("<")) {
    throw new Error(`${label} 응답이 JSON이 아닙니다.`);
  }
  return JSON.parse(text);
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

  function pageUrl(pageNo) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("pageNo", String(pageNo));
    return url;
  }

  const firstPayload = await requestJson(pageUrl(1), endpoint.label);
  const totalCount = readTotalCount(firstPayload) || 0;
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
    pages.push({ pageNo, responseItemCount: items.length, addedCount });
  }

  addPayload(firstPayload, 1);

  for (let startPage = 2; startPage <= requestedPages; startPage += concurrency) {
    const pageNumbers = Array.from(
      { length: Math.min(concurrency, requestedPages - startPage + 1) },
      (_, index) => startPage + index,
    );
    const settled = await Promise.allSettled(pageNumbers.map(async (pageNo) => ({
      pageNo,
      payload: await requestJson(pageUrl(pageNo), endpoint.label),
    })));
    for (const result of settled) {
      if (result.status === "fulfilled") addPayload(result.value.payload, result.value.pageNo);
    }
  }

  return {
    projects: rawItems.map((item, index) => normalizeProject(item, index, "TIA_SYSTEM_API")),
    totalCount,
    requestedPages,
    complete: totalCount <= maxPages,
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
    status: "SUCCESS",
    totalCount: result.totalCount,
    requestedPages: result.requestedPages,
    complete: result.complete,
    syncedCount,
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
