import { NextResponse } from "next/server";
import { searchGyeonggiBus, fetchGyeonggiBusDetails, supplementGyeonggiStations } from "../../../../lib/gyeonggiBus.js";
import { validateDetailRouteIds } from "../../../../lib/seoulBusDetails.js";
export const maxDuration = 60;
export async function POST(request) {
  try {
    const { scope, routeIds, stationIds } = await request.json();
    validateDetailRouteIds([{ routes: (routeIds || []).map(busRouteId => ({ busRouteId })) }], routeIds);
    const result = await searchGyeonggiBus(scope);
    if (stationIds?.length) {
      const extra = await supplementGyeonggiStations(result.busStops, stationIds);
      result.busStops = result.busStops.map(stop => {
        const update = extra.updates.find(u => u.stationId === stop.stationId);
        return update?.routes.length ? { ...stop, routes: update.routes } : stop;
      });
    }
    validateDetailRouteIds(result.busStops, routeIds);
    return NextResponse.json(await fetchGyeonggiBusDetails(routeIds), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ success: false, message: "경기 버스 상세조회 실패. 조사 범위와 노선을 확인해 주세요." }, { status: 502 }); }
}
