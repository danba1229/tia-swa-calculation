import { NextResponse } from "next/server";
import { searchGyeonggiBus, supplementGyeonggiStations, validateStationIds } from "../../../../lib/gyeonggiBus.js";
import { validateSnapshotScope } from "../../../../lib/seoulBusSnapshot.js";
export const maxDuration = 60;
export async function POST(request) {
  let scope, stationIds;
  try {
    ({ scope, stationIds } = await request.json());
    validateSnapshotScope(scope);
    validateStationIds((stationIds || []).map(stationId => ({ stationId })), stationIds);
  } catch { return NextResponse.json({ success: false, message: "조사 범위와 정류장 ID를 확인해 주세요." }, { status: 400 }); }
  try {
    const result = await searchGyeonggiBus(scope);
    try { validateStationIds(result.busStops, stationIds); }
    catch { return NextResponse.json({ success: false, message: "조사 범위의 정류장이 아닙니다." }, { status: 400 }); }
    return NextResponse.json(await supplementGyeonggiStations(result.busStops, stationIds), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "경유노선 조회 실패. 기존 목록은 유지합니다." }, { status: 502 }); }
}
