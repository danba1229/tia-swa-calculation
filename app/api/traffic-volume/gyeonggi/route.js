import { NextResponse } from "next/server";
import { getGgTrafficSnapshot } from "../../../../lib/gyeonggiTrafficStore.js";
import { ggCatalog, GG_TRAFFIC_SOURCE, GgTrafficError } from "../../../../lib/gyeonggiTraffic.js";
import { buildWeekAnalysis, isoDate, weekDates } from "../../../../lib/trafficPeak.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const station = params.get("station"), week = params.get("week"), source = params.get("source");
  const direction = params.get("direction") || "both";
  try {
    if (source) {
      if (!/^20\d{2}-\d{2}$/.test(source) || station || week) throw new Error();
      isoDate(`${source}-01`);
    } else if (station || week) {
      if (!/^\d{4,5}-\d{1,3}$/.test(station || "") || !week) throw new Error();
      isoDate(week);
    }
    if (!["both", "in", "out"].includes(direction)) throw new Error();
  } catch {
    return NextResponse.json({ error: "경기도 지점번호, 날짜 또는 방향 선택을 확인해 주세요." }, { status: 400 });
  }
  try {
    const { snapshot, stale, warning = "" } = await getGgTrafficSnapshot();
    const catalog = ggCatalog(snapshot);
    if (source) {
      if (!snapshot.months.some((m) => m.month === source)) return NextResponse.json({ error: "해당 월의 수록자료가 없습니다." }, { status: 404 });
      const rows = snapshot.rawRows.filter((r) => `${r.YY}-${String(r.MT).padStart(2, "0")}` === source);
      return new Response(JSON.stringify({ source: snapshot.sourceUrl, collectedAt: snapshot.collectedAt,
        snapshotSha256: snapshot.sourceSha256, stale, warning, rows }), { headers: {
        "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="GG-${source}.json"`, "Cache-Control": "no-store",
      } });
    }
    if (!station) return NextResponse.json({ ...catalog, stale, warning: [catalog.warning, warning].filter(Boolean).join(" ") }, { headers: { "Cache-Control": "no-store" } });
    const months = [...new Set(weekDates(week).map((d) => d.slice(0, 7)))];
    if (!snapshot.months.some((m) => months.includes(m.month) && m.points.some((p) => p.code === station))) {
      return NextResponse.json({ error: "선택 지점·기간의 경기도 수록자료가 없습니다." }, { status: 404 });
    }
    const records = snapshot.records.filter((r) => r.station === station);
    const analysis = buildWeekAnalysis({ records, station, week, direction });
    return NextResponse.json({ ...analysis, provider: "gyeonggi", sourceName: GG_TRAFFIC_SOURCE, stale,
      warning: [analysis.warning, catalog.warning, warning].filter(Boolean).join(" "), sync: [],
      sources: months.filter((month) => snapshot.months.some((m) => m.month === month)).map((month) => ({
        month, fileName: `경기데이터드림 ${month} API 원자료`, sourceSha256: snapshot.sourceSha256,
        collectedAt: snapshot.collectedAt, checkedAt: snapshot.checkedAt, sourceUrl: snapshot.sourceUrl,
      })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof GgTrafficError ? error.message : "경기도 교통량 저장소를 읽지 못했습니다. DB 연결을 확인해 주세요." }, { status: 503 });
  }
}
