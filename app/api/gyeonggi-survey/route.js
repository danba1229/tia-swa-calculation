import { NextResponse } from "next/server";
import gitsPointData from "../../gyeonggi-gits-points.json";

export const runtime = "nodejs";

const GITS_SOURCE_LINK =
  "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do";
const GITS_FALLBACK_LINK =
  "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do";

const ROUTES = Array.isArray(gitsPointData.routes) ? gitsPointData.routes : [];
const POINTS = Array.isArray(gitsPointData.points) ? gitsPointData.points : [];
const DATA_YEAR = gitsPointData.year || null;
const SOURCE_NAME = gitsPointData.source || "경기도교통정보시스템 수시교통량";

function safe(value) {
  return String(value ?? "").trim();
}

function normalizeRouteText(value) {
  return safe(value)
    .replace(/\s+/g, "")
    .replace(/[()\-~]/g, "")
    .replace(/번/g, "번")
    .replace(/호/g, "호");
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

function detectRoadKind(value) {
  const text = safe(value);
  if (/고속도로/.test(text)) return "expressway";
  if (/(국도|일반국도)/.test(text)) return "national";
  if (/국가지원지방도/.test(text)) return "national-support";
  if (/지방도/.test(text)) return "local";
  if (/(시도|군도|시군도)/.test(text)) return "city-county";
  return "unknown";
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
  const roadKind = detectRoadKind(rawRoad);
  const routeKind = detectRoadKind(rawRoute);

  if (roadNumber && routeNumber && roadNumber === routeNumber && roadKind === routeKind && roadKind !== "unknown") {
    return 90;
  }

  return 0;
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
        year: DATA_YEAR,
        matchedRoutes: [],
        points: [],
        source: SOURCE_NAME,
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      });
    }

    const matchedRoutes = pickMatchedRoutes(roadNames, ROUTES);

    if (!matchedRoutes.length) {
      return NextResponse.json({
        year: DATA_YEAR,
        matchedRoutes: [],
        points: [],
        source: SOURCE_NAME,
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      });
    }

    const routeCodes = new Set(matchedRoutes.map((route) => route.code));
    const matchedPoints = POINTS.filter((point) => routeCodes.has(point.routeCode));
    const candidatePoints = pickCandidatePoints(matchedPoints, address);

    return NextResponse.json({
      year: DATA_YEAR,
      matchedRoutes: matchedRoutes.map((route) => ({
        code: route.code,
        name: route.name,
        category: route.category,
        categoryLabel: route.categoryLabel,
        matchedRoadName: route.matchedRoadName,
      })),
      points: candidatePoints,
      source: SOURCE_NAME,
      sourceLink: GITS_SOURCE_LINK,
      downloadLink: GITS_SOURCE_LINK,
      fallbackLink: GITS_FALLBACK_LINK,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: "Failed to build Gyeonggi survey recommendations.",
        year: DATA_YEAR,
        matchedRoutes: [],
        points: [],
        source: SOURCE_NAME,
        sourceLink: GITS_SOURCE_LINK,
        downloadLink: GITS_SOURCE_LINK,
        fallbackLink: GITS_FALLBACK_LINK,
      },
      { status: 500 },
    );
  }
}
