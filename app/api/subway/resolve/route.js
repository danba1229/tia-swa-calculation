import { NextResponse } from "next/server";
import { findSubwayStations, resolveSubwayIdentity } from "../../../../lib/subway.js";
export const maxDuration = 60;
export async function POST(request) {
  try {
    const { scope, placeId } = await request.json();
    if (typeof placeId !== "string" || !/^\d{1,30}$/.test(placeId)) return NextResponse.json({ success: false }, { status: 400 });
    const result = await findSubwayStations(scope);
    const station = result.stations.find(s => s.id === placeId);
    if (!station) return NextResponse.json({ success: false, message: "조사 범위의 역이 아닙니다." }, { status: 400 });
    return NextResponse.json({ success: true, station: station.subwayStationId ? station : await resolveSubwayIdentity(station) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "역 코드 조회 실패. 기존 목록은 유지합니다." }, { status: 502 }); }
}
