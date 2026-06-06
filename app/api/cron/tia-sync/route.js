import { NextResponse } from "next/server";
import { defaultSyncPeriod, syncTiaBusinessPeriod } from "../../../../lib/tiaBusinessSync";
import { isTiaDatabaseConfigured } from "../../../../lib/tiaDatabase";

function authorize(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request) {
  try {
    if (!authorize(request)) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    if (!isTiaDatabaseConfigured()) {
      return NextResponse.json({ success: false, message: "DATABASE_URL이 설정되지 않았습니다." }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const period = defaultSyncPeriod();
    const startDate = searchParams.get("startDate") || period.startDate;
    const endDate = searchParams.get("endDate") || period.endDate;
    const maxPages = Number(searchParams.get("maxPages")) || 250;
    const summary = await syncTiaBusinessPeriod({ startDate, endDate, maxPages });
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[tia-sync]", error);
    return NextResponse.json(
      { success: false, message: error.message || "TIA 동기화 실패" },
      { status: 500 },
    );
  }
}
