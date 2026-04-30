import { NextResponse } from "next/server";
import { analyzeYearbookPdfBuffer, analyzeYearbookText } from "../statistics-pdf/route";

export const runtime = "nodejs";

const DEFAULT_STATISTICS_YEAR = "2024";
const YEARBOOK_OFFICIAL_PAGES = [
  {
    region: "송파구",
    domain: "www.songpa.go.kr",
    pages: ["https://www.songpa.go.kr/www/contents.do?key=2233"],
  },
];
const YEARBOOK_DOC_PATTERN = /\.(pdf|xlsx|xls|csv|hwp|hwpx)(?:[?#]|$)|download|down|file|attach|atch/i;
const YEARBOOK_MANUAL_PATTERN = /\.(hwp|hwpx)(?:[?#]|$)|hwp|hwpx/i;
const OFFICIAL_DOMAIN_PATTERN = /(^|\.)go\.kr$/i;
const SEARCH_ENGINE_HOSTS = new Set(["www.google.com", "google.com", "www.bing.com", "bing.com", "search.naver.com", "search.daum.net"]);

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

const LANDUSE_REPORT_ITEMS = [
  { key: "전", labels: ["전"] },
  { key: "답", labels: ["답"] },
  { key: "임야", labels: ["임야"] },
  { key: "대지", labels: ["대지", "대"] },
  { key: "도로", labels: ["도로"] },
  { key: "하천", labels: ["하천"] },
  { key: "학교", labels: ["학교", "학교용지"] },
  { key: "공원", labels: ["공원"] },
];
const ZONING_REPORT_ITEMS = [
  { key: "주거지역", labels: ["주거지역"] },
  { key: "상업지역", labels: ["상업지역"] },
  { key: "공업지역", labels: ["공업지역"] },
  { key: "녹지지역", labels: ["녹지지역"] },
  { key: "관리지역", labels: ["관리지역"] },
  { key: "농림지역", labels: ["농림지역"] },
  { key: "자연환경보전지역", labels: ["자연환경보전지역"] },
  { key: "미지정지역", labels: ["미지정", "미지정지역", "미세분지역"] },
];
const TOTAL_LABELS = ["합계", "계", "총계"];

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return safe(value).replace(/\s+/g, "").replace(/[()]/g, "");
}

function normalizeYear(value) {
  return safe(value).match(/\d{4}/)?.[0] || DEFAULT_STATISTICS_YEAR;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toAreaString(value) {
  const parsed = toNullableNumber(value);
  return parsed === null ? "" : String(Math.round(parsed));
}

function sumKnown(values) {
  return values.reduce((sum, value) => {
    const parsed = toNullableNumber(value);
    return parsed === null ? sum : sum + parsed;
  }, 0);
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
    return OFFICIAL_DOMAIN_PATTERN.test(new URL(url).hostname.toLowerCase());
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
    anchors.push({ url, text: stripTags(match[2]), context });
  }
  return anchors;
}

function extractYearbookLinks(html, pageUrl) {
  return extractAnchors(html, pageUrl).filter(({ url, text, context }) => {
    const source = `${url} ${text} ${context}`;
    return YEARBOOK_DOC_PATTERN.test(source)
      && /통계|연보|statistics|statistical|yearbook|토지|지적|용도지역/i.test(source);
  });
}

function inferFileType(link) {
  const source = `${link.url} ${link.text} ${link.context}`.toLowerCase();
  return source.match(/\b(pdf|xlsx|xls|csv|hwpx|hwp)\b|\.([a-z0-9]+)(?:[?#]|$)/)?.[1]
    || source.match(/\.([a-z0-9]+)(?:[?#]|$)/)?.[1]
    || (source.includes("pdf") ? "pdf" : "");
}

function detectProvince(address) {
  const compact = normalizeName(address);
  return PROVINCES.find((province) => province.aliases.some((alias) => compact.includes(normalizeName(alias)))) || null;
}

function resolveAdminArea(address) {
  const province = detectProvince(address);
  const parts = safe(address).split(/\s+/).map((part) => part.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (!province) return { province: null, preferred: "", city: "", district: "" };

  const aliases = new Set(province.aliases.map(normalizeName));
  const localParts = parts.filter((part) => !aliases.has(normalizeName(part)));
  const city = localParts.find((part) => /(시|군)$/.test(part) && !/도$/.test(part)) || "";
  const district = localParts.find((part) => /구$/.test(part)) || "";

  if (province.short === "세종") return { province, preferred: "세종특별자치시", city, district };
  if (METRO_SHORT_NAMES.has(province.short)) return { province, preferred: district || city || province.short, city, district };
  if (province.short === "경기") return { province, preferred: city || district || province.short, city, district };
  return { province, preferred: city || district || province.short, city, district };
}

function getKnownYearbookPages(target) {
  const preferred = normalizeName(target?.preferred);
  return YEARBOOK_OFFICIAL_PAGES
    .filter((source) => normalizeName(source.region) === preferred)
    .flatMap((source) => source.pages.map((page) => ({ ...source, page })));
}

function buildReportYears(baseYear) {
  const parsed = Number(baseYear);
  if (!Number.isFinite(parsed)) return [safe(baseYear)].filter(Boolean);
  return [String(parsed + 1), String(parsed)];
}

function buildYearbookSearchUrls(target, reportYear, baseYear) {
  const region = safe(target?.preferred);
  const queries = [
    `${region} ${reportYear} 통계연보 PDF`,
    `${region} 통계연보 ${reportYear}`,
    `site:go.kr ${region} ${reportYear} 통계연보`,
    `site:go.kr ${region} ${baseYear} 기준 통계연보 토지 용도지역`,
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
      "User-Agent": "Mozilla/5.0 tia-support/2.0",
    },
  });
  if (!response.ok) throw new Error(`통계연보 페이지 조회 실패: ${response.status}`);
  return response.text();
}

function makeYearbookCandidate(link, { reportYear, baseYear, sourcePage = "", officialDomain = "" }) {
  const source = safe(`${link.context} ${link.text} ${link.url}`);
  const years = [...source.matchAll(/(20\d{2}|19\d{2})/g)].map((match) => match[1]);
  const fileYear = years.includes(safe(reportYear)) ? safe(reportYear) : (years.at(-1) || "");
  const fileType = inferFileType(link);
  const exactReportYear = fileYear === safe(reportYear) || link.context.includes(`${reportYear}년`) || link.text.includes(`${reportYear}년`);
  const isPdf = fileType === "pdf" || /\.pdf(?:[?#]|$)/i.test(link.url);
  return {
    ...link,
    fileYear,
    reportYear: fileYear || reportYear,
    baseYear,
    fileType: fileType || (isPdf ? "pdf" : ""),
    sourcePage,
    officialDomain,
    score: (exactReportYear ? 100 : 0) + (isPdf ? 30 : 0) + (/통계|연보/.test(source) ? 15 : 0) + (isOfficialDomain(link.url) ? 10 : 0),
  };
}

function extractSearchResultUrls(html, searchUrl) {
  const urls = new Set();
  extractAnchors(html, searchUrl).forEach((anchor) => {
    const unwrapped = unwrapSearchResultUrl(anchor.url);
    if (!unwrapped || urls.has(unwrapped) || !isOfficialDomain(unwrapped)) return;
    urls.add(unwrapped);
  });
  return [...urls];
}

async function scanYearbookPage(page, reportYear, baseYear, found) {
  if (YEARBOOK_DOC_PATTERN.test(page.url)) {
    found.push(makeYearbookCandidate({ url: page.url, text: page.text || "", context: page.context || "" }, { reportYear, baseYear, sourcePage: page.sourcePage || page.url, officialDomain: page.officialDomain || "" }));
    return;
  }

  const html = await fetchTextDocument(page.url);
  extractYearbookLinks(html, page.url).forEach((link) => {
    found.push(makeYearbookCandidate(link, { reportYear, baseYear, sourcePage: page.url, officialDomain: page.officialDomain || "" }));
  });
}

async function findAnnualReport(target, baseYear) {
  const reportYears = buildReportYears(baseYear);
  const searchUrls = reportYears.flatMap((reportYear) => buildYearbookSearchUrls(target, reportYear, baseYear));
  const knownPages = getKnownYearbookPages(target).map((item) => ({ url: item.page, sourcePage: item.page, officialDomain: item.domain }));
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

  await Promise.allSettled(reportYears.flatMap((reportYear) => (
    pages.slice(0, 20).map((page) => scanYearbookPage(page, reportYear, baseYear, found))
  )));

  const selected = found
    .filter((link) => link.score > 0)
    .sort((left, right) => right.score - left.score)[0] || null;

  if (!selected) {
    return {
      status: "REPORT_NOT_FOUND",
      reportYears,
      searchUrls,
      yearbookUrl: "",
      message: `${target.preferred} ${reportYears.join("/")} 통계연보 파일을 자동으로 찾지 못했습니다.`,
    };
  }

  return {
    status: "FOUND",
    ...selected,
    yearbookUrl: selected.url,
    reportYears,
    searchUrls,
  };
}

async function downloadReport(report) {
  if (!report?.yearbookUrl) return { status: "REPORT_NOT_FOUND" };
  if (YEARBOOK_MANUAL_PATTERN.test(report.fileType || report.yearbookUrl)) {
    return { status: "UNSUPPORTED_FILE_TYPE", message: "HWP/HWPX 통계연보는 자동 추출이 어려워 수동 입력 또는 PDF 업로드가 필요합니다." };
  }

  const response = await fetch(report.yearbookUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*",
      "User-Agent": "Mozilla/5.0 tia-support/2.0",
      Referer: report.sourcePage || "",
    },
  });
  if (!response.ok) throw new Error(`통계연보 파일 다운로드 실패: ${response.status}`);
  return { status: "DOWNLOADED", buffer: Buffer.from(await response.arrayBuffer()) };
}

async function analyzeDownloadedReport(buffer, report, baseYear) {
  const fileType = safe(report.fileType).toLowerCase();
  const fileName = `${report.preferred || "통계연보"}_${report.reportYear || report.fileYear || ""}.${fileType || "pdf"}`;
  const source = `${report.reportYear || report.fileYear || ""} 통계연보`;

  if (!fileType || fileType === "pdf") {
    return analyzeYearbookPdfBuffer(buffer, { fileName, year: baseYear, source });
  }

  if (["xlsx", "xls", "csv"].includes(fileType)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const text = workbook.SheetNames.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      return `\n[${sheetName}]\n${csv}`;
    }).join("\n");
    return analyzeYearbookText(text, { fileName, year: baseYear, source });
  }

  return { candidates: [], message: "지원하지 않는 통계연보 파일 형식입니다." };
}

function pickValue(source, labels) {
  for (const label of labels) {
    const value = source?.[label];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function selectCandidate(candidates, kind, baseYear) {
  const typed = candidates.filter((candidate) => candidate.kind === kind);
  if (!typed.length) return { status: "TABLE_NOT_FOUND", candidate: null };
  const sameYear = typed.find((candidate) => candidate.yearbookBaseYear === baseYear);
  if (sameYear) {
    if (!sameYear.sourceUnit) return { status: "UNKNOWN_UNIT", candidate: sameYear };
    return { status: sameYear.yearbookValueExtracted ? "SUCCESS" : "VALUE_PARSE_FAILED", candidate: sameYear };
  }
  const unknown = typed.find((candidate) => !candidate.yearbookBaseYear);
  if (unknown) return { status: "UNKNOWN_BASE_YEAR", candidate: unknown };
  return { status: "BASE_YEAR_MISMATCH", candidate: typed[0] };
}

function buildLanduseAreas(candidate) {
  if (!candidate) return null;
  const areas = {};
  LANDUSE_REPORT_ITEMS.forEach((item) => {
    areas[item.key] = toAreaString(pickValue(candidate.landuseAreas, item.labels));
  });
  const total = toNullableNumber(pickValue(candidate.landuseAreas, TOTAL_LABELS));
  const majorTotal = sumKnown(Object.values(areas));
  areas.기타 = total === null ? "" : toAreaString(Math.max(0, total - majorTotal));
  return areas;
}

function buildZoningRows(candidate) {
  if (!candidate) return null;
  const sourceRows = candidate.zoningRows || [];
  const findArea = (labels) => {
    const row = sourceRows.find((item) => labels.some((label) => normalizeName(item.name) === normalizeName(label)));
    return row?.area ?? null;
  };
  const rows = ZONING_REPORT_ITEMS.map((item) => ({
    name: item.key,
    area: toAreaString(findArea(item.labels)),
    rawItems: item.labels.join(", "),
  }));
  const totalRow = sourceRows.find((item) => TOTAL_LABELS.some((label) => normalizeName(item.name) === normalizeName(label)));
  const total = toNullableNumber(totalRow?.area);
  const majorTotal = sumKnown(rows.map((row) => row.area));
  rows.push({
    name: "기타",
    area: total === null ? "" : toAreaString(Math.max(0, total - majorTotal)),
    rawItems: "합계 - 주요 항목 합계",
  });
  return rows.filter((row) => row.name === "기타" || row.area !== "");
}

function makeExtractionSummary({ target, baseYear, report, analysis, landuseSelection, zoningSelection }) {
  const statuses = [landuseSelection.status, zoningSelection.status];
  const status = statuses.every((item) => item === "SUCCESS") ? "SUCCESS"
    : statuses.includes("UNKNOWN_BASE_YEAR") ? "UNKNOWN_BASE_YEAR"
      : statuses.includes("BASE_YEAR_MISMATCH") ? "BASE_YEAR_MISMATCH"
        : statuses.includes("UNKNOWN_UNIT") ? "UNKNOWN_UNIT"
          : statuses.includes("VALUE_PARSE_FAILED") ? "VALUE_PARSE_FAILED"
            : "TABLE_NOT_FOUND";
  const selectedCandidates = [landuseSelection.candidate, zoningSelection.candidate].filter(Boolean);
  const baseYears = [...new Set(selectedCandidates.map((candidate) => candidate.yearbookBaseYear).filter(Boolean))];

  return {
    status,
    message: status === "SUCCESS"
      ? `${target.preferred} ${baseYear}년 기준 통계연보 표를 추출했습니다.`
      : `통계연보 원자료 추출 상태: ${status}. 표 후보와 기준연도를 확인해 주세요.`,
    source: analysis?.source || "",
    sourceLink: report.yearbookUrl || "",
    admin_area: target.preferred,
    base_year: baseYear,
    report_year: report.reportYear || report.fileYear || "",
    table_base_year: baseYears.join(", "),
    yearbook_url: report.yearbookUrl || "",
    landuse_status: landuseSelection.status,
    zoning_status: zoningSelection.status,
    candidates: (analysis?.candidates || []).map((candidate) => ({
      kind: candidate.kind,
      title: candidate.sourceTableTitle || candidate.title,
      foundCount: candidate.foundCount,
      table_base_year: candidate.yearbookBaseYear || "",
      unit: candidate.sourceUnit || "",
      preview: candidate.preview || "",
    })),
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const address = safe(body.address);
    const baseYear = normalizeYear(body.year || body.base_year);
    if (!address) return NextResponse.json({ error: "주소지가 비어 있습니다." }, { status: 400 });

    const target = resolveAdminArea(address);
    if (!target.province || !target.preferred) {
      return NextResponse.json({ error: "주소에서 지자체 단위를 찾지 못했습니다." }, { status: 400 });
    }

    const report = await findAnnualReport(target, baseYear);
    if (report.status !== "FOUND") {
      return NextResponse.json({
        address,
        target: target.preferred,
        province: target.province.full,
        base_year: baseYear,
        extraction: {
          status: report.status,
          message: report.message,
          admin_area: target.preferred,
          base_year: baseYear,
          report_year_candidates: report.reportYears || [],
          yearbook_url: "",
        },
        landuse: null,
        zoning: null,
        warnings: [report.message],
        debug: { address, admin_area: target.preferred, base_year: baseYear, report_year_candidates: report.reportYears || [], selected_url: "" },
      });
    }

    const downloaded = await downloadReport(report);
    if (downloaded.status !== "DOWNLOADED") {
      return NextResponse.json({
        address,
        target: target.preferred,
        province: target.province.full,
        base_year: baseYear,
        extraction: {
          status: downloaded.status || "MANUAL_UPLOAD_REQUIRED",
          message: downloaded.message || "통계연보 파일을 자동 처리하지 못했습니다.",
          admin_area: target.preferred,
          base_year: baseYear,
          report_year: report.reportYear || report.fileYear || "",
          yearbook_url: report.yearbookUrl || "",
        },
        landuse: null,
        zoning: null,
        warnings: [downloaded.message || "통계연보 직접 업로드 또는 수동 입력이 필요합니다."],
      });
    }

    const analysis = await analyzeDownloadedReport(downloaded.buffer, report, baseYear);
    const landuseSelection = selectCandidate(analysis.candidates || [], "landuse", baseYear);
    const zoningSelection = selectCandidate(analysis.candidates || [], "zoning", baseYear);
    const extraction = makeExtractionSummary({ target, baseYear, report, analysis, landuseSelection, zoningSelection });
    const landuseAreas = landuseSelection.status === "SUCCESS" ? buildLanduseAreas(landuseSelection.candidate) : null;
    const zoningRows = zoningSelection.status === "SUCCESS" ? buildZoningRows(zoningSelection.candidate) : null;

    return NextResponse.json({
      address,
      target: target.preferred,
      province: target.province.full,
      base_year: baseYear,
      year: baseYear,
      extraction,
      verification: extraction,
      landuse: landuseAreas ? {
        areas: landuseAreas,
        year: baseYear,
        regionName: target.preferred,
        source: `${target.preferred} ${report.reportYear || report.fileYear || ""} 통계연보`,
        reportYear: report.reportYear || report.fileYear || "",
        tableBaseYear: landuseSelection.candidate?.yearbookBaseYear || "",
        tableTitle: landuseSelection.candidate?.sourceTableTitle || "",
        page: landuseSelection.candidate?.pageNumber || "",
      } : null,
      zoning: zoningRows ? {
        rows: zoningRows,
        year: baseYear,
        regionName: target.preferred,
        source: `${target.preferred} ${report.reportYear || report.fileYear || ""} 통계연보`,
        reportYear: report.reportYear || report.fileYear || "",
        tableBaseYear: zoningSelection.candidate?.yearbookBaseYear || "",
        tableTitle: zoningSelection.candidate?.sourceTableTitle || "",
        page: zoningSelection.candidate?.pageNumber || "",
      } : null,
      warnings: extraction.status === "SUCCESS" ? [] : [extraction.message],
      debug: {
        address,
        admin_area: target.preferred,
        base_year: baseYear,
        searched_report_years: report.reportYears || [],
        selected_url: report.yearbookUrl || "",
        candidates: extraction.candidates,
        selected_landuse_table: landuseSelection.candidate?.sourceTableTitle || "",
        selected_zoning_table: zoningSelection.candidate?.sourceTableTitle || "",
        landuse_raw_values: landuseSelection.candidate?.landuseAreas || {},
        zoning_raw_values: zoningSelection.candidate?.zoningRows || [],
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "통계연보 추출 중 오류가 발생했습니다." }, { status: 500 });
  }
}
