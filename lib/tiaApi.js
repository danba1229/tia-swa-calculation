function readEnv(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "").trim();
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

function normalizeProject(raw, index) {
  const projectName = pick(raw, ["사업명", "사업명칭", "projectName", "bizNm", "busiNm", "prjNm", "title", "sj"]);
  const location = pick(raw, ["위치", "소재지", "사업지위치", "대상지", "location", "addr", "address", "adres"]);
  const projectType = pick(raw, ["사업구분", "사업유형", "projectType", "bizType", "구분"]) || "미분류";

  return {
    id: pick(raw, ["id", "ID", "관리번호", "사업번호", "seq", "sn"]) || `tia-api-${index + 1}`,
    projectName: projectName || `후보사업 ${index + 1}`,
    location,
    projectType,
    facilityType: pick(raw, ["용도", "시설", "용도시설", "시설용도", "facilityType", "useType"]),
    projectPeriod: pick(raw, ["사업기간", "기간", "projectPeriod", "bizPeriod", "추진기간"]),
    siteArea: pick(raw, ["대지면적", "부지면적", "siteArea", "area"]),
    grossFloorArea: pick(raw, ["연면적", "grossFloorArea", "totalFloorArea"]),
    householdCount: pick(raw, ["세대수", "가구수", "householdCount", "hhCnt"]),
    developer: pick(raw, ["사업시행자", "시행자", "developer", "시공자"]),
    reviewResult: pick(raw, ["심의결과", "검토결과", "reviewResult", "결과", "추진단계", "status"]),
    registeredDate: pick(raw, ["등록일", "접수일", "고시일", "registeredDate", "regDate"]),
    source: "TIA_API",
    raw,
  };
}

function buildApiUrl(criteria) {
  const baseUrl = readEnv("TIA_API_BASE_URL");
  const operationPath = readEnv("TIA_API_OPERATION_PATH");
  const serviceKey = readEnv("DATA_GO_KR_SERVICE_KEY");

  if (!baseUrl || !operationPath || !serviceKey) {
    throw new Error("교통영향평가 API 환경변수(DATA_GO_KR_SERVICE_KEY, TIA_API_BASE_URL, TIA_API_OPERATION_PATH)를 확인해 주세요.");
  }

  const url = new URL(operationPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
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
  const url = buildApiUrl(criteria);
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "공공데이터 인증키 오류가 발생했습니다."
      : "교통영향평가 API 호출 실패");
  }

  if (text.trim().startsWith("<")) {
    throw new Error("교통영향평가 API 응답 형식 오류: JSON 응답 경로와 파라미터를 tiaApi.js에서 확인해 주세요.");
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("교통영향평가 API 응답 형식 오류");
  }

  const items = extractItems(payload);
  const normalized = items.map(normalizeProject);
  const filtered = normalized.filter((project) => (
    matchesText(project, criteria.sido)
    && matchesText(project, criteria.sigungu)
    && matchesYear(project, criteria.startYear, criteria.endYear)
    && matchesProjectType(project, criteria.projectType)
  ));

  return {
    rawCount: items.length,
    projects: filtered,
    payload,
    requestUrl: url.toString().replace(readEnv("DATA_GO_KR_SERVICE_KEY"), "********"),
  };
}
