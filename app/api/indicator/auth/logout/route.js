import { NextResponse } from "next/server";
import { assertSameOrigin, clearSessionCookie } from "../../../../../lib/indicatorAuth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    return clearSessionCookie(NextResponse.json({ success: true }));
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
