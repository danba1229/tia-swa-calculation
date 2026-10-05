import { createHash } from "node:crypto";
import { countValue, isoDate } from "./trafficPeak.js";

export const GG_TRAFFIC_URL = "https://openapi.gg.go.kr/ORDNTMTRNSPORTGENRLTM";
export const GG_TRAFFIC_PAGE = "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=5YXX2DGXASTB4S54AEEP32699329&infSeq=1";
export const GG_TRAFFIC_SOURCE = "경기데이터드림 상시교통량(일반국도 시간대별)";
const HOUR_FIELDS = Array.from({ length: 24 }, (_, h) => `TM${String(h + 1).padStart(2, "0")}_TRNSPORT_AMNT`);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class GgTrafficError extends Error {}

export function parseGgTraffic(rows, collectedAt = new Date().toISOString()) {
  if (!Array.isArray(rows) || !rows.length) throw new GgTrafficError("경기도 교통량 원자료가 비어 있습니다.");
  const keys = new Set(), months = new Map(), records = [];
  let missingValues = 0, invalidDailyRows = 0, excludedDirectionRows = 0;
  for (const row of rows) {
    const station = String(row.SPOT_NO_INFO || "").trim();
    const directionCode = String(row.UPNDW_CD || "").trim();
    if (!/^\d{4,5}-\d{1,3}$/.test(station) || !["0", "1", "2"].includes(directionCode)) {
      throw new GgTrafficError("경기도 지점번호 또는 방향 코드 형식이 변경됐습니다. 자동수집을 중단합니다.");
    }
    const date = `${row.YY}-${String(row.MT).padStart(2, "0")}-${String(row.DE).padStart(2, "0")}`;
    try { isoDate(date); } catch { throw new GgTrafficError("경기도 원자료의 측정일이 올바르지 않습니다."); }
    const direction = directionCode === "1" ? "in" : "out";
    const key = `${station}|${date}|${directionCode}`;
    if (keys.has(key)) throw new GgTrafficError("경기도 API에 중복 지점·날짜·방향이 있습니다. 불완전한 수집 결과를 저장하지 않습니다.");
    keys.add(key);
    // Code 0 is inconsistently labelled and may already contain both directions.
    // Never add it to codes 1/2, or use it to fill a missing direction.
    if (directionCode === "0") { excludedDirectionRows++; continue; }
    if (HOUR_FIELDS.some((f) => !Object.hasOwn(row, f))) throw new GgTrafficError("경기도 API의 24시간 필드가 누락됐습니다.");
    // The portal Sheet explicitly labels TM01 as 00~01, through TM24 as 23~24.
    let hours = HOUR_FIELDS.map((f) => countValue(row[f]));
    missingValues += hours.filter((v) => v === null).length;
    const publishedTotal = countValue(row.TDAY_SUM);
    const mismatch = hours.every((v) => v !== null) && publishedTotal !== null && hours.reduce((a, b) => a + b, 0) !== publishedTotal;
    if (mismatch) { invalidDailyRows++; hours = Array(24).fill(null); }
    records.push({ station, date, direction, hours, publishedTotal, sumMismatch: mismatch });
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, new Map());
    const points = months.get(month);
    if (!points.has(station)) points.set(station, { code: station,
      name: [row.ROUTE_NM, row.REGION, row.CIRCUMFR_BFRCT_NM].filter(Boolean).map(String).join(" · "),
      directions: {}, locationVerified: false });
    // Keep source labels, never reinterpret code 1/2 as Seoul inflow/outflow.
    points.get(station).directions[direction] = `${directionCode}: ${row.UPNDW_DIV || "원자료 방향"}`;
  }
  return { provider: "gyeonggi", collectedAt, checkedAt: collectedAt, sourceSha256: digest(rows),
    sourceUrl: GG_TRAFFIC_PAGE, rowCount: rows.length, missingValues, invalidDailyRows, excludedDirectionRows,
    records, rawRows: rows,
    months: [...months].sort(([a], [b]) => b.localeCompare(a)).map(([month, points]) => ({ month,
      points: [...points.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })) })) };
}

export async function collectGgTraffic({ key = process.env.GG_DATA_DREAM_API_KEY, fetchImpl = fetch, pageSize = 1000, maxRows = 200000, timeoutMs = 150000 } = {}) {
  if (!key?.trim()) throw new GgTrafficError("GG_DATA_DREAM_API_KEY 환경변수가 설정되지 않았습니다.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new GgTrafficError("페이지 크기 오류");
  const deadline = Date.now() + timeoutMs;
  async function page(index) {
    const url = new URL(GG_TRAFFIC_URL);
    url.search = new URLSearchParams({ KEY: key.trim(), Type: "json", pIndex: String(index), pSize: String(pageSize) }).toString();
    let response;
    try {
      if (Date.now() >= deadline) throw new Error("deadline");
      response = await fetchImpl(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))) });
    } catch { throw new GgTrafficError("경기데이터드림 연결 실패 또는 응답 시간 초과입니다. 기존 저장자료는 유지합니다."); }
    if (!response.ok) throw new GgTrafficError(`경기데이터드림 HTTP ${response.status} 오류입니다.`);
    let json;
    try {
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 5 * 1024 * 1024) { await reader.cancel(); throw new Error("too large"); }
        chunks.push(Buffer.from(value));
      }
      json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { throw new GgTrafficError("경기데이터드림이 JSON 대신 차단 안내 또는 잘못된 응답을 반환했습니다."); }
    const blocks = json?.ORDNTMTRNSPORTGENRLTM;
    const head = Array.isArray(blocks) ? blocks.find((b) => b.head)?.head : null;
    const result = head?.find((h) => h.RESULT)?.RESULT || json?.RESULT;
    if (result?.CODE !== "INFO-000") throw new GgTrafficError("경기데이터드림 API 조회가 거절됐습니다. 인증키와 서비스 상태를 확인해 주세요.");
    const total = Number(head?.find((h) => h.list_total_count)?.list_total_count);
    const rows = blocks.find((b) => b.row)?.row;
    if (!Number.isSafeInteger(total) || total < 1 || total > maxRows || !Array.isArray(rows)) throw new GgTrafficError("경기도 API 건수 또는 응답 형식 오류입니다.");
    return { total, rows };
  }
  const first = await page(1), rows = [...first.rows];
  const pages = Math.ceil(first.total / pageSize);
  if (first.rows.length !== Math.min(pageSize, first.total)) throw new GgTrafficError("경기도 첫 페이지가 불완전합니다. 정식 인증키를 확인해 주세요.");
  for (let index = 2; index <= pages; index++) {
    const next = await page(index);
    if (next.total !== first.total || next.rows.length !== Math.min(pageSize, first.total - (index - 1) * pageSize)) {
      throw new GgTrafficError("수집 중 경기도 자료 건수가 변경됐거나 페이지가 누락됐습니다. 다시 시도해 주세요.");
    }
    rows.push(...next.rows);
  }
  if (pages > 1) {
    const check = await page(1);
    if (check.total !== first.total || digest(check.rows) !== digest(first.rows)) throw new GgTrafficError("수집 중 경기도 자료 순서가 변경됐습니다. 기존 저장자료를 유지합니다.");
  }
  return parseGgTraffic(rows);
}

export function ggCatalog(snapshot) {
  return { provider: "gyeonggi", sourceName: GG_TRAFFIC_SOURCE, sourceUrl: GG_TRAFFIC_PAGE,
    months: snapshot.months, sync: [], rowCount: snapshot.rowCount, collectedAt: snapshot.collectedAt,
    warning: [snapshot.invalidDailyRows ? `일합계가 맞지 않는 ${snapshot.invalidDailyRows}개 행은 결측 처리했습니다.` : "",
      snapshot.excludedDirectionRows ? `중복합산 방지를 위해 원자료 방향 코드 0의 ${snapshot.excludedDirectionRows.toLocaleString("ko-KR")}개 행은 분석에서 제외했습니다. 코드 1·2만 사용합니다.` : ""].filter(Boolean).join(" ") };
}
