const SLOTS = ["01:U", "01:D", "02:U", "02:D", "03:U", "03:D"];
const DAYS = { "01": "평일", "02": "토요일", "03": "일요일·공휴일" };
export const transportScopeKey = (address, width, height) => JSON.stringify([address.trim(), Number(width), Number(height)]);
export const needsGyeonggiRouteDetail = route => Boolean(route.detailError) || !route.startStation || !route.endStation
  || !route.originFirstBusTime || !route.originLastBusTime || !route.terminalFirstBusTime || !route.terminalLastBusTime
  || !route.weekdayInterval || !route.saturdayInterval || !route.sundayInterval || !route.holidayInterval;
export const needsRetryBusDetail = (route, region) => region === "gyeonggi" ? needsGyeonggiRouteDetail(route)
  : route.detailStatus !== "SUCCESS" || Boolean(route.supplementError || route.cacheWarning);
export function busGapSummary(stations, previous = {}) {
  const routes = stations.flatMap(s => s.routes || []);
  const failedStationRoutes = stations.filter(s => !s.routes?.length).length;
  const failedRouteDetails = routes.filter(r => r.detailError || ["PENDING", "NOT_QUERIED"].includes(r.detailStatus)).length;
  const failedStationTimes = routes.filter(r => r.endpointTimeError).length;
  return { ...previous, failedStationRoutes, failedRouteDetails, failedStationTimes,
    partial: Boolean(previous.truncated || failedStationRoutes || failedRouteDetails || failedStationTimes) };
}

export async function loadGyeonggiStationRoutes({ stations, scope, request, onProgress, fetchImpl = fetch }) {
  let current = stations;
  const ids = [...new Set(stations.filter(s => !s.routes?.length).map(s => s.stationId))];
  let completed = 0;
  const emit = (loading, error = "") => { if (request.current()) onProgress({ stations: current, loading, completed, total: ids.length, error }); };
  emit(ids.length > 0);
  for (let i = 0; i < ids.length; i += 2) {
    if (!request.current()) return current;
    const batch = ids.slice(i, i + 2);
    let result;
    try {
      const response = await fetchImpl("/api/gyeonggi-bus/station-routes", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ scope, stationIds: batch }) });
      result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.updates) || !result.updates.length
        || (!result.stopped && result.updates.length !== batch.length)
        || new Set(result.updates.map(u => u?.stationId)).size !== result.updates.length
        || result.updates.some(u => !batch.includes(u?.stationId) || !Array.isArray(u.routes)
          || !["SUCCESS", "NO_DATA", "FAILED"].includes(u.routeLookupStatus)
          || (u.routeLookupStatus === "SUCCESS" && !u.routes.length)
          || u.routes.some(r => !/^\d{9}$/.test(r?.busRouteId)))) throw new Error();
    } catch {
      emit(false, "경유노선 연결 실패. 기존 결과는 유지하며 누락 항목 재시도로 이어갈 수 있습니다.");
      return current;
    }
    if (!request.current()) return current;
    current = current.map(s => {
      const update = result.updates.find(u => u.stationId === s.stationId);
      return update ? { ...s, ...update, routes: update.routes.length ? update.routes : s.routes } : s;
    });
    completed += result.updates.length;
    if (result.stopped) { emit(false, "경유노선 보완 중단. 성공 항목은 유지합니다. 잠시 후 누락 항목만 재시도하세요."); return current; }
    emit(i + 2 < ids.length);
  }
  emit(false);
  return current;
}

export function pendingSubwaySlots(station) {
  if (!station.scheduleSlots && station.status === "SUCCESS") return [];
  return SLOTS.filter(key => station.scheduleSlots?.find(s => s.key === key)?.status !== "SUCCESS"
    || station.scheduleSlots?.find(s => s.key === key)?.cacheInfo?.stale);
}
export function mergeSubwaySlots(station, updates) {
  const slots = new Map((station.scheduleSlots || []).map(s => [s.key, s]));
  let schedules = station.schedules || [];
  for (const update of updates) {
    const [day, direction] = update.key.split(":");
    const isSlot = row => row.day === DAYS[day] && row.direction === (direction === "U" ? "상행(U)" : "하행(D)");
    const previous = schedules.filter(isSlot);
    // Keep the previous complete rows on an unsuccessful refresh; mark them retained.
    const retained = previous.length > 0 && update.status !== "SUCCESS";
    slots.set(update.key, { ...update, retained, schedules: retained ? previous : update.schedules });
    if (!retained) schedules = [...schedules.filter(row => !isSlot(row)), ...update.schedules];
  }
  const values = [...slots.values()];
  return { ...station, schedules, scheduleSlots: values,
    status: SLOTS.every(key => slots.get(key)?.status === "SUCCESS") ? "SUCCESS" : "PARTIAL",
    error: [...new Set(values.filter(s => s.error || s.retained || s.cacheInfo?.stale).map(s => `${s.key}: ${s.error || "갱신 확인 필요"}${s.retained ? " (이전 결과 유지)" : ""}`))].join(" / "),
    fetchedAt: updates.at(-1)?.fetchedAt || station.fetchedAt };
}

export async function loadSubwayDetails({ stations, scope, request, onProgress, fetchImpl = fetch }) {
  let current = stations;
  const emit = loading => { if (request.current()) onProgress({ stations: current, loading }); };
  const setStation = station => { current = current.map(s => s.id === station.id ? station : s); emit(true); };
  emit(true);
  for (const original of current) {
    if (!request.current()) return;
    let station = original;
    if (!station.subwayStationId) {
      if (["AMBIGUOUS", "NOT_FOUND"].includes(station.codeStatus)) continue;
      try {
        const response = await fetchImpl("/api/subway/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
          body: JSON.stringify({ scope, placeId: station.id }) });
        const data = await response.json();
        if (!response.ok || !data.success || data.station?.id !== station.id) throw new Error();
        if (!request.current()) return;
        station = { ...station, ...data.station, schedules: station.schedules || [] };
      } catch {
        if (!request.current()) return;
        station = { ...station, codeStatus: "LOOKUP_FAILED", status: "MANUAL_REQUIRED", error: "역 코드 조회 실패 · 누락 항목 재시도 가능" };
      }
      setStation(station);
      if (station.codeStatus === "LOOKUP_FAILED") { emit(false); return; }
    }
    if (!station.subwayStationId) continue;
    const slots = pendingSubwaySlots(station);
    for (let i = 0; i < slots.length; i += 2) {
      if (!request.current()) return;
      const batch = slots.slice(i, i + 2);
      let updates;
      try {
        const response = await fetchImpl("/api/subway/details", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
          body: JSON.stringify({ scope, stationId: station.subwayStationId, placeId: station.id, slots: batch }) });
        const data = await response.json();
        if (!response.ok || !data.success || data.stationId !== station.subwayStationId || !Array.isArray(data.slots)
          || data.slots.length !== batch.length || new Set(data.slots.map(s => s.key)).size !== batch.length
          || data.slots.some(s => !batch.includes(s.key) || !Array.isArray(s.schedules)
            || !["SUCCESS", "PARTIAL", "NO_DATA", "FAILED"].includes(s.status)
            || (s.status === "SUCCESS" && !s.schedules.length)
            || s.schedules.some(row => row.day !== DAYS[s.key.split(":")[0]] || row.direction !== (s.key.endsWith(":U") ? "상행(U)" : "하행(D)") || !row.firstTime || !row.lastTime))) throw new Error();
        updates = data.slots;
      } catch { updates = batch.map(key => ({ key, schedules: [], status: "FAILED", error: "시간표 조회 실패 · 누락 항목 재시도 가능" })); }
      if (!request.current()) return;
      station = mergeSubwaySlots(station, updates);
      setStation(station);
      if (updates.every(u => u.status === "FAILED")) { emit(false); return; }
    }
  }
  emit(false);
}
