import { MANUAL_CHECK, transportCell } from "./transportTableDisplay.js";

export function busStopKey(station) {
  return String(station.stationId || station.id || `${station.arsId}:${station.latitude}:${station.longitude}`);
}

function coordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function visibleBusStops(stops, bounds) {
  if (!bounds || ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)
    || bounds.south >= bounds.north || bounds.west >= bounds.east) return [];
  const seen = new Set();
  return (Array.isArray(stops) ? stops : []).filter((station) => {
    const lat = coordinate(station?.latitude), lng = coordinate(station?.longitude);
    if (lat === null || lng === null || lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) return false;
    const id = busStopKey(station);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function busStopMapDetails(station) {
  const ars = String(station?.arsId ?? "").trim();
  const uniqueRoutes = new Map();
  for (const route of Array.isArray(station?.routes) ? station.routes : []) {
    const key = route.busRouteId || route.routeName || Symbol();
    const previous = uniqueRoutes.get(key);
    if (!previous || transportCell(previous.routeType) === MANUAL_CHECK) uniqueRoutes.set(key, route);
  }
  const routes = [...uniqueRoutes.values()];
  const distance = coordinate(station?.distanceMeters);
  const routeLabels = routes.map(route => `${transportCell(route.routeName)}(${transportCell(route.routeType)})`);
  return {
    name: station?.stationName || "이름 미제공 정류장",
    number: /^\d{1,5}$/.test(ars) && Number(ars) > 0 ? ars.padStart(5, "0") : MANUAL_CHECK,
    routes: routeLabels.length ? routeLabels.join(", ") : MANUAL_CHECK,
    routeCount: station?.routeError || !Array.isArray(station?.routes) ? MANUAL_CHECK : routes.length,
    routeLabels,
    distance: distance !== null && distance >= 0 ? `${Math.round(distance).toLocaleString("ko-KR")}m` : MANUAL_CHECK,
    note: [station?.routeError, routes.some(route => transportCell(route.routeType) === MANUAL_CHECK) ? "버스 종류: 공식 자료 미제공 또는 상세조회 미완료" : ""].filter(Boolean).join(" / "),
    sourceDate: station?.sourceDate || "",
  };
}

export function clearBusStopOverlays(runtimeRef) {
  runtimeRef.current.busStopLayer?.destroy();
  runtimeRef.current.busStopLayer = null;
}

export function createBusStopLayer({ map, maps, stops, bounds, onSelect, showRouteLabels = false, ownerDocument = document }) {
  const entries = [];
  for (const station of visibleBusStops(stops, bounds)) {
    const details = busStopMapDetails(station);
    const content = ownerDocument.createElement("div");
    content.className = "bus-stop-marker";
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "bus-stop-button";
    button.title = details.name;
    button.setAttribute("aria-label", `${details.name} 버스정류장 정보 보기`);
    button.setAttribute("aria-controls", "selected-bus-stop-info");
    const icon = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M6 3h12a2 2 0 0 1 2 2v13h-2v3h-3v-3H9v3H6v-3H4V5a2 2 0 0 1 2-2zm0 3v6h12V6H6zm1 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z");
    icon.appendChild(path);
    button.appendChild(icon);
    const tooltip = ownerDocument.createElement("span");
    tooltip.className = "bus-stop-tooltip";
    tooltip.textContent = details.name;
    tooltip.setAttribute("aria-hidden", "true");
    content.appendChild(button);
    content.appendChild(tooltip);
    if (showRouteLabels) {
      const label = ownerDocument.createElement("div");
      label.className = "bus-route-map-label";
      const title = ownerDocument.createElement("strong");
      title.textContent = details.name;
      const routes = ownerDocument.createElement("span");
      routes.textContent = details.routeLabels.length ? details.routeLabels.join(" · ") : "노선 정보 미제공";
      label.appendChild(title);
      label.appendChild(routes);
      content.appendChild(label);
    }
    const overlay = new maps.CustomOverlay({
      map, position: new maps.LatLng(Number(station.latitude), Number(station.longitude)),
      content, clickable: true, xAnchor: 0.5, yAnchor: 0.5, zIndex: 3,
    });
    const select = (event) => { event.stopPropagation(); onSelect(station); };
    const raise = () => overlay.setZIndex(6);
    const lower = () => overlay.setZIndex(3);
    const listeners = [["click", select], ["mouseenter", raise], ["mouseleave", lower], ["focus", raise], ["blur", lower]];
    for (const [type, handler] of listeners) button.addEventListener(type, handler);
    entries.push({ overlay, button, listeners });
  }
  return {
    count: entries.length,
    destroy() {
      for (const { overlay, button, listeners } of entries) {
        for (const [type, handler] of listeners) button.removeEventListener(type, handler);
        overlay.setMap(null);
      }
      entries.length = 0;
    },
  };
}
