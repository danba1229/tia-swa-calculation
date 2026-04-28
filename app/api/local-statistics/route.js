import { NextResponse } from "next/server";
import localStatisticsCache from "../../local-statistics-cache.json";

export const runtime = "nodejs";

const KOSIS_BASE = "http://kosis.kr/openapi";
const LANDUSE_TABLE = { orgId: "116", tblId: "DT_MLTM_2300" };
const URBAN_ZONING_TABLE = { orgId: "460", tblId: "TX_315_2009_H1440" };
const NON_URBAN_ZONING_TABLE = { orgId: "460", tblId: "TX_315_2009_H1443" };

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

function pickCachedEntry(collection, target, province) {
  return (Array.isArray(collection) ? collection : []).find((entry) => (
    matchesProvince(entry, province) && matchesRegion(entry, target)
  )) || null;
}

function buildCachedLanduse(target, province) {
  const entry = pickCachedEntry(localStatisticsCache.landuse, target, province);
  if (!entry) return null;
  return {
    areas: entry.areas,
    year: entry.year,
    regionName: entry.region,
    source: entry.source,
    cached: true,
  };
}

function buildCachedZoning(target, province) {
  const entry = pickCachedEntry(localStatisticsCache.zoning, target, province);
  if (!entry) return null;
  return {
    rows: entry.rows,
    year: entry.year,
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

async function fetchKosisRows(table, { itemId, objL1 = "", objL2 = "", objL3 = "" }) {
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
    newEstPrdCnt: "1",
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
    .reduce((sum, row) => sum + toNumber(row.DT), 0);
}

async function buildLanduse(address, target, province) {
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
  });

  const areas = {};
  Object.entries(LANDUSE_TARGETS).forEach(([appName, kosisName]) => {
    areas[appName] = toAreaString(sumAreas(rows, kosisName));
  });

  const total = sumAreas(rows, "계");
  const selectedTotal = Object.values(areas).reduce((sum, value) => sum + toNumber(value), 0);
  areas.기타 = toAreaString(Math.max(0, total - selectedTotal));

  const year = rows.find((row) => row.PRD_DE)?.PRD_DE || "";
  const regionName = rows.find((row) => row.C2_NM)?.C2_NM || localCode.ITM_NM;

  return {
    areas,
    year,
    regionName,
    source: `${regionName} 지목별 국토이용현황(KOSIS 국토교통부 ${year})`,
  };
}

async function fetchZoningPart(table, target, province, names) {
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
  });
}

async function buildZoning(address, target, province) {
  const [urbanRows, nonUrbanRows] = await Promise.all([
    fetchZoningPart(URBAN_ZONING_TABLE, target, province, URBAN_ZONING_NAMES),
    fetchZoningPart(NON_URBAN_ZONING_TABLE, target, province, NON_URBAN_ZONING_NAMES),
  ]);

  const rows = [...urbanRows, ...nonUrbanRows]
    .filter((row) => row.C2_NM && row.ITM_NM === "면적")
    .map((row) => ({
      name: row.C2_NM,
      area: toAreaString(row.DT),
    }));

  if (!rows.length) return null;

  const year = [...urbanRows, ...nonUrbanRows].find((row) => row.PRD_DE)?.PRD_DE || "";
  const regionName = [...urbanRows, ...nonUrbanRows].find((row) => row.C1_NM)?.C1_NM || target.preferred;

  return {
    rows,
    year,
    regionName,
    source: `${regionName} 용도지역현황(KOSIS 도시계획현황 ${year})`,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const address = safe(body.address);
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

    const cachedLanduse = buildCachedLanduse(target, province);
    const cachedZoning = buildCachedZoning(target, province);
    const [liveLanduse, liveZoning] = process.env.KOSIS_API_KEY
      ? await Promise.all([
        buildLanduse(address, target, province).catch((error) => ({ error: error.message })),
        buildZoning(address, target, province).catch((error) => ({ error: error.message })),
      ])
      : [null, null];

    const landuse = liveLanduse?.areas ? liveLanduse : cachedLanduse;
    const zoning = liveZoning?.rows ? liveZoning : cachedZoning;
    const warnings = [
      liveLanduse?.error && cachedLanduse ? "KOSIS 실시간 연결 실패로 내장 캐시의 지목별 토지이용 자료를 사용했습니다." : liveLanduse?.error,
      liveZoning?.error && cachedZoning ? "KOSIS 실시간 연결 실패로 내장 캐시의 용도지역 자료를 사용했습니다." : liveZoning?.error,
    ].filter(Boolean);

    return NextResponse.json({
      address,
      province: province.full,
      target: target.preferred,
      landuse: landuse?.areas ? landuse : null,
      zoning: zoning?.rows ? zoning : null,
      warnings,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "KOSIS 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
