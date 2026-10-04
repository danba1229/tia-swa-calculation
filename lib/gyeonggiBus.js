import { cachedTransport, transportJson, intervalRange, arrayItems, MANUAL_TRANSPORT, inTransportBounds } from "./transportApi.js";
import { validateSnapshotScope } from "./seoulBusSnapshot.js";
import { haversineDistanceMeters } from "./distance.js";
import { persistentTransport } from "./transportCache.js";

const API = "https://apis.data.go.kr/6410000/";
export async function gbisRequest(service, operation, params, key) {
  const data = await transportJson(`${API}${service}/v2/${operation}`, { ...params, format: "json" }, key, "serviceKey", 5000);
  const code = Number(data?.response?.msgHeader?.resultCode);
  if (code === 4) return {};
  if (code !== 0) throw new Error("경기도 버스 API 인증·호출 오류. 활용승인 및 호출한도를 확인해 주세요.");
  return data.response.msgBody || {};
}

export function parseGbisFile(text, required) {
  const [header, ...lines] = text.replace(/^\uFEFF/, "").trim().split("^");
  const keys = header.split("|");
  if (!required.every((key) => keys.includes(key))) throw new Error("경기 버스 기반정보 파일 형식 변경");
  return lines.filter(Boolean).map((line) => {
    const values = line.split("|");
    if (values.length !== keys.length) throw new Error("경기 버스 기반정보 행 형식 오류");
    return Object.fromEntries(keys.map((key, i) => [key, values[i].trim()]));
  });
}

async function downloadBaseFile(value, kind, version) {
  const url = new URL(value);
  if (url.hostname !== "openapi.gbis.go.kr" || url.pathname !== "/ws/download"
    || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port
    || url.search !== `?${kind}${version}V2.txt`) throw new Error("경기 버스 파일 주소 검증 실패");
  // GBIS officially serves these public files over HTTP; no API key is sent.
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(18000) });
    if (!res.ok || Number(res.headers.get("content-length")) > 30000000) throw new Error();
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 30000000) throw new Error();
    const utf = new TextDecoder().decode(bytes);
    return utf.includes("\ufffd") ? new TextDecoder("euc-kr").decode(bytes) : utf;
  } catch { throw new Error("경기 버스 기반정보 파일 다운로드 실패"); }
}

export function mapGbisRoute(row) {
  const types = { 11: "직행좌석", 12: "좌석", 13: "일반시내", 14: "광역급행", 15: "맞춤형", 16: "경기순환", 21: "직행좌석농어촌", 22: "좌석농어촌", 23: "일반농어촌", 30: "마을", 41: "고속시외", 42: "좌석시외", 43: "일반시외", 51: "리무진공항", 52: "좌석공항", 53: "일반공항" };
  return {
    busRouteId: String(row.routeId), routeName: String(row.routeName), routeType: row.routeTypeName || types[row.routeTypeCd] || "수동 확인 필요",
    startStation: row.startStationName, endStation: row.endStationName,
    originFirstBusTime: row.upFirstTime, originLastBusTime: row.upLastTime,
    stationFirstBusTime: MANUAL_TRANSPORT, stationLastBusTime: MANUAL_TRANSPORT,
    weekdayInterval: intervalRange(row.peekAlloc, row.nPeekAlloc ?? row.npeekAlloc),
    saturdayInterval: intervalRange(row.satPeekAlloc, row.satNPeekAlloc ?? row.satNpeekAlloc),
    sundayInterval: intervalRange(row.sunPeekAlloc, row.sunNPeekAlloc ?? row.sunNpeekAlloc),
    holidayInterval: intervalRange(row.wePeekAlloc, row.weNPeekAlloc ?? row.weNpeekAlloc),
    dayIntervalSource: "GBIS", detailStatus: "PARTIAL", dataMode: "GBIS_BASE",
    stationTimeError: "경기도 노선 API는 기종점 시간을 제공하며 해당 정류장 시간은 수동 확인이 필요합니다.",
  };
}

export async function getGbisSnapshot() {
  return cachedTransport("gbis-snapshot-v2", async () => {
    const stored = await persistentTransport("gbis-base-v2", async () => {
    const body = await gbisRequest("baseinfoservice", "getBaseInfoItemv2", {}, "GYEONGGI_BUS_BASE_API_KEY");
    const info = body.baseInfoItem;
    if (!info) throw new Error("경기 버스 기반정보 미제공");
    const files = {};
    await Promise.all([["station", "station", ["stationId", "x", "y"]], ["route", "route", ["routeId", "routeName"]], ["routeStation", "routestation", ["stationId", "routeId"]]].map(async ([key, kind, required]) => {
      const version = String(info[`${key}Version`]);
      if (!/^\d{8}$/.test(version)) throw new Error("경기 버스 자료 버전 오류");
      files[key] = parseGbisFile(await downloadBaseFile(info[`${key}DownloadUrl`], kind, version), required);
    }));
    const routes = new Map(files.route.map((row) => [row.routeId, mapGbisRoute(row)]));
    if (files.station.length < 1000 || routes.size < 50 || files.routeStation.length < 1000) throw new Error("경기 버스 기반정보 불완전 · 이전 자료를 유지합니다.");
    const byStation = new Map();
    for (const row of files.routeStation) {
      if (!byStation.has(row.stationId)) byStation.set(row.stationId, new Set());
      byStation.get(row.stationId).add(row.routeId);
    }
    return { stations: files.station, routes: [...routes], byStation: [...byStation].map(([id, ids]) => [id, [...ids]]), version: String(info.stationVersion),
      fetchedAt: new Date().toISOString(), versions: { station: info.stationVersion, route: info.routeVersion, routeStation: info.routeStationVersion } };
    }, { valid: (v) => v?.stations?.length >= 1000 && Array.isArray(v.routes) && Array.isArray(v.byStation) && /^\d{8}$/.test(v.version) });
    return { ...stored, routes: new Map(stored.routes), byStation: new Map(stored.byStation.map(([id, ids]) => [id, new Set(ids)])) };
  }, 300000);
}

export async function searchGyeonggiBus(scope) {
  validateSnapshotScope(scope);
  const data = await getGbisSnapshot();
  const busStops = data.stations.filter((row) => !/미정차/.test(row.stationName) && inTransportBounds(Number(row.y), Number(row.x), scope.bounds)).map((row) => {
    const latitude = Number(row.y), longitude = Number(row.x);
    const routes = [...(data.byStation.get(row.stationId) || [])].map((id) => data.routes.get(id)).filter(Boolean);
    const distanceMeters = haversineDistanceMeters({ latitude: scope.center.lat, longitude: scope.center.lng }, { latitude, longitude });
    return { id: row.stationId, stationId: row.stationId, arsId: row.mobileNo, stationName: row.stationName, latitude, longitude,
      location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`, distanceMeters, distanceKm: distanceMeters / 1000,
      routes, routeError: routes.length ? "" : "연결 노선 미제공 · 수동 확인 필요" };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
  const deadline = Date.now() + 8000;
  let attempted = 0;
  for (const station of busStops.filter((item) => !item.routes.length)) {
    if (attempted >= 8 || Date.now() >= deadline) {
      station.routeError = "경유노선 보완 조회 한도 · 수동 확인 필요";
      continue;
    }
    attempted++;
    try {
      const extra = await persistentTransport(`gbis-station-${station.stationId}`, () => gbisRequest("busstationservice", "getBusStationViaRouteListv2", { stationId: station.stationId }, "GYEONGGI_BUS_STATION_API_KEY"), { ttl: 86400000 });
      const unique = new Map(arrayItems(extra.busRouteList).filter((r) => /^\d{9}$/.test(String(r.routeId))).map((r) => [String(r.routeId), data.routes.get(String(r.routeId)) || mapGbisRoute(r)]));
      station.routes = [...unique.values()];
      station.routeError = station.routes.length ? (extra.cacheInfo?.stale ? "경유노선 갱신 실패 · 이전 저장 자료 사용" : "") : "공식 API 경유노선 미제공 · 수동 확인 필요";
    } catch { station.routeError = "경유노선 보완 조회 실패 · 수동 확인 필요"; }
  }
  const missing = busStops.filter((s) => !s.routes.length).length;
  return { success: true, busStops, source: "경기버스정보 GBIS 기반정보 · 노선/정류소 API", sourceUrl: "https://www.gbis.go.kr/",
    sourceDate: data.version, sourceVersions: data.versions, fetchedAt: new Date().toISOString(), cacheInfo: data.cacheInfo,
    sourceRetrievedAt: data.fetchedAt,
    summary: { returnedCount: busStops.length, withinScopeCount: busStops.length, partial: missing > 0, failedStationRoutes: missing, truncated: false } };
}

export async function fetchGyeonggiBusDetails(routeIds) {
  const updates = [];
  for (const busRouteId of routeIds) {
    try {
      const data = await persistentTransport(`gbis-route-${busRouteId}`, () => gbisRequest("busrouteservice", "getBusRouteInfoItemv2", { routeId: busRouteId }, "GYEONGGI_BUS_ROUTE_API_KEY"), { valid: (v) => Boolean(v?.busRouteInfoItem) });
      const row = arrayItems(data.busRouteInfoItem).find((item) => String(item.routeId) === busRouteId);
      if (!row) throw new Error("일치하는 경기 노선 상세정보 미제공");
      updates.push({ busRouteId, detail: mapGbisRoute(row), stationTimes: [], stationTimeError: "정류장 첫차·막차 미제공", cacheWarning: data.cacheInfo?.stale ? "경기 버스 노선정보 갱신 실패 · 이전 저장 자료 사용" : "", fetchedAt: new Date().toISOString() });
    } catch (error) { updates.push({ busRouteId, detail: null, stationTimes: [], detailError: error.message, stationTimeError: "정류장 첫차·막차 미제공" }); }
  }
  return { success: true, updates, stopped: false };
}
