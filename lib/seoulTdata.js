import { cachedTransport, transportJson, intervalRange } from "./transportApi.js";

export function matchTdataRoute(rows, routeId) {
  const matches = rows.filter((row) => String(row.routeId) === routeId && String(row.useAt) === "1" && String(row.opratAt) === "1");
  if (matches.length !== 1) return null;
  const row = matches[0];
  return {
    saturdayInterval: intervalRange(row.caralcS), holidayInterval: intervalRange(row.caralcH),
    dayIntervalSource: "SEOUL_TDATA", intervalSourceNote: "서울 T-DATA 노선 정보 · 분기별 갱신 · 조회일은 기준일과 다름",
  };
}

export async function fetchTdataSupplement(routeId) {
  if (!process.env.SEOUL_TDATA_API_KEY) return null;
  const rows = await cachedTransport("tdata-routes", async () => {
    const all = [];
    const signatures = new Set();
    const deadline = Date.now() + 8000;
    for (let start = 1; start <= 10001; start += 1000) {
      if (Date.now() >= deadline) throw new Error("T-DATA 조회 시간 초과 · 배차 보완 보류");
      const page = await transportJson("https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/BisTbisMsRoute/1.0",
        { startRow: start, rowCnt: 1000 }, "SEOUL_TDATA_API_KEY", "apikey", 4000);
      if (!Array.isArray(page)) throw new Error("T-DATA 노선 응답 형식 오류");
      const signature = JSON.stringify(page);
      if (signatures.has(signature)) throw new Error("T-DATA 페이지 반복으로 배차 보완 보류");
      signatures.add(signature);
      all.push(...page);
      if (page.length < 1000) return all;
    }
    throw new Error("T-DATA 조회 상한으로 배차 보완 보류");
  }, 21600000);
  return matchTdataRoute(rows, routeId);
}
