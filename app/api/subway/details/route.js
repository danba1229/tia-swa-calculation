import { NextResponse } from "next/server";
import { findSubwayStations, getSubwaySchedule, resolveSubwayIdentity, validateSubwaySlots } from "../../../../lib/subway.js";
export const maxDuration = 60;
export async function POST(request) {
  try {
    const { scope, stationId, placeId, slots } = await request.json();
    try { validateSubwaySlots(slots); }
    catch { return NextResponse.json({ success: false, message: "운행일·방향을 확인해 주세요." }, { status: 400 }); }
    const result = await findSubwayStations(scope);
    let station = result.stations.find(s => s.id === placeId);
    if (station && !station.subwayStationId) station = await resolveSubwayIdentity(station);
    if (!station?.subwayStationId || station.subwayStationId !== stationId) return NextResponse.json({ success: false, message: "조사 범위의 지하철역을 선택해 주세요." }, { status: 400 });
    return NextResponse.json({ success: true, stationId, ...await getSubwaySchedule(station, slots) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "지하철 시간표 조회 실패. 역 목록은 유지합니다." }, { status: 502 }); }
}
