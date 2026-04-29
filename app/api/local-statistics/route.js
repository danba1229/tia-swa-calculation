import { NextResponse } from "next/server";
import localStatisticsCache from "../../local-statistics-cache.json";
import annualStatisticsCache from "../../annual-statistics-cache.json";
import { analyzeYearbookPdfBuffer } from "../statistics-pdf/route";

export const runtime = "nodejs";

const KOSIS_BASE = "http://kosis.kr/openapi";
const LANDUSE_TABLE = { orgId: "116", tblId: "DT_MLTM_2300" };
const ZONING_TABLE = { orgId: "460", tblId: "TX_315_2009_H1500" };
const URBAN_ZONING_TABLE = { orgId: "460", tblId: "TX_315_2009_H1440" };
const NON_URBAN_ZONING_TABLE = { orgId: "460", tblId: "TX_315_2009_H1443" };
const DEFAULT_STATISTICS_YEAR = "2024";
const YEARBOOK_OFFICIAL_PAGES = [
  {
    region: "송파구",
    domain: "www.songpa.go.kr",
    pages: ["https://www.songpa.go.kr/www/contents.do?key=2233"],
  },
];
const YEARBOOK_DOC_PATTERN = /\.(pdf|xls|xlsx|csv|hwp|hwpx)(?:[?#]|$)|download|down|file|attach|atch/i;
const YEARBOOK_MANUAL_PATTERN = /\.(hwp|hwpx|xls|xlsx|csv)(?:[?#]|$)|hwp|hwpx|xls|xlsx|csv/i;
const OFFICIAL_DOMAIN_PATTERN = /(^|\.)go\.kr$/i;
const SEARCH_ENGINE_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "www.bing.com",
  "bing.com",
  "search.naver.com",
  "search.daum.net",
]);

const LANDUSE_TARGETS = {
  전: "전",
  답: "답",
  임야: "임야",
  대지: "대",
  도로: "도로",
  하천: "하천",
  학교: "학교용지",
  공원: "공원",
};

const URBAN_ZONING_NAMES = ["주거지역", "상업지역", "공업지역", "녹지지역"];
const NON_URBAN_ZONING_NAMES = ["관리지역", "농림지역", "자연환경보전지역", "미세분지역"];
const ZONING_REPORT_TARGETS = {
  주거: ["주거지역"],
  상업: ["상업지역"],
  공업: ["공업지역"],
  녹지: ["녹지지역"],
  관리: ["관리지역"],
  농림: ["농림지역"],
  자연환경보전: ["자연환경보전지역"],
  미지정: ["미지정", "미지정지역"],
};

const PROVINCES = [
  { full: "서울특별시", short: "서울", aliases: ["서울특별시", "서울시", "서울"] },
  { full: "부산광역시", short: "부산", aliases: ["부산광역시", "부산시", "부산"] },
  { full: "대구광역시", short: "대구", aliases: ["대구광역시", "대구시", "대구"] },
  { full: "인천광역시", short: "인천", aliases: ["인천광역시", "인천시", "인천"] },
  { full: "광주광역시", short: "광주", aliases: ["광주광역시", "광주시", "광주"] },
  { full: "대전광역시", short: "대전", aliases: ["대전광역시", "대전시", "대전"] },
  { full: "울산광역시", short: "울산", aliases: ["울산광역시", "울산시", "울산"] },
  { full: "세종특별자치시", short: "세종", aliases: ["세종특별자치시", "세종시", "세종"] },
  { full: "경기도", short: "경기", aliases: ["경기도", "경기"] },
  { full: "강원특별자치도", short: "강원", aliases: ["강원특별자치도", "강원도", "강원"] },
  { full: "충청북도", short: "충북", aliases: ["충청북도", "충북"] },
  { full: "충청남도", short: "충남", aliases: ["충청남도", "충남"] },
  { full: "전북특별자치도", short: "전북", aliases: ["전북특별자치도", "전라북도", "전북"] },
  { full: "전라남도", short: "전남", aliases: ["전라남도", "전남"] },
  { full: "경상북도", short: "경북", aliases: ["경상북도", "경북"] },
  { full: "경상남도", short: "경남", aliases: ["경상남도", "경남"] },
  { full: "제주특별자치도", short: "제주", aliases: ["제주특별자치도", "제주도", "제주"] },
];

const METRO_SHORT_NAMES = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산"]);
const metaCache = new Map();

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return safe(value).replace(/\s+/g, "").replace(/[()]/g, "");
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAreaString(value) {
  const rounded = Math.round(toNumber(value));
  return rounded > 0 ? String(rounded) : "0";
}

function areaToM2(row) {
  const value = toNumber(row?.DT);
  const unit = normalizeName(row?.UNIT_NM);
  if (!Number.isFinite(value)) return 0;
  if (/km²|㎢|제곱킬로미터|km2/i.test(unit)) return value * 1000000;
  if (/천.*㎡|천.*m²|천.*m2|1000.*㎡|1000.*m²|1000.*m2/i.test(unit)) return value * 1000;
  if (/ha|헥타르/i.test(unit)) return value * 10000;
  return value;
}

function normalizeYear(value) {
  const year = safe(value).match(/\d{4}/)?.[0] || DEFAULT_STATISTICS_YEAR;
  return year;
}

function matchesProvince(entry, province) {
  if (!entry?.province) return true;
  const provinceNames = new Set([province?.full, province?.short, ...(province?.aliases || [])].map(normalizeName));
  return provinceNames.has(normalizeName(entry.province));
}

function matchesRegion(entry, target) {
  const preferred = normalizeName(target?.preferred);
  const matchNames = Array.isArray(entry?.matchNames) ? entry.matchNames : [entry?.region];
  return matchNames.some((name) => normalizeName(name) === preferred);
}

function pickCachedEntry(collection, target, province, year = "") {
  return (Array.isArray(collection) ? collection : []).find((entry) => (
    matchesProvince(entry, province) &&
    matchesRegion(entry, target) &&
    (!year || safe(entry.year) === safe(year))
  )) || null;
}

function pickLatestCachedEntry(collection, target, province) {
  return (Array.isArray(collection) ? collection : [])
    .filter((entry) => matchesProvince(entry, province) && matchesRegion(entry, target))
    .sort((left, right) => Number(right.year || 0) - Number(left.year || 0))[0] || null;
}

function buildCachedLanduse(target, province, year = "") {
  const entry = pickCachedEntry(localStatisticsCache.landuse, target, province, year);
  if (!entry) return null;
  return {
    areas: entry.areas,
    year: entry.year,
    requestedYear: year || entry.year,
    kosisAvailableYear: entry.year,
    kosisUsedYear: entry.year,
    regionName: entry.region,
    source: entry.source,
    cached: true,
  };
}

function buildCachedZoning(target, province, year = "", { allowLatest = false } = {}) {
  const exactEntry = pickCachedEntry(localStatisticsCache.zoning, target, province, year);
  const entry = exactEntry || (allowLatest ? pickLatestCachedEntry(localStatisticsCache.zoning, target, province) : null);
  if (!entry) return null;
  const fallbackNote = year && safe(entry.year) !== safe(year)
    ? `KOSIS 용도지역현황 ${year}년 미공표로 ${entry.year}년 최신자료 사용`
    : "";
  return {
    rows: entry.rows,
    year: entry.year,
    requestedYear: year || entry.year,
    kosisAvailableYear: entry.year,
    kosisUsedYear: entry.year,
    validationNote: fallbackNote,
    regionName: entry.region,
    source: entry.source,
    cached: true,
  };
}

function makeParams(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    search.set(key, value ?? "");
  });
  return search;
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 tia-support/1.0",
      },
    });
  } catch (error) {
    const cause = error.cause;
    const detail = [error.message, cause?.code, cause?.message].filter(Boolean).join(" / ");
    throw new Error(`KOSIS network failed: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`KOSIS request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data?.err) {
    throw new Error(data.errMsg || "KOSIS request failed");
  }
  return data;
}

async function getMeta(table) {
  const key = `${table.orgId}:${table.tblId}`;
  if (!metaCache.has(key)) {
    const params = makeParams({
      method: "getMeta",
      apiKey: process.env.KOSIS_API_KEY,
      type: "ITM",
      orgId: table.orgId,
      tblId: table.tblId,
      format: "json",
      jsonVD: "Y",
    });
    metaCache.set(key, fetchJson(`${KOSIS_BASE}/statisticsData.do?${params.toString()}`));
  }
  return metaCache.get(key);
}

async function fetchKosisRows(table, { itemId, objL1 = "", objL2 = "", objL3 = "", year = "" }) {
  const selectedYear = safe(year);
  const params = makeParams({
    method: "getList",
    apiKey: process.env.KOSIS_API_KEY,
    itmId: itemId,
    objL1,
    objL2,
    objL3,
    objL4: "",
    objL5: "",
    objL6: "",
    objL7: "",
    objL8: "",
    format: "json",
    jsonVD: "Y",
    prdSe: "Y",
    startPrdDe: selectedYear,
    endPrdDe: selectedYear,
    newEstPrdCnt: selectedYear ? "" : "1",
    orgId: table.orgId,
    tblId: table.tblId,
  });
  return fetchJson(`${KOSIS_BASE}/Param/statisticsParameterData.do?${params.toString()}`);
}

function detectProvince(address) {
  const compact = normalizeName(address);
  return PROVINCES.find((province) => province.aliases.some((alias) => compact.includes(normalizeName(alias)))) || null;
}

function extractAdministrativeTarget(address, province) {
  const tokens = safe(address).split(/\s+/).map((part) => part.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const provinceAliases = new Set((province?.aliases || []).map(normalizeName));
  const localTokens = tokens.filter((token) => !provinceAliases.has(normalizeName(token)));
  const city = localTokens.find((token) => /(시|군)$/.test(token));
  const district = localTokens.find((token) => /구$/.test(token));

  if (!province) return { preferred: city || district || "", city, district };
  if (province.short === "세종") return { preferred: "세종특별자치시", city, district };
  if (METRO_SHORT_NAMES.has(province.short)) return { preferred: district || city || province.short, city, district };
  return { preferred: city || district || province.short, city, district };
}

function pickMetaCode(meta, objectName, preferredName, provinceShort = "") {
  const rows = meta.filter((row) => row.OBJ_NM === objectName);
  const preferred = normalizeName(preferredName);
  const province = normalizeName(provinceShort);

  return (
    rows.find((row) => normalizeName(row.ITM_NM) === `${preferred}계`) ||
    rows.find((row) => normalizeName(row.ITM_NM) === preferred) ||
    rows.find((row) => normalizeName(row.ITM_NM).startsWith(preferred) && normalizeName(row.ITM_NM).endsWith("계")) ||
    rows.find((row) => province && normalizeName(row.ITM_NM) === province) ||
    null
  );
}

function pickLocalMetaCode(meta, objectName, preferredName, province) {
  const rows = meta.filter((row) => row.OBJ_NM === objectName);
  const preferred = normalizeName(preferredName);
  const provinceNames = new Set([province?.full, province?.short, ...(province?.aliases || [])].map(normalizeName));
  const allProvinceNames = new Set(PROVINCES.flatMap((item) => [item.full, item.short, ...item.aliases].map(normalizeName)));
  let currentProvince = "";
  const candidates = [];

  rows.forEach((row) => {
    const name = normalizeName(row.ITM_NM);
    if (allProvinceNames.has(name)) {
      currentProvince = name;
    }
    if (name === preferred || name === `${preferred}계` || (name.startsWith(preferred) && name.endsWith("계"))) {
      candidates.push({ row, currentProvince });
    }
  });

  return (
    candidates.find((candidate) => provinceNames.has(candidate.currentProvince))?.row ||
    candidates[0]?.row ||
    pickMetaCode(meta, objectName, preferredName, province?.short || "")
  );
}

function pickItemCode(meta, objectName, name) {
  return meta.find((row) => row.OBJ_NM === objectName && normalizeName(row.ITM_NM) === normalizeName(name)) || null;
}

function pickItemCodes(meta, objectName, names) {
  return names.map((name) => pickItemCode(meta, objectName, name)).filter(Boolean);
}

function sumAreas(rows, categoryName) {
  return rows
    .filter((row) => normalizeName(row.C3_NM || row.C2_NM) === normalizeName(categoryName))
    .reduce((sum, row) => sum + areaToM2(row), 0);
}

async function buildLanduse(address, target, province, year = "") {
  const meta = await getMeta(LANDUSE_TABLE);
  const item = pickItemCode(meta, "항목", "면적");
  const provinceCode = pickMetaCode(meta, "시도", province.short, province.short);
  const localCode = pickMetaCode(meta, "시군구", target.preferred, province.short);
  const levelCodes = pickItemCodes(meta, "레벨01", ["계", ...Object.values(LANDUSE_TARGETS)]);

  if (!item || !provinceCode || !localCode || levelCodes.length < 2) {
    return null;
  }

  const rows = await fetchKosisRows(LANDUSE_TABLE, {
    itemId: item.ITM_ID,
    objL1: provinceCode.ITM_ID,
    objL2: localCode.ITM_ID,
    objL3: levelCodes.map((row) => row.ITM_ID).join("+"),
    year,
  });

  const areas = {};
  Object.entries(LANDUSE_TARGETS).forEach(([appName, kosisName]) => {
    areas[appName] = toAreaString(sumAreas(rows, kosisName));
  });

  const total = sumAreas(rows, "계");
  const selectedTotal = Object.values(areas).reduce((sum, value) => sum + toNumber(value), 0);
  areas.기타 = toAreaString(Math.max(0, total - selectedTotal));

  const dataYear = rows.find((row) => row.PRD_DE)?.PRD_DE || "";
  const regionName = rows.find((row) => row.C2_NM)?.C2_NM || localCode.ITM_NM;

  return {
    areas,
    year: dataYear,
    requestedYear: year || dataYear,
    kosisAvailableYear: dataYear,
    kosisUsedYear: dataYear,
    regionName,
    source: `${regionName} 지목별 국토이용현황(KOSIS 국토교통부 ${dataYear})`,
  };
}

async function fetchZoningPart(table, target, province, names, year = "") {
  const meta = await getMeta(table);
  const item = pickItemCode(meta, "항목", "면적");
  const localCode = pickLocalMetaCode(meta, "소재지(시군구)별", target.preferred, province);
  const zoningCodes = pickItemCodes(meta, "용도지역별", names);

  if (!item || !localCode || !zoningCodes.length) {
    return [];
  }

  return fetchKosisRows(table, {
    itemId: item.ITM_ID,
    objL1: localCode.ITM_ID,
    objL2: zoningCodes.map((row) => row.ITM_ID).join("+"),
    year,
  });
}

function pickObjectName(meta, candidates) {
  return candidates.find((name) => meta.some((row) => row.OBJ_NM === name)) || "";
}

function pickAnyItemCode(meta, objectName, aliases) {
  return aliases.map((name) => pickItemCode(meta, objectName, name)).find(Boolean) || null;
}

async function buildZoningFromUnifiedTable(address, target, province, year = "") {
  const meta = await getMeta(ZONING_TABLE);
  const itemObject = pickObjectName(meta, ["항목"]);
  const regionObject = pickObjectName(meta, ["소재지(시군구)별", "시군구", "행정구역별"]);
  const zoningObject = pickObjectName(meta, ["용도지역별", "용도지역계", "용도지역"]);
  const item = pickAnyItemCode(meta, itemObject, ["면적"]);
  const localCode = pickLocalMetaCode(meta, regionObject, target.preferred, province);
  const zoningAliases = Object.values(ZONING_REPORT_TARGETS).flat();
  const zoningCodes = pickItemCodes(meta, zoningObject, ["계", ...zoningAliases]);

  if (!item || !localCode || !zoningCodes.length) {
    return null;
  }

  const rows = await fetchKosisRows(ZONING_TABLE, {
    itemId: item.ITM_ID,
    objL1: localCode.ITM_ID,
    objL2: zoningCodes.map((row) => row.ITM_ID).join("+"),
    year,
  });
  const rawName = (row) => row.C2_NM || row.C1_NM || row.ITM_NM || "";
  const total = rows
    .filter((row) => normalizeName(rawName(row)) === normalizeName("계"))
    .reduce((sum, row) => sum + areaToM2(row), 0);
  const reportRows = Object.entries(ZONING_REPORT_TARGETS).map(([name, aliases]) => {
    const area = aliases.reduce((sum, alias) => (
      sum + rows
        .filter((row) => normalizeName(rawName(row)) === normalizeName(alias))
        .reduce((innerSum, row) => innerSum + areaToM2(row), 0)
    ), 0);
    return {
      name,
      area: toAreaString(area),
      rawItems: aliases.join(", "),
    };
  });
  const selectedTotal = reportRows.reduce((sum, row) => sum + toNumber(row.area), 0);
  const finalRows = [
    ...reportRows,
    { name: "기타", area: toAreaString(Math.max(0, total - selectedTotal)), rawItems: "전체 계 - 주요 항목 합계" },
  ].filter((row) => toNumber(row.area) > 0 || row.name !== "기타");

  if (!finalRows.length) return null;

  const dataYear = rows.find((row) => row.PRD_DE)?.PRD_DE || year;
  const regionName = rows.find((row) => row.C1_NM)?.C1_NM || rows.find((row) => row.C2_NM)?.C2_NM || target.preferred;

  return {
    rows: finalRows,
    year: dataYear,
    requestedYear: year || dataYear,
    kosisAvailableYear: dataYear,
    kosisUsedYear: dataYear,
    regionName,
    source: `${regionName} 용도지역현황(KOSIS 도시계획현황 ${dataYear})`,
    tableId: ZONING_TABLE.tblId,
  };
}

async function buildZoning(address, target, province, year = "") {
  const unified = await buildZoningFromUnifiedTable(address, target, province, year).catch(() => null);
  if (unified?.rows?.length) return unified;

  const [urbanRows, nonUrbanRows] = await Promise.all([
    fetchZoningPart(URBAN_ZONING_TABLE, target, province, URBAN_ZONING_NAMES, year),
    fetchZoningPart(NON_URBAN_ZONING_TABLE, target, province, NON_URBAN_ZONING_NAMES, year),
  ]);

  const rows = [...urbanRows, ...nonUrbanRows]
    .filter((row) => row.C2_NM && row.ITM_NM === "면적")
    .map((row) => ({
      name: row.C2_NM,
      area: toAreaString(areaToM2(row)),
    }));

  if (!rows.length) return null;

  const dataYear = [...urbanRows, ...nonUrbanRows].find((row) => row.PRD_DE)?.PRD_DE || "";
  const regionName = [...urbanRows, ...nonUrbanRows].find((row) => row.C1_NM)?.C1_NM || target.preferred;

  return {
    rows,
    year: dataYear,
    requestedYear: year || dataYear,
    kosisAvailableYear: dataYear,
    kosisUsedYear: dataYear,
    regionName,
    source: `${regionName} 용도지역현황(KOSIS 도시계획현황 ${dataYear})`,
  };
}

function pickAnnualReportEntry(target, province, year) {
  return pickCachedEntry(annualStatisticsCache.entries, target, province, year);
}

function decodeHtml(value) {
  return safe(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtml(safe(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function resolveLink(href, baseUrl) {
  const decoded = decodeHtml(href);
  if (!decoded || /^javascript:/i.test(decoded)) return "";
  try {
    return new URL(decoded, baseUrl).toString();
  } catch {
    return "";
  }
}

function unwrapSearchResultUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const wrapped = parsed.searchParams.get("q")
      || parsed.searchParams.get("url")
      || parsed.searchParams.get("u")
      || parsed.searchParams.get("target")
      || parsed.searchParams.get("where");
    if ((SEARCH_ENGINE_HOSTS.has(host) || host.endsWith(".google.com")) && wrapped && /^https?:\/\//i.test(wrapped)) {
      return new URL(wrapped).toString();
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function isOfficialDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAIN_PATTERN.test(host);
  } catch {
    return false;
  }
}

function extractAnchors(html, pageUrl) {
  const anchors = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const url = resolveLink(match[1], pageUrl);
    if (!url) continue;
    const context = stripTags(html.slice(Math.max(0, match.index - 120), Math.min(html.length, match.index + match[0].length + 160)));
    const text = stripTags(match[2]);
    anchors.push({ url, text, context });
  }
  return anchors;
}

function extractYearbookLinks(html, pageUrl) {
  return extractAnchors(html, pageUrl).filter(({ url, text, context }) => {
    const source = `${url} ${text} ${context}`;
    return YEARBOOK_DOC_PATTERN.test(source)
      && /통계|연보|statistics|statistical|yearbook|토지|용도지역/i.test(source);
  });
}

function inferFileType(link) {
  const source = `${link.url} ${link.text} ${link.context}`.toLowerCase();
  return source.match(/\b(pdf|xlsx|xls|csv|hwpx|hwp)\b|\.([a-z0-9]+)(?:[?#]|$)/)?.[1]
    || source.match(/\.([a-z0-9]+)(?:[?#]|$)/)?.[1]
    || (source.includes("pdf") ? "pdf" : "");
}

function getKnownYearbookPages(target) {
  const preferred = normalizeName(target?.preferred);
  return YEARBOOK_OFFICIAL_PAGES
    .filter((source) => normalizeName(source.region) === preferred)
    .flatMap((source) => source.pages.map((page) => ({ ...source, page })));
}

function buildYearbookSearchUrls(target, year) {
  const region = safe(target?.preferred);
  const queries = [
    `${region} ${year} 통계연보 PDF`,
    `${region} 통계연보 ${year}`,
    `site:go.kr ${region} ${year} 통계연보`,
    `site:go.kr ${region} 지목별 토지현황 용도지역 통계연보`,
  ];
  return [
    ...queries.map((query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`),
    ...queries.map((query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`),
    ...queries.map((query) => `https://search.daum.net/search?w=tot&q=${encodeURIComponent(query)}`),
    ...queries.map((query) => `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`),
  ];
}

async function fetchTextDocument(url, timeoutMs = 4500) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
      "User-Agent": "Mozilla/5.0 tia-support/1.0",
    },
  });
  if (!response.ok) throw new Error(`통계연보 페이지 조회 실패: ${response.status}`);
  return response.text();
}

function makeYearbookCandidate(link, { year, sourcePage = "", officialDomain = "" }) {
  const yearSource = safe(`${link.context} ${link.text} ${link.url}`);
  const years = [...yearSource.matchAll(/(20\d{2}|19\d{2})/g)].map((match) => match[1]);
  const fileYear = years.includes(safe(year)) ? safe(year) : (years.at(-1) || "");
  const fileType = inferFileType(link);
  const exactYear = fileYear === safe(year) || link.context.includes(`${year}년`) || link.text.includes(`${year}년`);
  const isPdf = fileType === "pdf" || /\.pdf(?:[?#]|$)/i.test(link.url);
  return {
    ...link,
    fileYear,
    fileType: fileType || (isPdf ? "pdf" : ""),
    sourcePage,
    officialDomain,
    score: (exactYear ? 100 : 0)
      + (isPdf ? 30 : 0)
      + (/통계|연보/.test(yearSource) ? 15 : 0)
      + (isOfficialDomain(link.url) ? 10 : 0),
  };
}

function extractSearchResultUrls(html, searchUrl) {
  const urls = new Set();
  extractAnchors(html, searchUrl).forEach((anchor) => {
    const unwrapped = unwrapSearchResultUrl(anchor.url);
    if (!unwrapped || urls.has(unwrapped)) return;
    if (!isOfficialDomain(unwrapped)) return;
    if (/\/search|google|bing|naver|daum/i.test(new URL(unwrapped).hostname)) return;
    urls.add(unwrapped);
  });
  return [...urls];
}

async function scanYearbookPage(page, year, found) {
  if (YEARBOOK_DOC_PATTERN.test(page.url)) {
    found.push(makeYearbookCandidate({
      url: page.url,
      text: page.text || "",
      context: page.context || "",
    }, { year, sourcePage: page.sourcePage || page.url, officialDomain: page.officialDomain || "" }));
    return;
  }

  const html = await fetchTextDocument(page.url);
  const links = extractYearbookLinks(html, page.url);
  links.forEach((link) => {
    found.push(makeYearbookCandidate(link, {
      year,
      sourcePage: page.url,
      officialDomain: page.officialDomain || "",
    }));
  });
}

async function findYearbookFile(target, year) {
  const searchUrls = buildYearbookSearchUrls(target, year);
  const knownPages = getKnownYearbookPages(target).map((item) => ({
    url: item.page,
    sourcePage: item.page,
    officialDomain: item.domain,
  }));
  const pages = [...knownPages];
  const seenPages = new Set(pages.map((page) => page.url));
  const found = [];

  const searchResults = await Promise.allSettled(searchUrls.slice(0, 12).map(async (searchUrl) => {
    const html = await fetchTextDocument(searchUrl, 3500);
    return { searchUrl, urls: extractSearchResultUrls(html, searchUrl).slice(0, 8) };
  }));

  searchResults.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.urls.forEach((url) => {
      if (seenPages.has(url)) return;
      seenPages.add(url);
      pages.push({ url, sourcePage: result.value.searchUrl, officialDomain: new URL(url).hostname });
    });
  });

  for (const searchUrl of searchUrls.slice(12)) {
    try {
      const html = await fetchTextDocument(searchUrl);
      extractSearchResultUrls(html, searchUrl).slice(0, 8).forEach((url) => {
        if (seenPages.has(url)) return;
        seenPages.add(url);
        pages.push({ url, sourcePage: searchUrl, officialDomain: new URL(url).hostname });
      });
    } catch {
      // 검색엔진이 차단되거나 응답 구조가 바뀌어도 다른 검색 후보와 알려진 공식 페이지를 계속 시도합니다.
    }
    if (pages.length >= 20) break;
  }

  await Promise.allSettled(pages.slice(0, 20).map((page) => scanYearbookPage(page, year, found)));

  const selected = found
    .filter((link) => link.score > 0)
    .sort((left, right) => right.score - left.score)[0] || null;

  if (!selected) {
    return {
      status: "NO_SOURCE",
      message: `내장 검증값은 사용하지 않습니다. ${target.preferred} ${year}년 통계연보를 공식 홈페이지와 검색 후보에서 자동 탐색했지만 자동 다운로드 가능한 PDF/XLS 링크를 찾지 못했습니다.`,
      searchUrls,
      yearbookUrl: "",
      sourcePage: pages[0]?.url || "",
    };
  }

  return {
    status: "FOUND",
    message: `내장 검증값은 사용하지 않습니다. ${target.preferred} ${year}년 통계연보를 공식 홈페이지에서 자동 탐색합니다.`,
    ...selected,
    yearbookUrl: selected.url,
    searchUrls,
  };
}

async function downloadYearbook(yearbookFile) {
  if (!yearbookFile?.yearbookUrl) return null;
  const fileType = safe(yearbookFile.fileType).toLowerCase();
  if (fileType && fileType !== "pdf") {
    return {
      status: YEARBOOK_MANUAL_PATTERN.test(fileType) ? "MANUAL_REQUIRED" : "MANUAL_REQUIRED",
      message: `${fileType.toUpperCase()} 통계연보 링크는 찾았지만 현재 자동 표 추출은 PDF 우선으로 처리합니다.`,
    };
  }

  const response = await fetch(yearbookFile.yearbookUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/pdf,*/*",
      "User-Agent": "Mozilla/5.0 tia-support/1.0",
      Referer: yearbookFile.sourcePage || "",
    },
  });
  if (!response.ok) throw new Error(`통계연보 파일 다운로드 실패: ${response.status}`);
  return {
    status: "DOWNLOADED",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

function makeNoSourceCheck(name, kind, status, meta, note) {
  return {
    name,
    kind,
    kosis: "0",
    annualReport: "0",
    difference: "0",
    matched: false,
    requested_year: meta.requestedYear,
    kosis_available_year: meta.kosisAvailableYear || "",
    kosis_used_year: meta.kosisUsedYear || "",
    yearbook_file_year: meta.yearbookFileYear || "",
    yearbook_base_year: meta.yearbookBaseYear || "",
    yearbook_url: meta.yearbookUrl || "",
    source_table_title: meta.sourceTableTitle || "",
    source_unit: meta.sourceUnit || "",
    validation_status: status,
    validation_note: note,
  };
}

function compareAnnualValue({ name, kosisValue, annualValue, unitAllowsRounding, meta, statusOverride = "" }) {
  const difference = Math.abs(kosisValue - annualValue);
  const diffPctValue = kosisValue > 0 ? (difference / kosisValue) * 100 : (annualValue > 0 ? 100 : 0);
  let validationStatus = statusOverride;
  if (!validationStatus) {
    if (diffPctValue <= 0.1) validationStatus = "PASS";
    else if (diffPctValue <= 1 && unitAllowsRounding) validationStatus = "WARN_ROUNDING";
    else validationStatus = "FAIL";
  }

  const validationNote = meta.validationNote
    || (validationStatus === "PASS" ? "차이율 0.1% 이하입니다."
      : validationStatus === "WARN_ROUNDING" ? "차이율 0.1~1.0%이며 원자료 단위 반올림 영향 가능성이 있습니다."
        : validationStatus === "YEAR_MISMATCH" ? "KOSIS 조회연도와 통계연보 표 기준연도가 다릅니다."
          : validationStatus === "ADMIN_LEVEL_MISMATCH" ? "KOSIS 행정구역명과 통계연보 행정구역명이 달라 검증하지 않았습니다."
            : validationStatus === "CATEGORY_MISMATCH" ? "허용된 표 제목 또는 항목명과 일치하지 않습니다."
              : "수치 차이가 허용 기준을 초과합니다.");

  return {
    name,
    kosis: toAreaString(kosisValue),
    annualReport: toAreaString(annualValue),
    difference: toAreaString(difference),
    diff_pct: diffPctValue.toFixed(2),
    matched: validationStatus === "PASS" || validationStatus === "WARN_ROUNDING",
    requested_year: meta.requestedYear,
    kosis_available_year: meta.kosisAvailableYear || "",
    kosis_used_year: meta.kosisUsedYear || "",
    yearbook_file_year: meta.yearbookFileYear || "",
    yearbook_base_year: meta.yearbookBaseYear || "",
    yearbook_url: meta.yearbookUrl || "",
    source_table_title: meta.sourceTableTitle || "",
    source_unit: meta.sourceUnit || "",
    validation_status: validationStatus,
    validation_note: validationNote,
  };
}

function adminMatches(kosisAdminName, yearbookAdminName) {
  const left = normalizeName(kosisAdminName);
  const right = normalizeName(yearbookAdminName);
  return !left || !right || left.includes(right) || right.includes(left);
}

function compareCandidateToKosis({ candidate, kind, kosisData, target, requestedYear, yearbookFile }) {
  const kosisUsedYear = safe(kosisData?.kosisUsedYear || kosisData?.year);
  const yearbookBaseYear = safe(candidate?.yearbookBaseYear || yearbookFile?.fileYear);
  const sourceUnit = candidate?.sourceUnit || "㎡";
  const unitAllowsRounding = /km|ha|천/.test(sourceUnit);
  const commonMeta = {
    requestedYear,
    kosisAvailableYear: kosisData?.kosisAvailableYear || kosisData?.year || "",
    kosisUsedYear,
    yearbookFileYear: candidate?.yearbookFileYear || yearbookFile?.fileYear || "",
    yearbookBaseYear,
    yearbookUrl: yearbookFile?.yearbookUrl || "",
    sourceTableTitle: candidate?.sourceTableTitle || "",
    sourceUnit,
  };

  if (!candidate) {
    return [makeNoSourceCheck(kind === "landuse" ? "지목별 토지이용" : "용도지역", kind, "MANUAL_REQUIRED", commonMeta, "통계연보 파일은 찾았지만 해당 표를 자동 추출하지 못했습니다.")];
  }
  if (!kosisData) {
    return [makeNoSourceCheck(kind === "landuse" ? "지목별 토지이용" : "용도지역", kind, "NO_SOURCE", commonMeta, "비교할 KOSIS 결과가 없어 검증하지 않았습니다.")];
  }

  const statusOverride = !adminMatches(kosisData.regionName || target.preferred, candidate.yearbookAdminName)
    ? "ADMIN_LEVEL_MISMATCH"
    : (yearbookBaseYear && kosisUsedYear && yearbookBaseYear !== kosisUsedYear ? "YEAR_MISMATCH" : "");

  if (kind === "landuse") {
    return Object.entries(candidate.landuseAreas || {}).map(([name, value]) => compareAnnualValue({
      name,
      kosisValue: toNumber(kosisData.areas?.[name]),
      annualValue: toNumber(value),
      unitAllowsRounding,
      statusOverride,
      meta: commonMeta,
    }));
  }

  return (candidate.zoningRows || []).map((row) => {
    const kosisRow = (kosisData.rows || []).find((item) => normalizeName(item.name) === normalizeName(row.name));
    return compareAnnualValue({
      name: row.name,
      kosisValue: toNumber(kosisRow?.area),
      annualValue: toNumber(row.area),
      unitAllowsRounding,
      statusOverride,
      meta: commonMeta,
    });
  });
}

function compareAreaMap(kosisMap = {}, reportMap = {}) {
  return Object.entries(reportMap).map(([name, reportValue]) => {
    const kosisValue = toNumber(kosisMap[name]);
    const annualValue = toNumber(reportValue);
    return {
      name,
      kosis: toAreaString(kosisValue),
      annualReport: toAreaString(annualValue),
      difference: toAreaString(Math.abs(kosisValue - annualValue)),
      matched: Math.round(kosisValue) === Math.round(annualValue),
    };
  });
}

function compareZoningRows(kosisRows = [], reportRows = []) {
  return reportRows.map((reportRow) => {
    const kosisRow = kosisRows.find((row) => normalizeName(row.name) === normalizeName(reportRow.name));
    const kosisValue = toNumber(kosisRow?.area);
    const annualValue = toNumber(reportRow.area);
    return {
      name: reportRow.name,
      kosis: toAreaString(kosisValue),
      annualReport: toAreaString(annualValue),
      difference: toAreaString(Math.abs(kosisValue - annualValue)),
      matched: Math.round(kosisValue) === Math.round(annualValue),
    };
  });
}

async function buildAnnualReportVerification(target, province, year, landuse, zoning) {
  const yearbookFile = await findYearbookFile(target, year);
  const baseMeta = {
    requestedYear: year,
    kosisAvailableYear: landuse?.kosisAvailableYear || zoning?.kosisAvailableYear || "",
    kosisUsedYear: landuse?.kosisUsedYear || zoning?.kosisUsedYear || "",
    yearbookFileYear: yearbookFile.fileYear || "",
    yearbookBaseYear: "",
    yearbookUrl: yearbookFile.yearbookUrl || "",
    sourceTableTitle: "",
    sourceUnit: "",
  };

  if (yearbookFile.status === "NO_SOURCE") {
    return {
      status: "NO_SOURCE",
      year,
      requested_year: year,
      kosis_available_year: baseMeta.kosisAvailableYear,
      kosis_used_year: baseMeta.kosisUsedYear,
      yearbook_file_year: "",
      yearbook_base_year: "",
      yearbook_url: "",
      source_table_title: "",
      source_unit: "",
      source: yearbookFile.sourcePage || "",
      sourceLink: yearbookFile.sourcePage || yearbookFile.searchUrls?.[0] || "",
      message: `${yearbookFile.message} KOSIS 결과는 생성되었으며, 검증상태는 NO_SOURCE로 저장했습니다.`,
      landuse: [makeNoSourceCheck("지목별 토지이용", "landuse", "NO_SOURCE", baseMeta, "통계연보 파일을 자동으로 찾지 못했습니다.")],
      zoning: [makeNoSourceCheck("용도지역", "zoning", "NO_SOURCE", baseMeta, "통계연보 파일을 자동으로 찾지 못했습니다.")],
    };
  }

  try {
    const downloaded = await downloadYearbook(yearbookFile);
    if (downloaded?.status !== "DOWNLOADED") {
      return {
        status: "MANUAL_REQUIRED",
        year,
        requested_year: year,
        kosis_available_year: baseMeta.kosisAvailableYear,
        kosis_used_year: baseMeta.kosisUsedYear,
        yearbook_file_year: yearbookFile.fileYear || "",
        yearbook_base_year: "",
        yearbook_url: yearbookFile.yearbookUrl || "",
        source_table_title: "",
        source_unit: "",
        source: yearbookFile.sourcePage || "",
        sourceLink: yearbookFile.yearbookUrl || yearbookFile.sourcePage || "",
        message: `${downloaded?.message || "통계연보 자동 추출에 실패했습니다."} KOSIS 결과는 생성되었으며, 검증상태는 MANUAL_REQUIRED로 저장했습니다.`,
        landuse: [makeNoSourceCheck("지목별 토지이용", "landuse", "MANUAL_REQUIRED", baseMeta, downloaded?.message || "자동 추출 대상 파일이 아닙니다.")],
        zoning: [makeNoSourceCheck("용도지역", "zoning", "MANUAL_REQUIRED", baseMeta, downloaded?.message || "자동 추출 대상 파일이 아닙니다.")],
      };
    }

    const analysis = analyzeYearbookPdfBuffer(downloaded.buffer, {
      fileName: `${target.preferred}_${yearbookFile.fileYear || year}_통계연보.pdf`,
      year,
      source: `${target.preferred} ${yearbookFile.fileYear || year} 통계연보 PDF`,
    });
    const landuseCandidate = analysis.candidates.find((candidate) => candidate.kind === "landuse");
    const zoningCandidate = analysis.candidates.find((candidate) => candidate.kind === "zoning");
    const landuseChecks = compareCandidateToKosis({
      candidate: landuseCandidate,
      kind: "landuse",
      kosisData: landuse,
      target,
      requestedYear: year,
      yearbookFile,
    });
    const zoningChecks = compareCandidateToKosis({
      candidate: zoningCandidate,
      kind: "zoning",
      kosisData: zoning,
      target,
      requestedYear: year,
      yearbookFile,
    });
    const checks = [...landuseChecks, ...zoningChecks];
    const statuses = new Set(checks.map((item) => item.validation_status));
    const status = statuses.has("FAIL") ? "FAIL"
      : statuses.has("CATEGORY_MISMATCH") ? "CATEGORY_MISMATCH"
        : statuses.has("ADMIN_LEVEL_MISMATCH") ? "ADMIN_LEVEL_MISMATCH"
          : statuses.has("YEAR_MISMATCH") ? "YEAR_MISMATCH"
            : statuses.has("MANUAL_REQUIRED") ? "MANUAL_REQUIRED"
              : statuses.has("WARN_ROUNDING") ? "WARN_ROUNDING"
                : "PASS";
    const firstCandidate = landuseCandidate || zoningCandidate;

    return {
      status,
      year,
      requested_year: year,
      kosis_available_year: firstCandidate ? (landuse?.kosisAvailableYear || zoning?.kosisAvailableYear || "") : baseMeta.kosisAvailableYear,
      kosis_used_year: firstCandidate ? (landuse?.kosisUsedYear || zoning?.kosisUsedYear || "") : baseMeta.kosisUsedYear,
      yearbook_file_year: firstCandidate?.yearbookFileYear || yearbookFile.fileYear || "",
      yearbook_base_year: firstCandidate?.yearbookBaseYear || "",
      yearbook_url: yearbookFile.yearbookUrl || "",
      source_table_title: firstCandidate?.sourceTableTitle || "",
      source_unit: firstCandidate?.sourceUnit || "",
      source: analysis.source,
      sourceLink: yearbookFile.yearbookUrl || yearbookFile.sourcePage || "",
      message: status === "PASS"
        ? `${target.preferred} 통계연보 PDF를 자동 추출해 KOSIS 결과와 비교했습니다.`
        : `통계연보 자동 추출을 수행했습니다. KOSIS 결과는 생성되었으며, 검증상태는 ${status}로 저장했습니다.`,
      landuse: landuseChecks,
      zoning: zoningChecks,
    };
  } catch (error) {
    const fallback = pickAnnualReportEntry(target, province, year);
    const fallbackMessage = fallback
      ? `자동 추출 실패로 선택적 보조 기준값을 확인할 수 있습니다. ${error.message}`
      : `통계연보 자동 추출에 실패했습니다. KOSIS 결과는 생성되었으며, 검증상태는 MANUAL_REQUIRED로 저장했습니다. ${error.message}`;
    return {
      status: "MANUAL_REQUIRED",
      year,
      requested_year: year,
      kosis_available_year: baseMeta.kosisAvailableYear,
      kosis_used_year: baseMeta.kosisUsedYear,
      yearbook_file_year: yearbookFile.fileYear || "",
      yearbook_base_year: "",
      yearbook_url: yearbookFile.yearbookUrl || "",
      source_table_title: "",
      source_unit: "",
      source: fallback?.source || yearbookFile.sourcePage || "",
      sourceLink: yearbookFile.yearbookUrl || yearbookFile.sourcePage || fallback?.sourceLink || "",
      message: fallbackMessage,
      landuse: [makeNoSourceCheck("지목별 토지이용", "landuse", "MANUAL_REQUIRED", baseMeta, error.message)],
      zoning: [makeNoSourceCheck("용도지역", "zoning", "MANUAL_REQUIRED", baseMeta, error.message)],
    };
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const address = safe(body.address);
    const year = normalizeYear(body.year);
    if (!address) {
      return NextResponse.json({ error: "주소지가 비어 있습니다." }, { status: 400 });
    }

    const province = detectProvince(address);
    if (!province) {
      return NextResponse.json({ error: "주소에서 시도명을 찾지 못했습니다." }, { status: 400 });
    }

    const target = extractAdministrativeTarget(address, province);
    if (!target.preferred) {
      return NextResponse.json({ error: "주소에서 시군구 단위를 찾지 못했습니다." }, { status: 400 });
    }

    const cachedLanduse = buildCachedLanduse(target, province, year);
    const cachedZoning = buildCachedZoning(target, province, year, { allowLatest: true });
    const [liveLanduse, liveZoning] = process.env.KOSIS_API_KEY
      ? await Promise.all([
        buildLanduse(address, target, province, year).catch((error) => ({ error: error.message })),
        buildZoning(address, target, province, year).catch((error) => ({ error: error.message })),
      ])
      : [null, null];

    const landuse = liveLanduse?.areas ? liveLanduse : cachedLanduse;
    const zoning = liveZoning?.rows ? liveZoning : cachedZoning;
    const verification = await buildAnnualReportVerification(target, province, year, landuse, zoning);
    const warnings = [
      liveLanduse?.error && cachedLanduse ? "KOSIS 실시간 연결 실패로 내장 캐시의 지목별 토지이용 자료를 사용했습니다." : liveLanduse?.error,
      liveZoning?.error && cachedZoning ? "KOSIS 실시간 연결 실패로 내장 캐시의 용도지역 자료를 사용했습니다." : liveZoning?.error,
      zoning?.validationNote,
    ].filter(Boolean);

    return NextResponse.json({
      address,
      province: province.full,
      target: target.preferred,
      year,
      landuse: landuse?.areas ? landuse : null,
      zoning: zoning?.rows ? zoning : null,
      verification,
      warnings,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "KOSIS 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
