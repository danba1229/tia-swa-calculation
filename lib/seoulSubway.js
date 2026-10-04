import { transportKey } from "./transportApi.js";
import { persistentTransport } from "./transportCache.js";

export const cleanStationName = (name) => String(name || "").replace(/\([^)]*\)/g, "").replace(/\s/g, "").replace(/역$/, "");
export const cleanLineName = (name) => String(name || "").replace(/수도권|서울|\s/g, "").replace(/^0+(\d)/, "$1").replace(/선$/, "");
export function matchSeoulStation(name, line, rows) {
  const matches = rows.filter((r) => cleanStationName(r.STATION_NM) === cleanStationName(name) && cleanLineName(r.LINE_NUM) === cleanLineName(line));
  return matches.length === 1 && /^\d{3,6}$/.test(String(matches[0].STATION_CD)) ? String(matches[0].STATION_CD) : "";
}
export async function readSeoulSubway(service, parts, { fetchImpl = fetch, getKey = () => transportKey("SEOUL_SUBWAY_API_KEY") } = {}) {
  if (!["SearchInfoBySubwayNameService", "SearchSTNTimeTableByIDService"].includes(service)) throw new Error("서울 지하철 API 종류 오류");
  const key = getKey();
  const rows = [], signatures = new Set();
  const deadline = Date.now() + 7000;
  for (let start = 1; start <= 5001; start += 1000) {
    if (Date.now() > deadline) throw new Error("서울 지하철 시간표 페이지 조회 시간 초과");
    // HTTP to this fixed official host was explicitly approved. Never log this URL.
    const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${service}/${start}/${start + 999}/${parts.map(encodeURIComponent).join("/")}`;
    let data;
    try {
      const response = await fetchImpl(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      data = await response.json();
    } catch { throw new Error("서울 지하철 API 연결 실패"); }
    const result = data[service], code = result?.RESULT?.CODE || data.RESULT?.CODE;
    if (code === "INFO-200" && start === 1) return [];
    if (code !== "INFO-000" || !Array.isArray(result?.row) || !Number.isFinite(Number(result.list_total_count))) throw new Error("서울 지하철 API 인증 또는 응답 오류");
    const signature = JSON.stringify(result.row);
    if (signatures.has(signature) || !result.row.length) throw new Error("서울 지하철 시간표 페이지 누락·반복");
    signatures.add(signature);
    rows.push(...result.row);
    if (rows.length >= Number(result.list_total_count)) return rows;
  }
  throw new Error("서울 지하철 시간표 조회 상한 초과");
}
export async function findSeoulStationCode(name, line) {
  if (!process.env.SEOUL_SUBWAY_API_KEY) return "";
  const rows = await persistentTransport(`seoul-subway-name:${cleanStationName(name)}`, () => readSeoulSubway("SearchInfoBySubwayNameService", [cleanStationName(name)]), { valid: Array.isArray });
  return matchSeoulStation(name, line, rows);
}
export async function seoulTimetable(stationCode, day, direction) {
  const week = { "01": "1", "02": "2", "03": "3" }[day];
  const inout = { U: "1", D: "2" }[direction];
  if (!/^\d{3,6}$/.test(stationCode) || !week || !inout) throw new Error("서울 지하철 조회 조건 오류");
  return persistentTransport(`seoul-subway-day:${stationCode}:${day}:${direction}`, async () => {
    const rows = await readSeoulSubway("SearchSTNTimeTableByIDService", [stationCode, week, inout]);
    const matching = rows.filter((r) => String(r.STATION_CD) === stationCode && String(r.WEEK_TAG) === week && String(r.INOUT_TAG) === inout);
    if (matching.length !== rows.length) throw new Error("서울 지하철 역·운행일·방향 불일치");
    return { rows, fetchedAt: new Date().toISOString() };
  }, { valid: (v) => Array.isArray(v?.rows), complete: (v) => v.rows.length > 0 });
}
export function normalizeSeoulTimes(rows, stationId, day, direction) {
  return rows.filter((r) => !(String(r.LEFTTIME) === "00:00:00" && (String(r.DESTSTATION) === String(r.STATION_CD) || cleanStationName(r.SUBWAYENAME) === cleanStationName(r.STATION_NM))))
    .map((r) => ({ subwayStationId: stationId, dailyTypeCode: day, upDownTypeCode: direction,
      endSubwayStationNm: r.SUBWAYENAME, depTime: String(r.LEFTTIME || "").replaceAll(":", ""),
      trainType: r.EXPRESS_YN === "D" ? "급행" : r.EXPRESS_YN === "G" ? "일반" : "미제공", source: "서울교통공사" }));
}
