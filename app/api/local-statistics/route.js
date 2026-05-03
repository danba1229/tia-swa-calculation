import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_STATISTICS_YEAR = "2024";
const KOSIS_ENDPOINT = "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const KOSIS_META_ENDPOINT = "https://kosis.kr/openapi/statisticsData.do";
const KOSIS_STAT_HTML = "https://kosis.kr/statHtml/statHtml.do";

const LANDUSE_TABLE = {
  orgId: "116",
  tblId: "DT_MLTM_2300",
  name: "행정구역별·지목별 국토이용현황_시군구",
  source: "KOSIS 국토교통부, 행정구역별·지목별 국토이용현황_시군구",
  areaItemId: "13103874596T1",
  provinceObjKey: "objL1",
  provinceObjId: "13101874596A",
  regionObjKey: "objL2",
  regionObjId: "13101874596B",
  categoryObjKey: "objL3",
  categoryObjId: "13101874596C",
};

const ZONING_URBAN_TABLE = {
  orgId: "460",
  tblId: "TX_315_2009_H1440",
  name: "용도지역(시군구)-도시지역",
  source: "KOSIS 도시계획현황, 용도지역(시군구)-도시지역",
  areaItemId: "16315T2009_046",
  regionObjKey: "objL1",
  regionObjId: "15315SGG",
  categoryObjKey: "objL2",
  categoryObjId: "15315JYB",
};

const ZONING_NON_URBAN_TABLE = {
  orgId: "460",
  tblId: "TX_315_2009_H1443",
  name: "용도지역(시군구)-비도시지역",
  source: "KOSIS 도시계획현황, 용도지역(시군구)-비도시지역",
  areaItemId: "16315T2009_184",
  regionObjKey: "objL1",
  regionObjId: "15315SGG",
  categoryObjKey: "objL2",
  categoryObjId: "15315JYB",
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
const LANDUSE_CATEGORY_CODES = {
  계: "13102874596C.0001",
  전: "13102874596C.0002",
  답: "13102874596C.0003",
  임야: "13102874596C.0006",
  대지: "13102874596C.0009",
  학교: "13102874596C.0011",
  도로: "13102874596C.0015",
  하천: "13102874596C.0018",
  공원: "13102874596C.0023",
};
const ZONING_CATEGORY_CODES = {
  도시지역: "15315JYB001",
  주거지역: "15315JYB002",
  상업지역: "15315JYB003",
  공업지역: "15315JYB004",
  녹지지역: "15315JYB005",
  미지정지역: "15315JYB006",
  비도시지역: "15315JYB007",
  관리지역: "15315JYB008",
  농림지역: "15315JYB009",
  자연환경보전지역: "15315JYB010",
};

const LANDUSE_REPORT_ITEMS = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원"];
const ZONING_REPORT_ITEMS = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "농림지역", "자연환경보전지역", "미지정지역"];

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return safe(value)
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/특별자치도|특별자치시|특별시|광역시/g, "")
    .replace(/경기도/g, "경기");
}

function normalizeYear(value) {
  return safe(value).match(/\d{4}/)?.[0] || DEFAULT_STATISTICS_YEAR;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toAreaString(value) {
  const parsed = toNumber(value);
  return parsed === null ? "" : String(Math.round(parsed));
}

function makeKosisUrl(table, params) {
  const apiKey = process.env.KOSIS_API_KEY;
  if (!apiKey) throw new Error("KOSIS_API_KEY 환경변수가 설정되어 있지 않습니다.");

  const url = new URL(KOSIS_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("method", params.method || "getList");
  url.searchParams.set("format", "json");
  url.searchParams.set("jsonVD", "Y");
  url.searchParams.set("orgId", table.orgId);
  url.searchParams.set("tblId", table.tblId);

  Object.entries(params).forEach(([key, value]) => {
    if (key !== "method" && value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url;
}

function statHtmlUrl(table) {
  const url = new URL(KOSIS_STAT_HTML);
  url.searchParams.set("orgId", table.orgId);
  url.searchParams.set("tblId", table.tblId);
  return url.toString();
}

async function fetchKosisJson(table, params) {
  const response = await fetch(makeKosisUrl(table, params), {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 tia-support/3.0",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`KOSIS 조회 실패: ${response.status}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`KOSIS 응답을 JSON으로 읽지 못했습니다: ${text.slice(0, 120)}`);
  }

  if (Array.isArray(data)) return data;
  if (data?.err || data?.error || data?.message) {
    throw new Error(safe(data.err || data.error || data.message) || "KOSIS 오류 응답을 받았습니다.");
  }
  return [];
}

async function fetchMeta(table) {
  const apiKey = process.env.KOSIS_API_KEY;
  if (!apiKey) throw new Error("KOSIS_API_KEY 환경변수가 설정되어 있지 않습니다.");

  const url = new URL(KOSIS_META_ENDPOINT);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("method", "getMeta");
  url.searchParams.set("format", "json");
  url.searchParams.set("jsonVD", "Y");
  url.searchParams.set("type", "ITM");
  url.searchParams.set("orgId", table.orgId);
  url.searchParams.set("tblId", table.tblId);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 tia-support/3.0",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`KOSIS 메타데이터 조회 실패: ${response.status}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`KOSIS 메타데이터 응답을 JSON으로 읽지 못했습니다: ${text.slice(0, 120)}`);
  }

  if (Array.isArray(data)) return data;
  if (data?.err || data?.error || data?.message) {
    throw new Error(safe(data.errMsg || data.err || data.error || data.message) || "KOSIS 메타데이터 오류 응답을 받았습니다.");
  }
  return [];
}

async function fetchDataRows(table, year, objectParams) {
  return fetchKosisJson(table, {
    itmId: table.areaItemId,
    prdSe: "Y",
    startPrdDe: year,
    endPrdDe: year,
    ...objectParams,
  });
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

  if (province.short === "세종") return { province, preferred: "세종특별자치시", city, district, level: "city" };
  if (METRO_SHORT_NAMES.has(province.short)) return { province, preferred: district || city || province.short, city, district, level: district ? "district" : "city" };
  if (province.short === "경기") return { province, preferred: city || district || province.short, city, district, level: city ? "city" : "district" };
  return { province, preferred: city || district || province.short, city, district, level: city ? "city" : "district" };
}

function rowCode(row) {
  return safe(row.ITM_ID || row.CD || row.CODE || row.OBJ_ID || row.id);
}

function rowName(row) {
  return safe(row.ITM_NM || row.CD_NM || row.C1_NM || row.C2_NM || row.C3_NM || row.name);
}

function objectRows(meta, objectId) {
  return meta.filter((row) => safe(row.OBJ_ID) === objectId || safe(row.OBJ_ID_ENG) === objectId);
}

function scoreNameMatch(row, names) {
  const normalized = normalizeName(rowName(row));
  const raw = safe(rowName(row));
  const candidates = names.map(normalizeName).filter(Boolean);
  if (!normalized || !candidates.length) return 0;
  if (candidates.some((name) => normalized === name)) return 100;
  if (candidates.some((name) => raw === name)) return 95;
  if (candidates.some((name) => normalized.endsWith(name) || name.endsWith(normalized))) return 80;
  if (candidates.some((name) => normalized.includes(name) || name.includes(normalized))) return 60;
  return 0;
}

function findObjectCodes(meta, objectId, names, parentCode = "") {
  return objectRows(meta, objectId)
    .map((row) => ({
      row,
      code: rowCode(row),
      score: scoreNameMatch(row, names) + (parentCode && safe(row.UP_ITM_ID) === parentCode ? 15 : 0),
    }))
    .filter((item) => item.code && item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function categoryName(row) {
  return safe(row.C3_NM || row.C2_NM || row.C1_NM || row.ITM_NM);
}

function categoryCode(row) {
  return safe(row.C3 || row.C2 || row.C1 || row.ITM_ID);
}

function areaFromRows(rows, expectedCode, expectedNames = []) {
  const byCode = rows.find((row) => categoryCode(row) === expectedCode);
  if (byCode) return toNumber(byCode.DT);

  const names = expectedNames.map(normalizeName);
  const byName = rows.find((row) => names.includes(normalizeName(categoryName(row))));
  return toNumber(byName?.DT);
}

function sumKnown(values) {
  return values.reduce((total, value) => total + (toNumber(value) ?? 0), 0);
}

function makeLanduseAreas(rows) {
  const areas = {};
  LANDUSE_REPORT_ITEMS.forEach((item) => {
    areas[item] = toAreaString(areaFromRows(rows, LANDUSE_CATEGORY_CODES[item], item === "대지" ? ["대", "대지"] : [item]));
  });

  const total = areaFromRows(rows, LANDUSE_CATEGORY_CODES.계, ["계", "합계", "총계"]);
  const majorTotal = sumKnown(Object.values(areas));
  areas.기타 = total === null ? "" : toAreaString(Math.max(0, total - majorTotal));
  return { areas, total };
}

function makeZoningRows(urbanRows, nonUrbanRows) {
  const byCategory = {
    주거지역: areaFromRows(urbanRows, ZONING_CATEGORY_CODES.주거지역, ["주거지역"]),
    상업지역: areaFromRows(urbanRows, ZONING_CATEGORY_CODES.상업지역, ["상업지역"]),
    공업지역: areaFromRows(urbanRows, ZONING_CATEGORY_CODES.공업지역, ["공업지역"]),
    녹지지역: areaFromRows(urbanRows, ZONING_CATEGORY_CODES.녹지지역, ["녹지지역"]),
    관리지역: areaFromRows(nonUrbanRows, ZONING_CATEGORY_CODES.관리지역, ["관리지역"]),
    농림지역: areaFromRows(nonUrbanRows, ZONING_CATEGORY_CODES.농림지역, ["농림지역"]),
    자연환경보전지역: areaFromRows(nonUrbanRows, ZONING_CATEGORY_CODES.자연환경보전지역, ["자연환경보전지역"]),
    미지정지역: areaFromRows(urbanRows, ZONING_CATEGORY_CODES.미지정지역, ["미세분지역", "미지정", "미지정지역"]),
  };

  const urbanTotal = areaFromRows(urbanRows, ZONING_CATEGORY_CODES.도시지역, ["도시지역"]);
  const nonUrbanTotal = areaFromRows(nonUrbanRows, ZONING_CATEGORY_CODES.비도시지역, ["비도시지역"]);
  const total = (urbanTotal ?? 0) + (nonUrbanTotal ?? 0);
  const majorTotal = sumKnown(Object.values(byCategory));
  const rows = ZONING_REPORT_ITEMS.map((name) => ({
    name,
    area: toAreaString(byCategory[name]),
    rawItems: name === "미지정지역" ? "미세분지역" : name,
  }));

  rows.push({
    name: "기타",
    area: total > 0 ? toAreaString(Math.max(0, total - majorTotal)) : "",
    rawItems: "도시지역+비도시지역 합계 - 주요 항목 합계",
  });

  return { rows: rows.filter((row) => row.name === "기타" || row.area !== ""), total };
}

async function chooseDataRowsByCandidates(table, year, candidates, objectParamsFactory) {
  const attempts = [];
  for (const candidate of candidates) {
    const objectParams = objectParamsFactory(candidate.code);
    const rows = await fetchDataRows(table, year, objectParams);
    attempts.push({
      code: candidate.code,
      name: rowName(candidate.row),
      rowCount: rows.length,
    });
    if (rows.length) return { rows, selected: candidate, attempts };
  }
  return { rows: [], selected: null, attempts };
}

async function extractLanduse(target, year) {
  const meta = await fetchMeta(LANDUSE_TABLE);
  const provinceCodes = findObjectCodes(meta, LANDUSE_TABLE.provinceObjId, [
    target.province.full,
    target.province.short,
    ...target.province.aliases,
  ]);
  const provinceCode = provinceCodes[0]?.code;
  if (!provinceCode) throw new Error(`KOSIS 지목별 표에서 ${target.province.full} 코드를 찾지 못했습니다.`);

  const regionCandidates = findObjectCodes(meta, LANDUSE_TABLE.regionObjId, [
    target.preferred,
    target.city,
    target.district,
  ]).slice(0, 12);
  if (!regionCandidates.length) throw new Error(`KOSIS 지목별 표에서 ${target.preferred} 행정구역 코드를 찾지 못했습니다.`);

  const data = await chooseDataRowsByCandidates(
    LANDUSE_TABLE,
    year,
    regionCandidates,
    (regionCode) => ({
      [LANDUSE_TABLE.provinceObjKey]: provinceCode,
      [LANDUSE_TABLE.regionObjKey]: regionCode,
      [LANDUSE_TABLE.categoryObjKey]: "ALL",
    }),
  );

  const { areas, total } = makeLanduseAreas(data.rows);
  return {
    status: data.rows.length ? "SUCCESS" : "DATA_NOT_FOUND",
    table: LANDUSE_TABLE,
    metaCount: meta.length,
    regionName: data.selected ? rowName(data.selected.row) : target.preferred,
    regionCode: data.selected?.code || "",
    provinceCode,
    rowCount: data.rows.length,
    attempts: data.attempts,
    areas,
    total,
    rows: data.rows,
  };
}

async function extractZoning(target, year) {
  const urbanMeta = await fetchMeta(ZONING_URBAN_TABLE);
  const nonUrbanMeta = await fetchMeta(ZONING_NON_URBAN_TABLE);
  const provinceCandidates = findObjectCodes(urbanMeta, ZONING_URBAN_TABLE.regionObjId, [
    target.province.full,
    target.province.short,
    ...target.province.aliases,
  ]);
  const provinceCode = provinceCandidates[0]?.code || "";
  const regionCandidates = findObjectCodes(urbanMeta, ZONING_URBAN_TABLE.regionObjId, [
    target.preferred,
    target.city,
    target.district,
  ], provinceCode).slice(0, 16);
  if (!regionCandidates.length) throw new Error(`KOSIS 용도지역 표에서 ${target.preferred} 행정구역 코드를 찾지 못했습니다.`);

  const urban = await chooseDataRowsByCandidates(
    ZONING_URBAN_TABLE,
    year,
    regionCandidates,
    (regionCode) => ({
      [ZONING_URBAN_TABLE.regionObjKey]: regionCode,
      [ZONING_URBAN_TABLE.categoryObjKey]: "ALL",
    }),
  );

  const nonUrbanCandidates = urban.selected ? [urban.selected] : regionCandidates;
  const nonUrban = await chooseDataRowsByCandidates(
    ZONING_NON_URBAN_TABLE,
    year,
    nonUrbanCandidates,
    (regionCode) => ({
      [ZONING_NON_URBAN_TABLE.regionObjKey]: regionCode,
      [ZONING_NON_URBAN_TABLE.categoryObjKey]: "ALL",
    }),
  );

  const { rows, total } = makeZoningRows(urban.rows, nonUrban.rows);
  return {
    status: urban.rows.length || nonUrban.rows.length ? "SUCCESS" : "DATA_NOT_FOUND",
    tables: [ZONING_URBAN_TABLE, ZONING_NON_URBAN_TABLE],
    urbanMetaCount: urbanMeta.length,
    nonUrbanMetaCount: nonUrbanMeta.length,
    regionName: urban.selected ? rowName(urban.selected.row) : target.preferred,
    regionCode: urban.selected?.code || nonUrban.selected?.code || "",
    provinceCode,
    urbanRowCount: urban.rows.length,
    nonUrbanRowCount: nonUrban.rows.length,
    urbanAttempts: urban.attempts,
    nonUrbanAttempts: nonUrban.attempts,
    rows,
    total,
    rawRows: { urban: urban.rows, nonUrban: nonUrban.rows },
  };
}

function makeExtractionSummary({ target, year, landuse, zoning }) {
  const successCount = [landuse.status, zoning.status].filter((status) => status === "SUCCESS").length;
  const status = successCount === 2 ? "SUCCESS" : successCount === 1 ? "PARTIAL" : "DATA_NOT_FOUND";
  const message = status === "SUCCESS"
    ? `${target.preferred} ${year}년 수록기간 기준 KOSIS 지목별/용도지역 자료를 추출했습니다.`
    : status === "PARTIAL"
      ? `${target.preferred} ${year}년 KOSIS 자료 중 일부 표만 추출했습니다.`
      : `${target.preferred} ${year}년 KOSIS 자료를 찾지 못했습니다.`;

  return {
    status,
    message,
    source: "KOSIS OpenAPI",
    sourceLink: "https://kosis.kr/",
    admin_area: target.preferred,
    admin_level: target.level,
    province: target.province.full,
    base_year: year,
    kosis_used_year: year,
    period: year,
    landuse_status: landuse.status,
    zoning_status: zoning.status,
    landuse_table: LANDUSE_TABLE.name,
    zoning_tables: `${ZONING_URBAN_TABLE.name}, ${ZONING_NON_URBAN_TABLE.name}`,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const address = safe(body.address);
    const year = normalizeYear(body.year || body.base_year);
    if (!address) return NextResponse.json({ error: "주소지가 비어 있습니다." }, { status: 400 });

    const target = resolveAdminArea(address);
    if (!target.province || !target.preferred) {
      return NextResponse.json({ error: "주소에서 지자체 단위를 찾지 못했습니다." }, { status: 400 });
    }

    const [landuse, zoning] = await Promise.all([
      extractLanduse(target, year),
      extractZoning(target, year),
    ]);
    const extraction = makeExtractionSummary({ target, year, landuse, zoning });

    return NextResponse.json({
      address,
      target: target.preferred,
      province: target.province.full,
      year,
      base_year: year,
      extraction,
      verification: extraction,
      landuse: landuse.status === "SUCCESS" ? {
        areas: landuse.areas,
        year,
        regionName: landuse.regionName,
        source: LANDUSE_TABLE.source,
        sourceLink: statHtmlUrl(LANDUSE_TABLE),
        tableBaseYear: year,
        tableTitle: LANDUSE_TABLE.name,
        tableId: LANDUSE_TABLE.tblId,
      } : null,
      zoning: zoning.status === "SUCCESS" ? {
        rows: zoning.rows,
        year,
        regionName: zoning.regionName,
        source: "KOSIS 도시계획현황, 용도지역(시군구)-도시지역/비도시지역",
        sourceLink: statHtmlUrl(ZONING_URBAN_TABLE),
        tableBaseYear: year,
        tableTitle: `${ZONING_URBAN_TABLE.name}, ${ZONING_NON_URBAN_TABLE.name}`,
        tableId: `${ZONING_URBAN_TABLE.tblId}, ${ZONING_NON_URBAN_TABLE.tblId}`,
      } : null,
      warnings: extraction.status === "SUCCESS" ? [] : [extraction.message],
      debug: {
        address,
        resolved_admin_area: target,
        requested_year: year,
        kosis_tables: {
          landuse: LANDUSE_TABLE,
          zoningUrban: ZONING_URBAN_TABLE,
          zoningNonUrban: ZONING_NON_URBAN_TABLE,
        },
        landuse: {
          status: landuse.status,
          meta_count: landuse.metaCount,
          row_count: landuse.rowCount,
          province_code: landuse.provinceCode,
          region_code: landuse.regionCode,
          region_name: landuse.regionName,
          attempts: landuse.attempts,
          mapped_areas: landuse.areas,
          total_m2: landuse.total,
        },
        zoning: {
          status: zoning.status,
          urban_meta_count: zoning.urbanMetaCount,
          non_urban_meta_count: zoning.nonUrbanMetaCount,
          urban_row_count: zoning.urbanRowCount,
          non_urban_row_count: zoning.nonUrbanRowCount,
          province_code: zoning.provinceCode,
          region_code: zoning.regionCode,
          region_name: zoning.regionName,
          urban_attempts: zoning.urbanAttempts,
          non_urban_attempts: zoning.nonUrbanAttempts,
          mapped_rows: zoning.rows,
          total_m2: zoning.total,
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "KOSIS 자료 추출 중 오류가 발생했습니다." }, { status: 500 });
  }
}
