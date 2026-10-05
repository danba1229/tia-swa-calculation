import { NextResponse } from "next/server";
import { listTrafficMonths, storedTrafficMonth } from "../../../lib/trafficVolumeStore.js";
import { buildWeekAnalysis, isoDate, weekDates } from "../../../lib/trafficPeak.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const station = params.get("station");
  const sourceMonth = params.get("source");
  const week = params.get("week");
  const direction = params.get("direction") || "both";
  try {
    if (sourceMonth) {
      if (!/^20\d{2}-\d{2}$/.test(sourceMonth)) throw new Error("월 형식 오류");
      isoDate(`${sourceMonth}-01`);
    } else if (station || week) {
      if (!station || !/^[A-F]-\d{2}$/.test(station) || !week) throw new Error("지점·주 선택이 필요합니다.");
      isoDate(week);
      if (!["both", "in", "out"].includes(direction)) throw new Error("방향 오류");
    }
  } catch {
    return NextResponse.json({ error: "지점번호, 날짜 또는 방향 선택을 확인해 주세요." }, { status: 400 });
  }
  try {
    if (sourceMonth) {
      const source = await storedTrafficMonth(sourceMonth, { source: true });
      if (!source) return NextResponse.json({ error: "저장된 원자료가 없습니다." }, { status: 404 });
      return new Response(source.bytes, { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="TOPIS-${sourceMonth}.xlsx"; filename*=UTF-8''${encodeURIComponent(source.fileName)}`,
        "Cache-Control": "private, max-age=3600",
      } });
    }
    const catalog = await listTrafficMonths();
    if (!station) return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
    const months = [...new Set(weekDates(week).map((d) => d.slice(0, 7)))];
    const records = [], sources = [];
    for (const month of months) {
      const saved = await storedTrafficMonth(month);
      if (!saved) continue;
      records.push(...saved.data.records.filter((r) => r.station === station));
      sources.push({ month, ...saved.metadata, collectedAt: saved.collectedAt, checkedAt: saved.checkedAt });
    }
    const analysis = buildWeekAnalysis({ records, station, week, direction });
    return NextResponse.json({ ...analysis, sources, sync: catalog.sync.filter((s) => months.includes(s.month) || months.some((m) => m.startsWith(`${s.month}-`))) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("traffic-volume read failed", error?.name || "Error");
    return NextResponse.json({ error: "교통량 저장소를 읽지 못했습니다. 수집 작업과 DB 연결을 확인해 주세요. 기존 원자료는 변경하지 않았습니다." }, { status: 503 });
  }
}
