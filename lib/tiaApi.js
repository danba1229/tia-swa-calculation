import { createHash } from "node:crypto";
import { formatTargetYear } from "./projectPeriod.js";
export function readEnv(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "").trim();
}

export function readFirstEnv(names) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return "";
}

export function pick(raw, aliases) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of aliases) {
    const value = raw[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export function extractItems(payload) {
  const candidates = [
    payload?.response?.body?.items?.item,
    payload?.response?.body?.items,
    payload?.response?.body?.item,
    payload?.body?.items?.item,
    payload?.body?.items,
    payload?.body?.item,
    payload?.items?.item,
    payload?.items,
    payload?.data,
    payload?.list,
    payload?.rows,
    payload?.result?.items?.item,
    payload?.result?.items,
    payload?.result?.item,
    payload?.result?.list,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nestedArrays = [];
  function collectArrays(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === "object")) nestedArrays.push(value);
      for (const item of value) collectArrays(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const child of Object.values(value)) collectArrays(child, depth + 1);
    }
  }

  collectArrays(payload);
  if (nestedArrays.length) {
    return nestedArrays.sort((a, b) => b.length - a.length)[0];
  }

  const projectKeys = new Set([
    "사업명", "사업명칭", "사업위치", "사업지위치", "위치",
    "projectName", "bizNm", "busiNm", "prjNm",
  ]);
  for (const candidate of candidates) {
    if (
      candidate
      && typeof candidate === "object"
      && Object.keys(candidate).some((key) => projectKeys.has(key))
    ) {
      return [candidate];
    }
  }

  return [];
}

export function normalizeProject(raw, index, source) {
  const projectName = pick(raw, ["사업명", "사업명칭", "사업명_명칭", "projectName", "bizNm", "busiNm", "bsnsNm", "prjNm", "title", "sj"]);
  const location = pick(raw, ["위치", "사업위치", "사업지위치", "위치상세", "소재지", "대상지", "주소", "location", "addr", "address", "adres", "bsnsLc", "bsnsLcdtl", "bsnsDstrct"]);
  const projectType = pick(raw, ["사업구분", "사업구분코드명", "사업유형", "사업유형코드명", "사업종류", "projectType", "bizType", "bsnsTy", "tyDetail", "tyStep1", "구분"]) || "미분류";

  return {
    id: pick(raw, ["사업아이디", "id", "ID", "관리번호", "사업번호", "접수번호", "bsnsNo", "dlbrtNo", "seq", "sn"]) || `${source}-${index + 1}`,
    projectName: projectName || `후보사업 ${index + 1}`,
    location,
    projectType,
    facilityType: pick(raw, ["용도", "시설", "용도시설", "시설용도", "건축물용도", "facilityType", "useType", "bsnsPrpos", "tyStep2", "tyStep3", "tyStep4"]),
    projectPeriod: pick(raw, ["사업기간", "기간", "projectPeriod", "bizPeriod", "추진기간", "bsnsPd"]),
    targetYear: formatTargetYear(raw),
    siteArea: pick(raw, ["대지면적", "부지면적", "사업지면적", "사업면적", "시설계획면적", "siteArea", "area", "plotAr"]),
    grossFloorArea: pick(raw, ["연면적", "건축연면적", "grossFloorArea", "totalFloorArea", "buldAr", "totar"]),
    householdCount: pick(raw, ["세대수", "가구수", "householdCount", "hhCnt", "scale", "cpcty"]),
    developer: pick(raw, ["사업시행자", "시행자", "developer", "시공자", "bsnsOpr", "bsnsEnty"]),
    reviewResult: pick(raw, ["심의내용결과", "심의결과", "검토결과", "reviewResult", "결과", "추진단계", "진행상태", "status", "dlbrtCode", "grcCode"]),
    registeredDate: pick(raw, ["사업등록일", "등록일", "접수일", "고시일", "심의일", "조사일", "registeredDate", "regDate", "reqstDd", "dlbrtDd"]),
    source,
    raw,
  };
}

export function rawProjectKey(raw) {
  // One project can have separate records for apartments, shops, etc. Compare
  // actual record contents here; business-level merging happens after paging.
  // rno is only the upstream row position, so it cannot prove rows are distinct.
  function canonical(value, root = false) {
    if (Array.isArray(value)) return value.map(item => canonical(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).filter(key => !root || key !== "rno")
      .sort().map(key => [key, canonical(value[key])]));
  }
  return JSON.stringify(canonical(raw, true));
}

export function configuredEndpoints() {
  const legacyBaseUrl = readEnv("TIA_API_BASE_URL");
  const legacyOperationPath = readEnv("TIA_API_OPERATION_PATH");
  const endpoints = [
    {
      source: "TIA_PROJECT_API",
      label: "국토교통부_교통영향평가_사업정보",
      baseUrl: readEnv("TIA_PROJECT_API_BASE_URL"),
      operationPath: readEnv("TIA_PROJECT_API_OPERATION_PATH"),
    },
    {
      source: "TIA_SYSTEM_API",
      label: "국토교통부_교통영향평가정보지원시스템",
      baseUrl: readEnv("TIA_SYSTEM_API_BASE_URL") || legacyBaseUrl,
      operationPath: readEnv("TIA_SYSTEM_API_OPERATION_PATH") || legacyOperationPath,
    },
  ];

  return endpoints.filter((endpoint) => endpoint.baseUrl && endpoint.operationPath);
}

export function buildApiUrl(endpoint, criteria, serviceKey) {
  const operationPath = String(endpoint.operationPath || "").trim();
  const url = /^https?:\/\//i.test(operationPath)
    ? new URL(operationPath)
    : new URL(operationPath.replace(/^\/+/, ""), endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);
  const isOdcloud = url.hostname === "api.odcloud.kr";
  const isTiaSystem = endpoint.source === "TIA_SYSTEM_API";

  if (isTiaSystem && /\/tia\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/businessSearch`;
  }

  url.searchParams.set("serviceKey", serviceKey);

  if (isOdcloud) {
    url.searchParams.set("ServiceKey", serviceKey);
    url.searchParams.set("page", "1");
    url.searchParams.set("perPage", "1000");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    const locationKeyword = String(criteria.sigungu || criteria.sido || "").trim();
    if (locationKeyword) url.searchParams.set("cond[\uc704\uce58::LIKE]", locationKeyword);
  } else if (isTiaSystem) {
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("resultType", "JSON");
    if (criteria.startYear) url.searchParams.set("reqstDdSt", `${criteria.startYear}0101`);
    if (criteria.endYear) url.searchParams.set("reqstDdEd", `${criteria.endYear}1231`);
  } else {
    url.searchParams.set("ServiceKey", serviceKey);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("type", "json");
    url.searchParams.set("_type", "json");
    if (criteria.sido) url.searchParams.set("sido", criteria.sido);
    if (criteria.sigungu) url.searchParams.set("sigungu", criteria.sigungu);
    if (criteria.startYear) url.searchParams.set("startYear", String(criteria.startYear));
    if (criteria.endYear) url.searchParams.set("endYear", String(criteria.endYear));
    if (criteria.projectType && criteria.projectType !== "\uc804\uccb4") url.searchParams.set("projectType", criteria.projectType);
  }

  return url;
}

function redactRequestUrl(url) {
  const redacted = new URL(url.toString());
  redacted.searchParams.set("serviceKey", "********");
  redacted.searchParams.set("ServiceKey", "********");
  return redacted.toString();
}

export function readTotalCount(payload) {
  const candidates = [
    payload?.response?.body?.totalCount,
    payload?.body?.totalCount,
    payload?.totalCount,
    payload?.total,
    payload?.matchCount,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || String(candidate).trim() === "") continue;
    const count = Number(candidate);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
}

export function assessPageCompleteness(pages, totalCount, reachedPageLimit = false) {
  const receivedRowCount = pages.reduce((sum, page) => sum + page.responseItemCount, 0);
  const repeatedSingleProjectPages = pages.filter((page) => page.responseItemCount > 1 && page.uniqueItemCount === 1).length;
  const reasons = [];
  if (totalCount === null) reasons.push('UNKNOWN_TOTAL');
  if (reachedPageLimit) reasons.push("PAGE_LIMIT");
  if (totalCount !== null && receivedRowCount < totalCount) reasons.push("MISSING_ROWS");
  if (repeatedSingleProjectPages > 1) reasons.push("REPEATED_SINGLE_PROJECT_PAGES");
  return { complete: reasons.length === 0, receivedRowCount, repeatedSingleProjectPages, reasons };
}

async function requestJson(url, label) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
  const text = await response.text();

  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? ": 공공데이터 인증키 오류" : "";
    const preview = text ? ` / 응답: ${text.slice(0, 120).replace(/\s+/g, " ")}` : "";
    throw new Error(`${label} 호출 실패(${response.status})${hint}${preview}`);
  }

  if (text.trim().startsWith("<")) {
    throw new Error(`${label} 응답 형식 오류: JSON 응답 경로와 파라미터를 확인해 주세요.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 응답 형식 오류`);
  }
}

// One project can span several facility records with the same name and address.
// Those were once mistaken for upstream repeats, which led to numOfRows=1.
export const TIA_SYSTEM_PAGE_SIZE = 100;

async function fetchEndpoint(endpoint, criteria, serviceKey, { systemPage = 1, systemLimit = 48, systemPageSize = TIA_SYSTEM_PAGE_SIZE } = {}) {
  const primaryUrl = buildApiUrl(endpoint, criteria, serviceKey);
  const locationKeyword = String(criteria.sigungu || criteria.sido || "").trim();
  const isTiaSystem = endpoint.source === "TIA_SYSTEM_API";
  const urls = isTiaSystem
    ? []
    : primaryUrl.hostname === "api.odcloud.kr" && locationKeyword
      ? ["위치", "사업위치", "위치상세", "사업명"].map((fieldName) => {
      const url = new URL(primaryUrl.toString());
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith("cond[")) url.searchParams.delete(key);
      }
      url.searchParams.set(`cond[${fieldName}::LIKE]`, locationKeyword);
      return url;
      })
      : [primaryUrl];
  const payloads = [];
  const items = [];
  const seenItems = new Set();
  const errors = [];
  const pagination = [];
  let pageInfo = null;

  function addPayloadItems(payload, pageNo = null) {
    const pageItems = extractItems(payload);
    let addedCount = 0;
    for (const item of pageItems) {
      const key = rawProjectKey(item);
      if (seenItems.has(key)) continue;
      seenItems.add(key);
      items.push(item);
      addedCount += 1;
    }
    pagination.push({
      pageNo,
      responseItemCount: pageItems.length,
      uniqueItemCount: new Set(pageItems.map(rawProjectKey)).size,
      addedCount,
      totalCount: readTotalCount(payload),
    });
    return { pageItems, addedCount };
  }

  if (isTiaSystem) {
    // Expose a page cursor so long collections continue across requests.
    const pageSize = systemPageSize;
    const concurrency = 6;
    function createPageUrl(pageNo) {
      const pageUrl = new URL(primaryUrl.toString());
      pageUrl.searchParams.set("pageNo", String(pageNo));
      pageUrl.searchParams.set("numOfRows", String(pageSize));
      urls.push(pageUrl);
      return pageUrl;
    }
    try {
      const firstPayload = await requestJson(createPageUrl(1), endpoint.label);
      const totalCount = readTotalCount(firstPayload);
      if (totalCount === null) throw new Error("사업 원자료의 전체 건수를 확인하지 못했습니다.");
      const signature = createHash('sha256').update(JSON.stringify([totalCount, extractItems(firstPayload).map(rawProjectKey)])).digest('hex');
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const expectedRows = pageNo => Math.max(0, Math.min(pageSize, totalCount - (pageNo - 1) * pageSize));
      const lastPage = Math.min(totalPages, systemPage + systemLimit - 1);
      const startedAt = Date.now();
      let processedPage = systemPage - 1;
      for (let start = systemPage; start <= lastPage; start += concurrency) {
        const numbers = Array.from({ length: Math.min(concurrency, lastPage - start + 1) }, (_, i) => start + i);
        const batch = await Promise.all(numbers.map(async pageNo => ({ pageNo,
          payload: pageNo === 1 ? firstPayload : await requestJson(createPageUrl(pageNo), endpoint.label) })));
        for (const { pageNo, payload } of batch) {
          const rows = extractItems(payload);
          if (readTotalCount(payload) !== totalCount || rows.length !== expectedRows(pageNo)) throw new Error("사업 목록이 변경되었거나 페이지가 불완전합니다. 다시 검색해 주세요.");
          payloads.push(payload);
          const added = addPayloadItems(payload, pageNo);
          if (added.addedCount !== rows.length) throw new Error("사업 원자료에 반복 페이지가 있습니다. 전체 수집으로 처리하지 않습니다.");
          processedPage = pageNo;
        }
        if (Date.now() - startedAt > 10000) break;
      }
      const final = await requestJson(createPageUrl(1), endpoint.label);
      if (createHash('sha256').update(JSON.stringify([readTotalCount(final), extractItems(final).map(rawProjectKey)])).digest('hex') !== signature) {
        throw new Error('수집 중 사업 목록이 변경됐습니다. 다시 검색해 주세요.');
      }
      pageInfo = { pageSize, totalCount, signature, startPage: systemPage, processedPage,
        requestedPages: pagination.length, reportedPages: totalPages,
        processedCount: Math.min(totalCount, processedPage * pageSize),
        complete: processedPage >= totalPages, nextPage: processedPage < totalPages ? processedPage + 1 : null,
        projectKeys: items.map(item => createHash('sha256').update(rawProjectKey(item)).digest('hex')) };
    } catch (error) {
      errors.push(error.message || String(error));
      pageInfo = { ...pageInfo, complete: false, nextPage: null, failed: true };
    }
  } else for (const url of urls) {
    try {
      const payload = await requestJson(url, endpoint.label);
      payloads.push(payload);
      addPayloadItems(payload);
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }

  if (!payloads.length) {
    throw new Error(errors.join(" / ") || `${endpoint.label} 호출 실패`);
  }


  return {
    source: endpoint.source,
    label: endpoint.label,
    rawCount: items.length,
    projects: items.map((item, index) => normalizeProject(item, index, endpoint.source)),
    payload: payloads.length === 1 ? payloads[0] : payloads,
    requestUrls: urls.map(redactRequestUrl),
    errors,
    pagination,
    pageInfo,
  };
}

function projectKey(project) {
  const name = String(project.projectName || "").replace(/\s+/g, "").toLowerCase();
  const location = String(project.location || "").replace(/\s+/g, "").toLowerCase();
  return `${name}|${location}`;
}

function mergeProject(base, incoming) {
  const merged = { ...base };
  for (const key of ["projectName", "location", "projectType", "facilityType", "projectPeriod", "siteArea", "grossFloorArea", "householdCount", "developer", "reviewResult", "registeredDate"]) {
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  }
  merged.source = Array.from(new Set(String(base.source || "").split("+").concat(String(incoming.source || "").split("+")).filter(Boolean))).join("+");
  merged.raw = {
    ...(typeof base.raw === "object" && base.raw ? { [base.source || "base"]: base.raw } : {}),
    ...(typeof incoming.raw === "object" && incoming.raw ? { [incoming.source || "incoming"]: incoming.raw } : {}),
  };
  return merged;
}

function mergeProjects(projectGroups) {
  const map = new Map();
  for (const group of projectGroups) {
    for (const project of group.projects) {
      const key = projectKey(project) || `${project.source}:${project.id}`;
      const current = map.get(key);
      map.set(key, current ? mergeProject(current, project) : project);
    }
  }
  return Array.from(map.values());
}

function collectArrayPaths(value, path = "root", depth = 0, result = []) {
  if (depth > 8 || value === null || value === undefined) return result;
  if (Array.isArray(value)) {
    const first = value.find((item) => item && typeof item === "object");
    result.push({
      path,
      length: value.length,
      firstKeys: first ? Object.keys(first).slice(0, 30) : [],
    });
    for (let index = 0; index < Math.min(value.length, 2); index += 1) {
      collectArrayPaths(value[index], `${path}[${index}]`, depth + 1, result);
    }
    return result;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectArrayPaths(child, `${path}.${key}`, depth + 1, result);
    }
  }
  return result;
}

function matchesText(project, text) {
  const keyword = String(text || "").trim();
  if (!keyword) return true;
  const target = [
    project.projectName,
    project.location,
    project.projectType,
    project.facilityType,
    project.reviewResult,
    typeof project.raw === "object" ? JSON.stringify(project.raw) : project.raw,
  ].filter(Boolean).join(" ");
  return target.includes(keyword);
}

function matchesAdminName(project, adminName) {
  const fullName = String(adminName ?? "").trim();
  if (!fullName) return true;

  const shortName = fullName.replace(
    /(\ud2b9\ubcc4\uc790\uce58\uc2dc|\ud2b9\ubcc4\uc2dc|\uad11\uc5ed\uc2dc|\ud2b9\ubcc4\uc790\uce58\ub3c4|\ub3c4)$/,
    "",
  );
  return matchesText(project, fullName) || (shortName && matchesText(project, shortName));
}

const SIDO_ALIASES = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "충청북도", "충청남도", "전북특별자치도", "전라북도", "전라남도",
  "경상북도", "경상남도", "강원특별자치도", "제주특별자치도",
];

export function matchesAdminCriteria(project, sido, sigungu) {
  if (sigungu && !matchesAdminName(project, sigungu)) return false;
  if (!sido || matchesAdminName(project, sido)) return true;

  const targetSidoShort = String(sido).replace(
    /(특별자치시|특별시|광역시|특별자치도|도)$/,
    "",
  );
  const hasConflictingSido = SIDO_ALIASES.some((alias) => (
    alias !== targetSidoShort && matchesText(project, alias)
  ));

  return Boolean(sigungu) && !hasConflictingSido;
}

export function matchesYear(project, startYear, endYear) {
  const startText = String(startYear ?? "").trim();
  const endText = String(endYear ?? "").trim();
  const start = startText ? Number(startText) : Number.NaN;
  const end = endText ? Number(endText) : Number.NaN;
  if (!Number.isFinite(start) && !Number.isFinite(end)) return true;

  const text = [
    project.projectPeriod,
    project.registeredDate,
    project.reviewResult,
    typeof project.raw === "object" ? JSON.stringify(project.raw) : project.raw,
  ].filter(Boolean).join(" ");
  const years = Array.from(text.matchAll(/20\d{2}/g)).map((match) => Number(match[0]));
  if (!years.length) return true;

  return years.some((year) => (
    (!Number.isFinite(start) || year >= start)
    && (!Number.isFinite(end) || year <= end)
  ));
}

export function matchesProjectType(project, projectType) {
  const normalized = String(projectType ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all" || normalized === "\uc804\uccb4") return true;
  if (!projectType || projectType === "전체") return true;
  return matchesText(project, projectType);
}

export async function fetchTiaProjects(criteria = {}, { excludeSources = [], systemPage = 1 } = {}) {
  const serviceKey = readFirstEnv(["DATA_GO_KR_SERVICE_KEY", "TIA_DATAGOKR"]);
  const endpoints = configuredEndpoints().filter(endpoint => !excludeSources.includes(endpoint.source));
  if (!endpoints.length && excludeSources.length) return { rawCount: 0, projects: [], requestUrls: [], errors: [], sources: [], sourceCounts: {}, sourceDiagnostics: [] };

  if (!serviceKey || !endpoints.length) {
    const missing = [
      !serviceKey ? "TIA_DATAGOKR 또는 DATA_GO_KR_SERVICE_KEY" : "",
      !endpoints.length ? "TIA_PROJECT_API_BASE_URL/TIA_PROJECT_API_OPERATION_PATH 또는 TIA_SYSTEM_API_BASE_URL/TIA_SYSTEM_API_OPERATION_PATH" : "",
    ].filter(Boolean).join(", ");
    throw new Error(`교통영향평가 API 환경변수를 확인해 주세요. 부족한 값: ${missing}`);
  }

  const settled = await Promise.allSettled(endpoints.map((endpoint) => fetchEndpoint(endpoint, criteria, serviceKey, { systemPage })));
  const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const errors = settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || "API 호출 실패");

  if (!successful.length) {
    throw new Error(errors.join(" / ") || "교통영향평가 API 호출 실패");
  }

  const merged = mergeProjects(successful);
  const filtered = merged.filter((project) => (
    matchesAdminCriteria(project, criteria.sido, criteria.sigungu)
    && matchesYear(project, criteria.startYear, criteria.endYear)
    && matchesProjectType(project, criteria.projectType)
  ));

  return {
    rawCount: successful.reduce((sum, group) => sum + group.rawCount, 0),
    projects: filtered,
    payload: Object.fromEntries(successful.map((group) => [group.source, group.payload])),
    requestUrls: successful.flatMap((group) => group.requestUrls.map((url) => ({ source: group.source, label: group.label, url }))),
    errors: errors.concat(successful.flatMap((group) => group.errors || [])),
    sources: successful.map((group) => group.source),
    sourceCounts: Object.fromEntries(successful.map((group) => [group.source, group.rawCount])),
    sourceDiagnostics: successful.map((group) => ({
      source: group.source,
      rawCount: group.rawCount,
      pagination: group.pagination,
      pageInfo: group.pageInfo,
      arrayPaths: collectArrayPaths(group.payload).slice(0, 30),
      samples: group.projects.slice(0, 3).map((project) => ({
        projectName: project.projectName,
        location: project.location,
        projectType: project.projectType,
        projectPeriod: project.projectPeriod,
        registeredDate: project.registeredDate,
        rawKeys: project.raw && typeof project.raw === "object" ? Object.keys(project.raw).slice(0, 50) : [],
      })),
    })),
  };
}
