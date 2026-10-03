import { fetchRouteDetail, fetchRouteStationTimes } from "./seoulBus.js";

export const BUS_DETAIL_BATCH_SIZE = 2;

export function validateDetailRouteIds(stations, routeIds) {
  const allowed = new Set(stations.flatMap((station) => station.routes.map((route) => route.busRouteId)));
  if (!Array.isArray(routeIds) || !routeIds.length || routeIds.length > BUS_DETAIL_BATCH_SIZE
    || new Set(routeIds).size !== routeIds.length
    || routeIds.some((id) => typeof id !== "string" || !/^\d{9}$/.test(id) || !allowed.has(id))) {
    throw new Error("조사 범위의 노선 ID를 중복 없이 최대 2개씩 요청해 주세요.");
  }
}

function shouldStop(message) {
  return /HTTPS?|리디렉션|환경변수|오류코드 (?:20|22|23|29|30|31)\)/.test(message);
}

export async function fetchBusDetailBatch(routeIds) {
  const updates = [];
  for (const busRouteId of routeIds) {
    const [detail, times] = await Promise.allSettled([
      fetchRouteDetail(busRouteId), fetchRouteStationTimes(busRouteId),
    ]);
    const detailError = detail.status === "rejected" ? detail.reason.message : "";
    const stationTimeError = times.status === "rejected" ? times.reason.message : "";
    updates.push({ busRouteId,
      detail: detail.status === "fulfilled" ? detail.value : null,
      stationTimes: times.status === "fulfilled" ? times.value : [],
      detailError, stationTimeError, fetchedAt: new Date().toISOString(),
    });
    const message = [detailError, stationTimeError].filter(Boolean).join(" / ");
    if (shouldStop(message)) return { updates, stopped: true, message };
  }
  return { updates, stopped: false, message: "" };
}
