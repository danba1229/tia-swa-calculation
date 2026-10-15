import { NextResponse } from "next/server";
import { defaultSyncPeriod, syncTiaBusinessPeriod } from "../../../../lib/tiaBusinessSync";
import { isTiaDatabaseConfigured } from "../../../../lib/tiaDatabase";

export const maxDuration = 180;

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
      return NextResponse.json({ success: false, message: "TIA 또는 공통 조사자료 DB 연결 설정이 없습니다." }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const period = defaultSyncPeriod();
    const startDate = searchParams.get("startDate") || period.startDate;
    const endDate = searchParams.get("endDate") || period.endDate;
    const maxPages = Math.min(1000, Math.max(1, Number(searchParams.get("maxPages")) || 250));
    const summary = await syncTiaBusinessPeriod({ startDate, endDate, maxPages });
    return NextResponse.json({ success: summary.complete, summary }, { status: summary.complete ? 200 : 503 });
  } catch (error) {
    console.error("[tia-sync]", error);
    return NextResponse.json(
      { success: false, message: error.message || "TIA 동기화 실패" },
      { status: 500 },
    );
  }
}
