import { NextResponse } from "next/server";
import { searchSeoulBusStopsInScope, validateSeoulBusScope } from "../../../lib/seoulBus";

function toNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const center = {
      lat: toNumber(body?.center?.lat),
      lng: toNumber(body?.center?.lng),
    };
    const bounds = {
      north: toNumber(body?.bounds?.north),
      south: toNumber(body?.bounds?.south),
      east: toNumber(body?.bounds?.east),
      west: toNumber(body?.bounds?.west),
    };
    const width = toNumber(body?.width);
    const height = toNumber(body?.height);
    const maxStations = body?.maxStations === undefined ? 35 : toNumber(body.maxStations);

    try {
      validateSeoulBusScope({ center, bounds, width, height, maxStations });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 400 },
      );
    }

    const result = await searchSeoulBusStopsInScope({
      center,
      bounds,
      width,
      height,
      maxStations,
    });

    return NextResponse.json({
      success: true,
      source: "서울특별시 버스정류소/노선 정보 API",
      sourceUrl: "https://www.data.go.kr/",
      summary: result.summary,
      busStops: result.stations,
      fetchedAt: result.fetchedAt,
    });
  } catch (error) {
    // Never log provider URLs/error bodies because they may contain credentials.
    return NextResponse.json(
      {
        success: false,
        message: error.message || "서울 버스정류장 조회에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
