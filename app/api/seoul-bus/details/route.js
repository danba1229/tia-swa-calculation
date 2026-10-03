import { NextResponse } from "next/server";
import { searchSeoulBusSnapshot } from "../../../../lib/seoulBusSnapshot.js";
import { fetchBusDetailBatch, validateDetailRouteIds } from "../../../../lib/seoulBusDetails.js";
import { getBusSnapshot } from "../../../../lib/seoulBusStore.js";

export const maxDuration = 30;

export async function POST(request) {
  let routeIds;
  try {
    const body = await request.json();
    const current = await getBusSnapshot();
    const snapshot = searchSeoulBusSnapshot(body.scope, current.snapshot);
    routeIds = body.routeIds;
    validateDetailRouteIds(snapshot.busStops, routeIds);
  } catch {
    return NextResponse.json({ success: false, message: "조사 범위와 상세조회 노선 ID를 확인해 주세요." }, { status: 400 });
  }
  try {
    const result = await fetchBusDetailBatch(routeIds);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "버스 상세정보 조회에 실패했습니다. 기본 목록은 유지합니다." }, { status: 502 });
  }
}
