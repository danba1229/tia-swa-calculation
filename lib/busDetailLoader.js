const MANUAL_CHECK = "미제공 · 수동 확인 필요";
const detailFields = ["routeType", "originFirstBusTime", "originLastBusTime", "startStation", "endStation", "interval", "weekdayInterval", "saturdayInterval", "sundayInterval", "holidayInterval", "dayIntervalSource", "intervalSourceNote"];
const provided = (value) => typeof value === "string" && value.trim() && value !== "-" && !/미제공|수동 확인/.test(value);

export function applyBusDetailUpdates(stations, updates) {
  const byRoute = new Map(updates.map((update) => [update.busRouteId, update]));
  return stations.map((station) => ({ ...station, routes: station.routes.map((route) => {
    const update = byRoute.get(route.busRouteId);
    if (!update) return route;
    const next = { ...route, dataMode: "OFFICIAL_FILE_WITH_API", detailFetchedAt: update.fetchedAt,
      detailError: update.detailError || "", stationTimeError: update.stationTimeError || "", supplementError: update.supplementError || "", cacheWarning: update.cacheWarning || "" };
    for (const field of detailFields) if (provided(update.detail?.[field])) next[field] = update.detail[field];
    if (!next.detailError && !detailFields.some((field) => provided(update.detail?.[field]))) next.detailError = "노선 상세 항목 미제공";
    // Match NODE_ID first. Never merge two visits with different times into one.
    const matches = (update.stationTimes || []).filter((item) => item.stationId
      ? item.stationId === station.stationId
      : /^\d{5}$/.test(station.arsId || "") && Number(station.arsId) > 0 && item.arsId === station.arsId);
    const times = [...new Set(matches.map((item) => JSON.stringify([item.stationFirstBusTime, item.stationLastBusTime])))];
    next.stationFirstBusTime = MANUAL_CHECK;
    next.stationLastBusTime = MANUAL_CHECK;
    if (!next.stationTimeError && times.length === 1) {
      const [first, last] = JSON.parse(times[0]);
      if (provided(first)) next.stationFirstBusTime = first;
      if (provided(last)) next.stationLastBusTime = last;
      if (!provided(first) || !provided(last)) next.stationTimeError = "정류장 첫차·막차 일부 미제공";
    } else if (!next.stationTimeError) {
      next.stationTimeError = times.length > 1 ? "동일 정류장 복수 경유 시간 · 수동 확인 필요" : "해당 정류장 운행시간 미제공";
    }
    next.detailStatus = next.detailError || next.stationTimeError ? "PARTIAL" : "SUCCESS";
    return next;
  }) }));
}

export function markPendingBusDetails(stations, message) {
  return stations.map((station) => ({ ...station, routes: station.routes.map((route) => route.detailStatus === "PENDING"
    ? { ...route, detailStatus: "NOT_QUERIED", detailError: message, stationTimeError: "정류장 운행시간 미조회" }
    : route) }));
}

export async function loadBusDetails({ stations, scope, request, onProgress, fetchImpl = fetch, endpoint = "/api/seoul-bus/details", needsDetail = () => true }) {
  const routeIds = [...new Set(stations.flatMap((station) => station.routes.filter(needsDetail).map((route) => route.busRouteId)).filter(Boolean))];
  const requested = new Set(routeIds);
  let current = stations.map((station) => ({ ...station, routes: station.routes.map((route) => !requested.has(route.busRouteId) && route.busRouteId ? route : ({ ...route,
    detailStatus: route.busRouteId ? "PENDING" : "NOT_QUERIED",
    detailError: route.busRouteId ? "" : "노선 ID 미제공", stationTimeError: "",
  })) }));
  let completed = 0;
  const emit = (loading, error = "") => {
    if (request.current()) onProgress({ stations: current, loading, completed, total: routeIds.length, error });
  };
  emit(routeIds.length > 0);
  for (let index = 0; index < routeIds.length; index += 2) {
    if (!request.current()) return;
    let result;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ scope, routeIds: routeIds.slice(index, index + 2) }),
      });
      result = await response.json();
      const expected = routeIds.slice(index, index + 2);
      if (!response.ok || !result.success || !Array.isArray(result.updates) || !result.updates.length
        || (!result.stopped && result.updates.length !== expected.length)
        || new Set(result.updates.map((update) => update?.busRouteId)).size !== result.updates.length
        || result.updates.some((update) => !update || !expected.includes(update.busRouteId) || !Array.isArray(update.stationTimes))) throw new Error("Batch failed");
    } catch {
      if (!request.current()) return;
      const message = "버스 상세조회 연결 실패. 기본 목록과 앞서 조회한 상세정보는 유지합니다.";
      current = markPendingBusDetails(current, message);
      emit(false, message);
      return;
    }
    if (!request.current()) return;
    current = applyBusDetailUpdates(current, result.updates);
    completed += result.updates.length;
    if (result.stopped) {
      current = markPendingBusDetails(current, `추가 조회 중단: ${result.message}`);
      emit(false, result.message);
      return;
    }
    emit(index + 2 < routeIds.length);
  }
  emit(false);
}
