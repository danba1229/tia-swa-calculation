import { NextResponse } from "next/server";
import { findSubwayStations } from "../../../lib/subway.js";
export const maxDuration = 60;
export async function POST(request) {
  try { return NextResponse.json(await findSubwayStations(await request.json()), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 502 }); }
}
