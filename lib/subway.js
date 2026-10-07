import { transportKey, transportJson, arrayItems, inTransportBounds } from "./transportApi.js";
import { validateSnapshotScope } from "./seoulBusSnapshot.js";
import { haversineDistanceMeters } from "./distance.js";
import { persistentTransport } from "./transportCache.js";
import { cleanLineName, findSeoulStationCode, seoulTimetable, normalizeSeoulTimes } from "./seoulSubway.js";

const TAGO = "https://apis.data.go.kr/1613000/SubwayInfo/";
export const normalizeSubwayName = (name) => String(name || "").replace(/\([^)]*\)/g, "").replace(/\s/g, "").replace(/역$/, "");
export const normalizeSubwayLine = cleanLineName;

async function tagoPage(operation, params, pageNo = 1) {
  const data = await transportJson(`${TAGO}${operation}`, { ...params, _type: "json", numOfRows: 1000, pageNo }, "TAGO_SUBWAY_API_KEY", "serviceKey", 4000);
  if (data?.response?.header?.resultCode !== "00") throw new Error("TAGO 지하철 인증·조회 오류. 활용승인과 호출한도를 확인해 주세요.");
  const body = data.response.body;
  if (!body || !Number.isFinite(Number(body.totalCount))) throw new Error("TAGO 지하철 응답 형식 오류");
  return { items: arrayItems(body.items?.item), total: Number(body.totalCount) };
}

async function tagoAll(operation, params) {
  const items = [];
  const signatures = new Set();
  const deadline = Date.now() + 6000;
  for (let page = 1; page <= 10; page++) {
    if (Date.now() >= deadline) throw new Error("TAGO 지하철 페이지 조회 시간 초과");
    const result = await tagoPage(operation, params, page);
    const signature = JSON.stringify(result.items);
    if (signatures.has(signature)) throw new Error("TAGO 지하철 페이지 반복 · 수동 확인 필요");
    signatures.add(signature);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error("TAGO 지하철 일부 페이지 누락");
  }
  throw new Error("TAGO 지하철 자료 조회 상한 초과");
}

export function matchSubwayCodes(place, items) {
  const parts = place.place_name.trim().split(/\s+/);
  const name = normalizeSubwayName(parts[0]);
  const line = normalizeSubwayLine(parts.slice(1).join(""));
  if (!name || !line) return [];
  return items.filter((row) => normalizeSubwayName(row.subwayStationName) === name
    && normalizeSubwayLine(row.subwayRouteName) === line);
}

export async function resolveSubwayIdentity(station, { lookup = async query => persistentTransport(`subway-name-${query}`, () => tagoAll("GetKwrdFndSubwaySttnList", { subwayStationName: query }), { ttl: 86400000, valid: Array.isArray }), seoulLookup = findSeoulStationCode } = {}) {
  const parts = station.stationName.trim().split(/\s+/);
  const query = normalizeSubwayName(parts[0]);
  let matches = [], lookupFailed = false, seoulStationCode = "";
  try { matches = matchSubwayCodes({ place_name: station.stationName }, await lookup(query)); }
  catch { lookupFailed = true; }
  try { seoulStationCode = await seoulLookup(query, parts.slice(1).join("")); }
  catch { lookupFailed = true; }
  const codeStatus = matches.length === 1 || seoulStationCode ? "SUCCESS"
    : matches.length > 1 ? "AMBIGUOUS" : lookupFailed ? "LOOKUP_FAILED" : "NOT_FOUND";
  const errors = { AMBIGUOUS: "역·노선 코드가 여러 개입니다. 공식 자료 수동 확인 필요", LOOKUP_FAILED: "역 코드 조회 실패 · 누락 항목 재시도 가능", NOT_FOUND: "일치하는 공식 역·노선 코드 없음 · 수동 확인 필요" };
  return { ...station, subwayStationId: matches.length === 1 ? matches[0].subwayStationId : seoulStationCode ? `SEOUL:${seoulStationCode}` : "",
    seoulStationCode, codeStatus, line: matches.length === 1 ? matches[0].subwayRouteName : station.line,
    status: codeStatus === "SUCCESS" ? "PENDING" : "MANUAL_REQUIRED", error: errors[codeStatus] || "" };
}

export async function findSubwayStations(scope) {
  validateSnapshotScope(scope);
  const b = scope.bounds;
  return persistentTransport(`subway-scope-v2-${[scope.center.lat, scope.center.lng, b.south, b.north, b.west, b.east].map((v) => v.toFixed(6)).join(":")}`, async () => {
    const places = new Map();
    let truncated = false;
    for (let page = 1; page <= 3; page++) {
      const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
      Object.entries({ category_group_code: "SW8", rect: `${b.west},${b.south},${b.east},${b.north}`, size: 15, page }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      let result;
      try {
        const response = await fetch(url, { headers: { Authorization: `KakaoAK ${transportKey("KAKAO_REST_API_KEY")}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error();
        result = await response.json();
      } catch { throw new Error("카카오 지하철 위치 조회 실패"); }
      if (!Array.isArray(result.documents)) throw new Error("카카오 지하철 응답 형식 오류");
      for (const row of result.documents) if (inTransportBounds(Number(row.y), Number(row.x), b)) places.set(row.id, row);
      if (result.meta?.is_end) break;
      if (page === 3) truncated = true;
    }
    const stations = [];
    const codeDeadline = Date.now() + 10000;
    for (const place of places.values()) {
      const latitude = Number(place.y), longitude = Number(place.x);
      const distanceMeters = haversineDistanceMeters({ latitude: scope.center.lat, longitude: scope.center.lng }, { latitude, longitude });
      const station = { id: place.id, stationName: place.place_name, subwayStationId: "", seoulStationCode: "",
        line: place.place_name.split(/\s+/).slice(1).join(" "),
        latitude, longitude, location: place.road_address_name || place.address_name, distanceMeters,
        schedules: [], status: "MANUAL_REQUIRED", codeStatus: "NOT_QUERIED", error: "역 코드 조회 대기 · 이어서 조회합니다." };
      stations.push(Date.now() < codeDeadline ? await resolveSubwayIdentity(station) : station);
    }
    return { success: true, stations: stations.sort((a, b) => a.distanceMeters - b.distanceMeters), truncated,
      source: "역 위치: 카카오 Local / 시간표: 서울교통공사·국토교통부 TAGO", fetchedAt: new Date().toISOString() };
  }, { ttl: 86400000, valid: (v) => Array.isArray(v?.stations), complete: (v) => !v.truncated && v.stations.every((s) => s.subwayStationId) });
}

export function subwayServiceMinutes(value) {
  const raw = String(value ?? "").replace(/:/g, "");
  if (!/^\d{4}(\d{2})?$/.test(raw)) return null;
  const hour = Number(raw.slice(0, 2)), minute = Number(raw.slice(2, 4));
  if (hour > 29 || minute > 59 || (raw.length === 6 && Number(raw.slice(4)) > 59)) return null;
  return (hour < 3 ? hour + 24 : hour) * 60 + minute;
}

export function summarizeSubwayTimes(items, stationId, day, direction) {
  const byDestination = new Map();
  let invalid = 0;
  for (const item of items) {
    if (String(item.subwayStationId) !== stationId || String(item.dailyTypeCode) !== day || item.upDownTypeCode !== direction) { invalid++; continue; }
    const minutes = subwayServiceMinutes(item.depTime);
    if (minutes === null) { invalid++; continue; }
    const destination = String(item.endSubwayStationNm || "행선지 미제공");
    const key = JSON.stringify([destination, item.trainType || "미제공", item.source || "국토교통부 TAGO"]);
    if (!byDestination.has(key)) byDestination.set(key, []);
    byDestination.get(key).push(minutes);
  }
  const format = (n) => `${n >= 1440 ? "익일 " : ""}${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return { invalid, rows: [...byDestination].map(([key, times]) => ({ day: { "01": "평일", "02": "토요일", "03": "일요일·공휴일" }[day],
    direction: direction === "U" ? "상행(U)" : "하행(D)", destination: JSON.parse(key)[0], trainType: JSON.parse(key)[1], source: JSON.parse(key)[2],
    firstTime: format(Math.min(...times)), lastTime: format(Math.max(...times)), count: times.length })) };
}

export const SUBWAY_SLOTS = ["01:U", "01:D", "02:U", "02:D", "03:U", "03:D"];
export function validateSubwaySlots(slots) {
  if (!Array.isArray(slots) || !slots.length || slots.length > 2 || new Set(slots).size !== slots.length || slots.some(s => !SUBWAY_SLOTS.includes(s))) throw new Error("운행일·방향은 최대 2개씩 요청해 주세요.");
}

export async function getSubwaySchedule(station, slots = SUBWAY_SLOTS, { cache = persistentTransport, seoul = seoulTimetable, tago = tagoAll } = {}) {
  const stationId = typeof station === "string" ? station : station.subwayStationId;
  const seoulCode = typeof station === "object" ? station.seoulStationCode : "";
  if (!/^(MTR[A-Z0-9]{3,30}|SEOUL:\d{3,6})$/.test(stationId)) throw new Error("지하철 역 ID 오류");
  const slotResults = [];
  for (const key of slots) {
    if (!SUBWAY_SLOTS.includes(key)) throw new Error("지하철 운행일·방향 오류");
    const [day, direction] = key.split(":");
    try {
      const result = await cache(`subway-slot-v3:${stationId}:${seoulCode || ""}:${key}`, async () => {
          let items = [], sourceWarning = "";
          if (seoulCode) {
            try {
              const data = await seoul(seoulCode, day, direction);
              items = normalizeSeoulTimes(data.rows, stationId, day, direction);
              if (data.cacheInfo?.stale) sourceWarning = "서울 시간표 갱신 실패 · 이전 저장 자료 사용";
            } catch {
              if (!stationId.startsWith("MTR")) throw new Error("서울 시간표 연결 실패");
              sourceWarning = "서울 시간표 조회 실패 · TAGO 보조 조회";
            }
          }
          if (!items.length && stationId.startsWith("MTR")) {
            const data = await cache(`tago-day:${stationId}:${day}:${direction}`, async () => ({
              rows: await tago("GetSubwaySttnAcctoSchdulList", { subwayStationId: stationId, dailyTypeCode: day, upDownTypeCode: direction }), fetchedAt: new Date().toISOString(),
            }), { valid: (v) => Array.isArray(v?.rows), complete: (v) => v.rows.length > 0 });
            items = data.rows;
            if (data.cacheInfo?.stale) sourceWarning = "TAGO 시간표 갱신 실패 · 이전 저장 자료 사용";
          }
          const summary = summarizeSubwayTimes(items, stationId, day, direction);
          const warnings = [];
          const label = `${{ "01": "평일", "02": "토요일", "03": "일요일·공휴일" }[day]} ${direction === "U" ? "상행" : "하행"}`;
          if (summary.invalid) warnings.push(`${label}: 불일치·시간 미제공 ${summary.invalid}건 제외`);
          if (!summary.rows.length) warnings.push(`${label}: 시간표 미제공`);
          if (sourceWarning) warnings.push(sourceWarning);
          return { key, schedules: summary.rows, status: !summary.rows.length ? "NO_DATA" : warnings.length ? "PARTIAL" : "SUCCESS",
            error: warnings.join(" / "), fetchedAt: new Date().toISOString() };
      }, { valid: v => Array.isArray(v?.schedules), complete: v => v.status === "SUCCESS" });
      slotResults.push(result);
    } catch {
      slotResults.push({ key, schedules: [], status: "FAILED", error: `${key} 시간표 연결·응답 실패 · 누락 항목 재시도 가능` });
    }
  }
  return { slots: slotResults, schedules: slotResults.flatMap(s => s.schedules), status: slotResults.every(s => s.status === "SUCCESS") ? "SUCCESS" : "PARTIAL",
    error: [...new Set(slotResults.map(s => s.error).filter(Boolean))].join(" / "), fetchedAt: new Date().toISOString() };
}
