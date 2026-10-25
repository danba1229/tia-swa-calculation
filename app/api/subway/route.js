import { NextResponse } from "next/server";
import { findSubwayStations } from "../../../lib/subway.js";
import { validateSnapshotScope } from "../../../lib/seoulBusSnapshot.js";
export const maxDuration = 60;
export async function POST(request) {
  // Bad input is the caller's error (400); only upstream failures are 502.
  let scope;
  try { scope = await request.json(); validateSnapshotScope(scope, "지하철역"); }
  catch (error) { return NextResponse.json({ success: false, message: error instanceof SyntaxError ? "요청 형식이 올바르지 않습니다." : error.message }, { status: 400 }); }
  try { return NextResponse.json(await findSubwayStations(scope), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 502 }); }
}
