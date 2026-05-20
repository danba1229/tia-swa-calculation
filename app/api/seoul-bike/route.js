import { NextResponse } from "next/server";
import seoulBikeStations from "../../seoul-bike-stations.json";
import { haversineDistanceMeters } from "../../../lib/distance";

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

export async function POST(request) {
  try {
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

    const stations = seoulBikeStations
      .map((station) => {
        const latitude = toNumber(station.latitude);
        const longitude = toNumber(station.longitude);
        const distanceMeters = haversineDistanceMeters(center, { latitude, longitude });

        return {
          id: String(station.stationNumber || station.stationName || ""),
          stationNumber: station.stationNumber || "",
          stationName: station.stationName || "",
          location: station.address || station.district || station.stationName || "",
          district: station.district || "",
          address: station.address || "",
          rackCount: toNumber(station.rackCount),
          latitude,
          longitude,
          distanceMeters,
          distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
          source: "서울특별시_공공자전거 대여소 정보",
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
      source: "서울특별시_공공자전거 대여소 정보(25.12월 기준)",
      sourceUrl: "https://www.data.go.kr/data/15051893/fileData.do",
      summary: {
        totalMasterCount: seoulBikeStations.length,
        fetchedCount: seoulBikeStations.length,
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
