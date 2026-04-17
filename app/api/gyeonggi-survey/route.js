import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const GITS_OCCASIONAL_PAGE_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do";
const GITS_ROUTE_CATALOG_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/getChangeLoadCate.do";
const GITS_OCCASIONAL_LOAD_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolumeLoad.do";
const GITS_SOURCE_LINK = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do";
const GITS_FALLBACK_LINK = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do";
const CATEGORY_LABELS = {
  "1": "고속도로",
  "2": "일반국도",
  "3": "국가지원지방도",
  "4": "지방도",
  "5": "시군도",
};

let latestYearPromise = null;
let routeCatalogPromise = null;

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeRouteText(value) {
  return safe(value)
    .replace(/\s+/g, "")
    .replace(/[()\-~]/g, "")
    .replace(/제2/g, "제2")
    .replace(/제1/g, "제1");
}

function normalizePointCode(value) {
  return safe(value).replace(/\.0$/, "");
}

function extractRoadNumber(value) {
  const match = safe(value).match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : "";
}

function buildAddressTokens(address) {
  return Array.from(
    new Set(
      safe(address)
        .split(/\s+/)
        .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter((part) => part.length >= 2),
    ),
  );
}

function scoreRouteMatch(roadName, routeName) {
  const rawRoad = safe(roadName);
  const rawRoute = safe(routeName);

  if (!rawRoad || !rawRoute) return 0;

  const normalizedRoad = normalizeRouteText(rawRoad);
  const normalizedRoute = normalizeRouteText(rawRoute);

  if (rawRoad === rawRoute || normalizedRoad === normalizedRoute) return 120;
  if (normalizedRoute.includes(normalizedRoad) || normalizedRoad.includes(normalizedRoute)) return 100;

  const roadNumber = extractRoadNumber(rawRoad);
  const routeNumber = extractRoadNumber(rawRoute);

  if (roadNumber && routeNumber && roadNumber === routeNumber) {
    if (/고속도로/.test(rawRoad) && /고속도로/.test(rawRoute)) return 90;
    if (/(국도|일반국도)/.test(rawRoad) && /일반국도/.test(rawRoute)) return 90;
    if (/(국가지원지방도)/.test(rawRoad) && /국가지원지방도/.test(rawRoute)) return 90;
    if (/지방도/.test(rawRoad) && /지방도/.test(rawRoute)) return 90;
    if (/(시도|군도|시군도)/.test(rawRoad) && /시도/.test(rawRoute)) return 90;
  }

  return 0;
}

async function fetchLatestYear() {
  if (!latestYearPromise) {
    latestYearPromise = (async () => {
      const response = await fetch(GITS_OCCASIONAL_PAGE_URL, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load GITS occasional traffic page");
      }

      const html = await response.text();
      const years = Array.from(html.matchAll(/<option value ="?(\d{4})"?/g)).map((match) => Number(match[1]));
      const latestYear = years.filter(Number.isFinite).sort((a, b) => b - a)[0];
      return latestYear ? String(latestYear) : "2024";
    })().catch((error) => {
      latestYearPromise = null;
      throw error;
    });
  }

  return latestYearPromise;
}

async function fetchRouteCatalog() {
  if (!routeCatalogPromise) {
    routeCatalogPromise = (async () => {
      const results = [];

      for (const admin of Object.keys(CATEGORY_LABELS)) {
        const url = `${GITS_ROUTE_CATALOG_URL}?admin=${encodeURIComponent(admin)}`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "X-Requested-With": "XMLHttpRequest",
            Referer: GITS_OCCASIONAL_PAGE_URL,
          },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load GITS route catalog for admin ${admin}`);
        }

        const rows = await response.json();
        rows.forEach((row) => {
          results.push({
            code: safe(row.no_line),
            name: safe(row.name_line),
            category: admin,
            categoryLabel: CATEGORY_LABELS[admin],
          });
        });
      }

      return results;
    })().catch((error) => {
      routeCatalogPromise = null;
      throw error;
    });
  }

  return routeCatalogPromise;
}

function pickMatchedRoutes(roadNames, routeCatalog) {
  const selected = [];
  const seen = new Set();

  roadNames.forEach((roadName, roadIndex) => {
    const best = routeCatalog
      .map((route) => ({
        ...route,
        score: scoreRouteMatch(roadName, route.name),
      }))
      .filter((route) => route.score >= 90)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"))[0];

    if (!best || seen.has(best.code)) return;

    seen.add(best.code);
    selected.push({
      ...best,
      matchedRoadName: roadName,
      roadOrder: roadIndex,
    });
  });

  return selected
    .sort((a, b) => a.roadOrder - b.roadOrder || a.name.localeCompare(b.name, "ko"))
    .slice(0, 3);
}

async function fetchOccasionalPointsForRoutes(routes, year) {
  const groups = routes.reduce((map, route) => {
    if (!map.has(route.category)) map.set(route.category, []);
    map.get(route.category).push(route);
    return map;
  }, new Map());

  const routeOrder = new Map(routes.map((route, index) => [route.code, index]));
  const points = [];
  const seen = new Set();

  for (const [category, categoryRoutes] of groups.entries()) {
    const params = new URLSearchParams();
    params.set("year1", year);
    params.set("roadcate", category);
    categoryRoutes.forEach((route) => params.append("lineLocal01", route.code));
    params.set("direction", "0");
    params.set("T_Start", "07");
    params.set("T_End", "09");
    params.set("mode", "Excel");
    params.set("excelTitle", "OccasionalTrafficVolume");
    params.set("excelCaption", "19#연도, 지점번호, 호선명, 방향, 시간대, 행정구역, 구간명, 1종 ~ 12종, 전차종합계로 구성되어 있음");
    params.set("excelLabelTop", "");
    params.set("excelLabel", "연도,지점번호,호선명,방향,시간대,행정구역,구간명,1종,2종,3종,4종,5종,6종,7종,8종,9종,10종,11종,12종,전차종합계");

    const response = await fetch(GITS_OCCASIONAL_LOAD_URL, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: GITS_OCCASIONAL_PAGE_URL,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: params,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to load GITS occasional traffic xlsx for category ${category}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });

    rows.slice(2).forEach((row) => {
      const pointCode = normalizePointCode(row[1]);
      const routeName = safe(row[2]);
      const jurisdiction = safe(row[5]);
      const sectionName = safe(row[6]);

      if (!pointCode || !routeName || !sectionName) return;

      const dedupeKey = `${routeName}:${pointCode}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const route = categoryRoutes.find((item) => item.name === routeName) || categoryRoutes[0];

      points.push({
        pointCode,
        pointName: sectionName,
        routeName,
        routeCode: route?.code || "",
        jurisdiction: jurisdiction || "-",
        sectionName,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        routeOrder: routeOrder.get(route?.code || "") ?? Number.MAX_SAFE_INTEGER,
      });
    });
  }

  return points;
}

function pickCandidatePoints(points, address) {
  const tokens = buildAddressTokens(address);

  return points
    .map((point) => {
      let tokenScore = 0;
      tokens.forEach((token) => {
        if (point.jurisdiction.includes(token)) tokenScore += 3;
        if (point.sectionName.includes(token)) tokenScore += 2;
      });

      return {
        ...point,
        tokenScore,
      };
    })
    .sort((a, b) => {
      const scoreDiff = b.tokenScore - a.tokenScore;
      if (scoreDiff !== 0) return scoreDiff;
      const routeDiff = a.routeOrder - b.routeOrder;
      if (routeDiff !== 0) return routeDiff;
      return a.pointCode.localeCompare(b.pointCode, "ko");
    })
    .slice(0, 18);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const address = safe(body.address);
    const roadNames = Array.isArray(body.roadNames) ? body.roadNames.map(safe).filter(Boolean) : [];

    if (!address || !roadNames.length) {
      return NextResponse.json({
        year: null,
        matchedRoutes: [],
        points: [],
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      });
    }

    const [year, routeCatalog] = await Promise.all([fetchLatestYear(), fetchRouteCatalog()]);
    const matchedRoutes = pickMatchedRoutes(roadNames, routeCatalog);

    if (!matchedRoutes.length) {
      return NextResponse.json({
        year,
        matchedRoutes: [],
        points: [],
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      });
    }

    const points = await fetchOccasionalPointsForRoutes(matchedRoutes, year);
    const candidatePoints = pickCandidatePoints(points, address);

    return NextResponse.json({
      year,
      matchedRoutes: matchedRoutes.map((route) => ({
        code: route.code,
        name: route.name,
        category: route.category,
        categoryLabel: route.categoryLabel,
        matchedRoadName: route.matchedRoadName,
      })),
      points: candidatePoints,
      sourceLink: GITS_SOURCE_LINK,
      downloadLink: GITS_SOURCE_LINK,
      fallbackLink: GITS_FALLBACK_LINK,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: "Failed to build Gyeonggi survey recommendations.",
        year: null,
        matchedRoutes: [],
        points: [],
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      },
      { status: 500 },
    );
  }
}
