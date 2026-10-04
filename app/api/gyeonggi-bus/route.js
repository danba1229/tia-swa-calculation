import { NextResponse } from "next/server";
import { searchGyeonggiBus } from "../../../lib/gyeonggiBus.js";
import { validateSnapshotScope } from "../../../lib/seoulBusSnapshot.js";
export const maxDuration = 60;
export async function POST(request) {
  let scope;
  try { scope = await request.json(); validateSnapshotScope(scope); }
  catch { return NextResponse.json({ success: false, message: "조사 범위를 확인해 주세요." }, { status: 400 }); }
  try { return NextResponse.json(await searchGyeonggiBus(scope), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 502 }); }
}
