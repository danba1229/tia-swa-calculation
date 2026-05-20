function readEnv(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "").trim();
}

function readFirstEnv(names) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return "";
}

function pick(raw, aliases) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of aliases) {
    const value = raw[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function extractItems(payload) {
  const candidates = [
    payload?.response?.body?.items?.item,
    payload?.response?.body?.items,
    payload?.body?.items?.item,
    payload?.body?.items,
    payload?.items?.item,
    payload?.items,
    payload?.data,
    payload?.list,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object" && !candidate.header && !candidate.body && !candidate.response) {
      return [candidate];
    }
  }
  return [];
}

function normalizeProject(raw, index, source) {
  const projectName = pick(raw, ["사업명", "사업명칭", "사업명_명칭", "projectName", "bizNm", "busiNm", "prjNm", "title", "sj"]);
  const location = pick(raw, ["위치", "소재지", "사업지위치", "대상지", "주소", "location", "addr", "address", "adres"]);
  const projectType = pick(raw, ["사업구분", "사업유형", "사업종류", "projectType", "bizType", "구분"]) || "미분류";

  return {
    id: pick(raw, ["id", "ID", "관리번호", "사업번호", "접수번호", "seq", "sn"]) || `${source}-${index + 1}`,
    projectName: projectName || `후보사업 ${index + 1}`,
    location,
    projectType,
    facilityType: pick(raw, ["용도", "시설", "용도시설", "시설용도", "건축물용도", "facilityType", "useType"]),
    projectPeriod: pick(raw, ["사업기간", "기간", "projectPeriod", "bizPeriod", "추진기간"]),
    siteArea: pick(raw, ["대지면적", "부지면적", "사업면적", "siteArea", "area"]),
    grossFloorArea: pick(raw, ["연면적", "건축연면적", "grossFloorArea", "totalFloorArea"]),
    householdCount: pick(raw, ["세대수", "가구수", "householdCount", "hhCnt"]),
    developer: pick(raw, ["사업시행자", "시행자", "developer", "시공자"]),
    reviewResult: pick(raw, ["심의결과", "검토결과", "reviewResult", "결과", "추진단계", "진행상태", "status"]),
    registeredDate: pick(raw, ["등록일", "접수일", "고시일", "심의일", "registeredDate", "regDate"]),
    source,
    raw,
  };
}

function configuredEndpoints() {
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

function buildApiUrl(endpoint, criteria, serviceKey) {
  const url = new URL(endpoint.operationPath, endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("ServiceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "200");
  url.searchParams.set("type", "json");
  url.searchParams.set("_type", "json");

  if (criteria.sido) url.searchParams.set("sido", criteria.sido);
  if (criteria.sigungu) url.searchParams.set("sigungu", criteria.sigungu);
  if (criteria.startYear) url.searchParams.set("startYear", String(criteria.startYear));
  if (criteria.endYear) url.searchParams.set("endYear", String(criteria.endYear));
  if (criteria.projectType && criteria.projectType !== "전체") url.searchParams.set("projectType", criteria.projectType);

  return url;
}

async function fetchEndpoint(endpoint, criteria, serviceKey) {
  const url = buildApiUrl(endpoint, criteria, serviceKey);
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${endpoint.label} 호출 실패${response.status === 401 || response.status === 403 ? ": 공공데이터 인증키 오류" : ""}`);
  }

  if (text.trim().startsWith("<")) {
    throw new Error(`${endpoint.label} 응답 형식 오류: JSON 응답 경로와 파라미터를 확인해 주세요.`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint.label} 응답 형식 오류`);
  }

  const items = extractItems(payload);
  return {
    source: endpoint.source,
    label: endpoint.label,
    rawCount: items.length,
    projects: items.map((item, index) => normalizeProject(item, index, endpoint.source)),
    payload,
    requestUrl: url.toString().replace(serviceKey, "********"),
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

function matchesYear(project, startYear, endYear) {
  const start = Number(startYear);
  const end = Number(endYear);
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

function matchesProjectType(project, projectType) {
  if (!projectType || projectType === "전체") return true;
  return matchesText(project, projectType);
}

export async function fetchTiaProjects(criteria = {}) {
  const serviceKey = readFirstEnv(["DATA_GO_KR_SERVICE_KEY", "TIA_DATAGOKR"]);
  const endpoints = configuredEndpoints();

  if (!serviceKey || !endpoints.length) {
    const missing = [
      !serviceKey ? "TIA_DATAGOKR 또는 DATA_GO_KR_SERVICE_KEY" : "",
      !endpoints.length ? "TIA_PROJECT_API_BASE_URL/TIA_PROJECT_API_OPERATION_PATH 또는 TIA_SYSTEM_API_BASE_URL/TIA_SYSTEM_API_OPERATION_PATH" : "",
    ].filter(Boolean).join(", ");
    throw new Error(`교통영향평가 API 환경변수를 확인해 주세요. 부족한 값: ${missing}`);
  }

  const settled = await Promise.allSettled(endpoints.map((endpoint) => fetchEndpoint(endpoint, criteria, serviceKey)));
  const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const errors = settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || "API 호출 실패");

  if (!successful.length) {
    throw new Error(errors.join(" / ") || "교통영향평가 API 호출 실패");
  }

  const merged = mergeProjects(successful);
  const filtered = merged.filter((project) => (
    matchesText(project, criteria.sido)
    && matchesText(project, criteria.sigungu)
    && matchesYear(project, criteria.startYear, criteria.endYear)
    && matchesProjectType(project, criteria.projectType)
  ));

  return {
    rawCount: successful.reduce((sum, group) => sum + group.rawCount, 0),
    projects: filtered,
    payload: Object.fromEntries(successful.map((group) => [group.source, group.payload])),
    requestUrls: successful.map((group) => ({ source: group.source, label: group.label, url: group.requestUrl })),
    errors,
    sources: successful.map((group) => group.source),
  };
}
