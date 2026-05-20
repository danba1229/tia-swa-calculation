import { NextResponse } from "next/server";
import { haversineDistanceMeters } from "../../../lib/distance";

const SEOUL_BIKE_SERVICE = "bikeList";
const SEOUL_OPEN_API_URL = "http://openapi.seoul.go.kr:8088";
const PAGE_SIZE = 1000;
const MAX_ROWS = 4000;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isInsideBounds(lat, lng, bounds) {
  return (
    lat >= bounds.south
    && lat <= bounds.north
    && lng >= bounds.west
    && lng <= bounds.east
  );
}

function parseStationNumber(stationName, stationId) {
  const match = String(stationName || "").trim().match(/^(\d+)\./);
  return match?.[1] || String(stationId || "").trim();
}

function cleanStationName(stationName) {
  return String(stationName || "").trim().replace(/^\d+\.\s*/, "");
}

async function fetchBikePage(apiKey, start, end) {
  const url = `${SEOUL_OPEN_API_URL}/${encodeURIComponent(apiKey)}/json/${SEOUL_BIKE_SERVICE}/${start}/${end}/`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`서울 열린데이터광장 API 호출 실패(${response.status})`);
  }

  const payload = await response.json();
  const result = payload?.rentBikeStatus?.RESULT || payload?.RESULT;

  if (result && result.CODE !== "INFO-000") {
    throw new Error(result.MESSAGE || `서울 열린데이터광장 응답 오류(${result.CODE})`);
  }

  return payload?.rentBikeStatus || { list_total_count: 0, row: [] };
}

export async function POST(request) {
  try {
    const apiKey = process.env.SEOUL_OPEN_API_KEY || process.env.SEOUL_DATA_API_KEY || "";

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message: "SEOUL_OPEN_API_KEY 환경변수가 설정되지 않았습니다.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();
    const center = {
      latitude: toNumber(body?.center?.lat),
      longitude: toNumber(body?.center?.lng),
    };
    const bounds = {
      north: toNumber(body?.bounds?.north),
      south: toNumber(body?.bounds?.south),
      east: toNumber(body?.bounds?.east),
      west: toNumber(body?.bounds?.west),
    };

    if (!Object.values(bounds).every(Number.isFinite) || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) {
      return NextResponse.json(
        {
          success: false,
          message: "따릉이 조회를 위한 중심 좌표와 조사 범위가 올바르지 않습니다.",
        },
        { status: 400 },
      );
    }

    const firstPage = await fetchBikePage(apiKey, 1, PAGE_SIZE);
    const totalCount = Math.min(Number(firstPage.list_total_count || 0), MAX_ROWS);
    const allRows = [...(firstPage.row || [])];

    for (let start = PAGE_SIZE + 1; start <= totalCount; start += PAGE_SIZE) {
      const end = Math.min(start + PAGE_SIZE - 1, totalCount);
      const page = await fetchBikePage(apiKey, start, end);
      allRows.push(...(page.row || []));
    }

    const stations = allRows
      .map((row) => {
        const latitude = toNumber(row.stationLatitude);
        const longitude = toNumber(row.stationLongitude);
        const distanceMeters = haversineDistanceMeters(center, { latitude, longitude });
        const stationName = cleanStationName(row.stationName);

        return {
          id: String(row.stationId || parseStationNumber(row.stationName, row.stationId) || stationName),
          stationNumber: parseStationNumber(row.stationName, row.stationId),
          stationName,
          location: stationName,
          rackCount: toNumber(row.rackTotCnt),
          parkingBikeCount: toNumber(row.parkingBikeTotCnt),
          latitude,
          longitude,
          distanceMeters,
          distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
          source: "서울 열린데이터광장 공공자전거 실시간 대여정보",
        };
      })
      .filter((station) => (
        Number.isFinite(station.latitude)
        && Number.isFinite(station.longitude)
        && isInsideBounds(station.latitude, station.longitude, bounds)
      ))
      .sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));

    return NextResponse.json({
      success: true,
      source: "서울 열린데이터광장 공공자전거 실시간 대여정보",
      sourceUrl: "https://data.seoul.go.kr/dataList/datasetView.do?infId=OA-15493&srvType=A&serviceKind=1",
      summary: {
        totalApiCount: Number(firstPage.list_total_count || allRows.length || 0),
        fetchedCount: allRows.length,
        withinScopeCount: stations.length,
      },
      stations,
    });
  } catch (error) {
    console.error("[seoul-bike]", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || "서울 따릉이 대여소 조회에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
