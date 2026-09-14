import { NextResponse } from "next/server";
import { readSession } from "../../../../../lib/indicatorAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = readSession(request);
  return NextResponse.json(user ? { authenticated: true, user } : { authenticated: false }, { status: user ? 200 : 401 });
}
