import { haversineDistanceMeters } from "./distance.js";

const SEOUL_BUS_BASE_URL = "https://ws.bus.go.kr/api/rest";
const GRID_STEP_METERS = 850;
const SEARCH_RADIUS_METERS = 950;
const REQUEST_TIMEOUT_MS = 10000;
const MANUAL_CHECK = "미제공 · 수동 확인 필요";

function readSeoulBusApiKey() {
  const rawKey = String(
    process.env.SEOUL_BUS_API_KEY
      || process.env.SEOUL_BUS_SERVICE_KEY
      || process.env.DATA_GO_KR_SERVICE_KEY
      || process.env.TIA_DATAGOKR
      || "",
  ).replace(/^["']|["']$/g, "").trim();
  if (/%[0-9A-Fa-f]{2}/.test(rawKey)) {
    try {
      return decodeURIComponent(rawKey);
    } catch {
      return rawKey;
    }
  }
  return rawKey;
}

function toNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function readTag(xml, tagName) {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "i");
  const match = String(xml || "").match(pattern);
  return match ? decodeXml(match[1]) : "";
}

function readItems(xml) {
  const matches = Array.from(String(xml || "").matchAll(/<itemList(?:\s[^>]*)?>([\s\S]*?)<\/itemList>/gi));
  return matches.map((match) => match[1]);
}

function assertBusApiResponse(xml, label) {
  const headerCd = readTag(xml, "headerCd");
  const resultCode = readTag(xml, "resultCode");
  if (headerCd !== "0" || (resultCode && resultCode !== "00")) {
    // Provider messages can echo credentials. Only expose a short numeric code.
    const code = headerCd || resultCode;
    const safeCode = /^\d{1,3}$/.test(code) ? ` (오류코드 ${code})` : "";
    throw new Error(`${label} 응답 오류${safeCode}. 인증·조회 한도·요청값을 확인해 주세요.`);
  }
}

async function fetchBusXml(path, params, label) {
  const apiKey = readSeoulBusApiKey();
  if (!apiKey) {
    throw new Error("SEOUL_BUS_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const url = new URL(`${SEOUL_BUS_BASE_URL}${path}`);
  url.searchParams.set("serviceKey", apiKey);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let text;
  try {
    // Reject every redirect: never forward the key to HTTP or another host.
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const error = new Error("Redirect rejected");
      error.name = "BusRedirectError";
      throw error;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(`${label} HTTPS 응답 시간 초과(${REQUEST_TIMEOUT_MS / 1000}초). 보안 연결 확인이 필요하며 인증키 유효성은 확인되지 않았습니다.`);
    }
    if (error.name === "BusRedirectError" || /unexpected redirect|redirect count exceeded/i.test(String(error.cause?.message || ""))) {
      throw new Error(`${label} 리디렉션을 차단했습니다. 승인된 HTTPS 주소로 직접 연결해야 합니다.`);
    }
    if (/CERT|TLS|VERIFY_LEAF_SIGNATURE/.test(String(error.cause?.code || error.code || ""))) {
      throw new Error(`${label} HTTPS 인증서 확인 실패. 보안 연결 확인이 필요하며 인증키 유효성은 확인되지 않았습니다.`);
    }
    const status = /^HTTP \d{3}$/.test(error.message) ? ` (${error.message})` : "";
    if (status) throw new Error(`${label} HTTPS 요청 실패${status}`);
    throw new Error(`${label} HTTPS 연결 실패. 보안 연결 확인이 필요하며 인증키 유효성은 확인되지 않았습니다.`);
  }
  assertBusApiResponse(text, label);
  return text;
}

function offsetCoordinate(center, eastMeters, northMeters) {
  const lat = Number(center.lat);
  const lng = Number(center.lng);
  const latOffset = northMeters / 111320;
  const lngOffset = eastMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + latOffset,
    lng: lng + lngOffset,
  };
}

function buildSearchPoints(center, width, height) {
  const halfWidth = Math.max(0, Number(width) || 0) / 2;
  const halfHeight = Math.max(0, Number(height) || 0) / 2;
  const eastOffsets = [];
  const northOffsets = [];

  for (let x = -halfWidth; x <= halfWidth; x += GRID_STEP_METERS) eastOffsets.push(x);
  for (let y = -halfHeight; y <= halfHeight; y += GRID_STEP_METERS) northOffsets.push(y);
  if (!eastOffsets.includes(0)) eastOffsets.push(0);
  if (!northOffsets.includes(0)) northOffsets.push(0);
  if (!eastOffsets.includes(halfWidth)) eastOffsets.push(halfWidth);
  if (!eastOffsets.includes(-halfWidth)) eastOffsets.push(-halfWidth);
  if (!northOffsets.includes(halfHeight)) northOffsets.push(halfHeight);
  if (!northOffsets.includes(-halfHeight)) northOffsets.push(-halfHeight);

  const seen = new Set();
  return eastOffsets.flatMap((east) => northOffsets.map((north) => {
    const key = `${Math.round(east)}_${Math.round(north)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return offsetCoordinate(center, east, north);
  })).filter(Boolean);
}

function isInsideBounds(lat, lng, bounds) {
  return (
    lat >= bounds.south
    && lat <= bounds.north
    && lng >= bounds.west
    && lng <= bounds.east
  );
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!/^(?:\d{4}|\d{6}|\d{14}|\d{2}:\d{2}(?::\d{2})?)$/.test(text)) return MANUAL_CHECK;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 14) {
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return MANUAL_CHECK;
    const time = normalizeTime(digits.slice(8));
    return time === MANUAL_CHECK ? time : `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${time}`;
  }
  if (!/^\d{4}$|^\d{6}$/.test(digits)) return MANUAL_CHECK;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  const seconds = Number(digits.slice(4) || 0);
  if (hours > 29 || minutes > 59 || seconds > 59) return MANUAL_CHECK;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}${digits.length === 6 ? `:${digits.slice(4)}` : ""}`;
}

function routeTypeName(value) {
  const type = String(value || "").trim();
  return {
    1: "공항",
    2: "마을",
    3: "간선",
    4: "지선",
    5: "순환",
    6: "광역",
    7: "인천",
    8: "경기",
    9: "폐지",
  }[type] || type || "-";
}

function normalizeStation(itemXml, center) {
  // gpsX/gpsY are WGS84. posX/posY are projected coordinates, not a fallback.
  const latitude = toNumber(readTag(itemXml, "gpsY"));
  const longitude = toNumber(readTag(itemXml, "gpsX"));
  const distanceMeters = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? haversineDistanceMeters(
      { latitude: Number(center.lat), longitude: Number(center.lng) },
      { latitude, longitude },
    )
    : null;

  return {
    id: readTag(itemXml, "stationId") || readTag(itemXml, "arsId") || readTag(itemXml, "stationNm"),
    stationId: readTag(itemXml, "stationId"),
    arsId: readTag(itemXml, "arsId"),
    stationName: readTag(itemXml, "stationNm"),
    location: readTag(itemXml, "stationNm"),
    latitude,
    longitude,
    distanceMeters,
    distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
    source: "서울특별시 버스정류소/노선 정보",
  };
}

function normalizeRoute(itemXml) {
  return {
    id: readTag(itemXml, "busRouteId") || readTag(itemXml, "busRouteNm"),
    busRouteId: readTag(itemXml, "busRouteId"),
    routeName: readTag(itemXml, "busRouteNm") || readTag(itemXml, "busRouteAbrv"),
    routeType: routeTypeName(readTag(itemXml, "routeType")),
    stationFirstBusTime: MANUAL_CHECK,
    stationLastBusTime: MANUAL_CHECK,
    originFirstBusTime: MANUAL_CHECK,
    originLastBusTime: MANUAL_CHECK,
    startStation: MANUAL_CHECK,
    endStation: MANUAL_CHECK,
    interval: MANUAL_CHECK,
    weekdayInterval: MANUAL_CHECK,
    saturdayInterval: MANUAL_CHECK,
    holidayInterval: MANUAL_CHECK,
    detailError: "",
    stationTimeError: "",
  };
}

async function fetchStationsNearPoint(point) {
  const xml = await fetchBusXml(
    "/stationinfo/getStationByPos",
    {
      tmX: point.lng,
      tmY: point.lat,
      radius: SEARCH_RADIUS_METERS,
    },
    "서울 버스정류소 위치정보",
  );
  return readItems(xml).map((item) => normalizeStation(item, point));
}

async function fetchRoutesByStation(station) {
  if (!station.arsId) throw new Error("정류소 ARS 번호 미제공 · 경유노선 수동 확인 필요");
  const xml = await fetchBusXml(
    "/stationinfo/getRouteByStation",
    { arsId: station.arsId },
    "서울 정류소별 경유노선 정보",
  );
  const routes = readItems(xml).map(normalizeRoute);
  return routes.filter((route) => route.routeName);
}

async function fetchRouteDetail(busRouteId) {
  const xml = await fetchBusXml("/busRouteInfo/getRouteInfo", { busRouteId }, "서울 노선 상세정보");
  const item = readItems(xml).find((entry) => readTag(entry, "busRouteId") === busRouteId);
  if (!item) throw new Error("노선 상세정보 미제공 · 수동 확인 필요");
  const term = toNumber(readTag(item, "term"));
  return {
    routeType: routeTypeName(readTag(item, "routeType")),
    originFirstBusTime: normalizeTime(readTag(item, "firstBusTm")),
    originLastBusTime: normalizeTime(readTag(item, "lastBusTm")),
    startStation: readTag(item, "stStationNm") || MANUAL_CHECK,
    endStation: readTag(item, "edStationNm") || MANUAL_CHECK,
    // term is a single interval; it does not identify weekdays/weekends.
    interval: term !== null && term > 0 ? `${term}분` : MANUAL_CHECK,
  };
}

async function fetchStationTimes(arsId, busRouteId) {
  const xml = await fetchBusXml("/stationinfo/getBustimeByStation", { arsId, busRouteId }, "서울 정류소별 첫차·막차");
  const item = readItems(xml).find((entry) => (
    (!readTag(entry, "busRouteId") || readTag(entry, "busRouteId") === busRouteId)
    && (!readTag(entry, "arsId") || readTag(entry, "arsId") === arsId)
  ));
  if (!item) throw new Error("정류소별 첫차·막차 미제공 · 수동 확인 필요");
  return {
    stationFirstBusTime: normalizeTime(readTag(item, "firstBusTm")),
    stationLastBusTime: normalizeTime(readTag(item, "lastBusTm")),
  };
}

export function validateSeoulBusScope({ center, bounds, width, height, maxStations = 35 } = {}) {
  const coordinates = [center?.lat, center?.lng, bounds?.north, bounds?.south, bounds?.east, bounds?.west];
  if (!coordinates.every((value) => typeof value === "number" && Number.isFinite(value))
    || bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180
    || bounds.north <= bounds.south || bounds.east <= bounds.west
    || !isInsideBounds(center.lat, center.lng, bounds)
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width > 10000 || height > 10000 || !Number.isInteger(maxStations) || maxStations < 1 || maxStations > 35) {
    throw new Error("버스정류장 조사 범위가 올바르지 않습니다. 가로·세로 1~10000m, 정류장 1~35개를 사용해 주세요.");
  }
  if (buildSearchPoints(center, width, height).length > 100) {
    throw new Error("버스정류장 조회 지점이 너무 많습니다. 조사 범위를 줄여 주세요.");
  }
}

export async function searchSeoulBusStopsInScope({ center, bounds, width, height, maxStations = 35 } = {}) {
  validateSeoulBusScope({ center, bounds, width, height, maxStations });
  const fetchedAt = new Date().toISOString();
  const points = buildSearchPoints(center, width, height);
  const stationMap = new Map();

  for (const point of points) {
    const stations = await fetchStationsNearPoint(point);
    for (const station of stations) {
      if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)
        || Math.abs(station.latitude) > 90 || Math.abs(station.longitude) > 180) continue;
      if (!isInsideBounds(station.latitude, station.longitude, bounds)) continue;
      const key = station.stationId || station.arsId || `${station.stationName}_${station.latitude}_${station.longitude}`;
      if (!stationMap.has(key)) {
        station.distanceMeters = haversineDistanceMeters(
          { latitude: Number(center.lat), longitude: Number(center.lng) },
          { latitude: station.latitude, longitude: station.longitude },
        );
        station.distanceKm = station.distanceMeters / 1000;
        stationMap.set(key, station);
      }
    }
  }

  const stations = Array.from(stationMap.values())
    .sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER))
    .slice(0, maxStations);

  // Cache both success and failure only within this search. Repeated routes
  // across stops need one detail call, while stop-specific times stay separate.
  const routeDetails = new Map();
  let failedRouteDetails = 0;
  let failedStationTimes = 0;
  let failedStationRoutes = 0;
  for (const station of stations) {
    try {
      station.routes = await fetchRoutesByStation(station);
      for (const route of station.routes) {
        if (!route.busRouteId) {
          route.detailError = "노선 ID 미제공 · 상세정보 수동 확인 필요";
          route.stationTimeError = "노선 ID 미제공 · 정류소별 첫차·막차 수동 확인 필요";
          failedRouteDetails += 1;
          failedStationTimes += 1;
          continue;
        }
        if (!routeDetails.has(route.busRouteId)) {
          routeDetails.set(route.busRouteId, fetchRouteDetail(route.busRouteId).then(
            (detail) => ({ detail }), (error) => ({ error: error.message }),
          ));
        }
        const detailResult = await routeDetails.get(route.busRouteId);
        if (detailResult.detail) {
          const { routeType, ...detail } = detailResult.detail;
          Object.assign(route, detail);
          if (routeType !== "-") route.routeType = routeType;
        } else {
          route.detailError = detailResult.error;
          failedRouteDetails += 1;
        }
        try {
          Object.assign(route, await fetchStationTimes(station.arsId, route.busRouteId));
        } catch (error) {
          route.stationTimeError = error.message;
          failedStationTimes += 1;
        }
      }
    } catch (error) {
      station.routes = [];
      station.routeError = error.message || "노선 조회 실패";
      failedStationRoutes += 1;
    }
  }

  return {
    stations,
    fetchedAt,
    summary: {
      searchPointCount: points.length,
      withinScopeCount: stationMap.size,
      returnedCount: stations.length,
      routeCount: stations.reduce((sum, station) => sum + (station.routes?.length || 0), 0),
      truncated: stationMap.size > stations.length,
      failedRouteDetails,
      failedStationTimes,
      failedStationRoutes,
      partial: failedRouteDetails + failedStationTimes + failedStationRoutes > 0,
    },
  };
}
