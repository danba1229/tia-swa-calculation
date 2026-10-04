import { NextResponse } from "next/server";
import { findSubwayStations, getSubwaySchedule } from "../../../../lib/subway.js";
export const maxDuration = 60;
export async function POST(request) {
  try {
    const { scope, stationId } = await request.json();
    const result = await findSubwayStations(scope);
    if (!result.stations.some((station) => station.subwayStationId === stationId)) return NextResponse.json({ success: false, message: "조사 범위의 지하철역을 선택해 주세요." }, { status: 400 });
    return NextResponse.json({ success: true, stationId, ...await getSubwaySchedule(stationId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "지하철 시간표 조회 실패. 역 목록은 유지합니다." }, { status: 502 }); }
}
