import { NextResponse } from "next/server";
import { createBusSnapshotStore, isBusStoreConfigured } from "../../../../lib/seoulBusStore.js";
import { refreshBusSnapshot } from "../../../../lib/seoulBusRefresh.js";

export const maxDuration = 60;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (!isBusStoreConfigured()) return NextResponse.json({ success: false, status: "NOT_CONFIGURED" }, { status: 503 });
  try {
    const result = await refreshBusSnapshot(createBusSnapshotStore());
    return NextResponse.json({ success: result.status !== "FAILED", ...result }, {
      status: result.status === "FAILED" ? 503 : 200, headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ success: false, status: "STORE_UNAVAILABLE" }, { status: 503 });
  }
}
