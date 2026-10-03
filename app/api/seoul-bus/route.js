import { NextResponse } from "next/server";
import { searchSeoulBusSnapshot, validateSnapshotScope } from "../../../lib/seoulBusSnapshot";

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

    try {
      validateSnapshotScope({ center, bounds, width, height });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 400 },
      );
    }

    const result = searchSeoulBusSnapshot({
      center,
      bounds,
      width,
      height,
    });

    return NextResponse.json(result);
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
