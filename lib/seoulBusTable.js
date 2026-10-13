import { MANUAL_CHECK, transportCell, transportTime } from "./transportTableDisplay.js";

export const BUS_STOP_COLUMNS = ["정류장명(정류장번호)", "거리", "정차노선수"];

export function createBusStopTableRows(stations, formatDistance) {
  return [BUS_STOP_COLUMNS, ...stations.map(station => {
    const name = transportCell(station.stationName);
    const number = transportCell(station.arsId || station.stationId);
    return [name === MANUAL_CHECK && number === MANUAL_CHECK ? MANUAL_CHECK : `${name}(${number})`,
      station.distanceMeters === null || station.distanceMeters === undefined || station.distanceMeters === "" ? MANUAL_CHECK : transportCell(formatDistance(station)),
      station.routeError || !Array.isArray(station.routes) ? MANUAL_CHECK : station.routes.length];
  })];
}

export const BUS_ROUTE_COLUMNS = [
  "버스 종류", "버스번호", "노선 기점", "노선 종점", "첫차", "막차",
  "배차간격(일반)", "배차간격(토요일)", "배차간격(공휴일)",
];

export const BUS_ROUTE_NOTE = "첫차·막차는 노선 기점 기준입니다. 배차간격(일반)은 평일 기준으로 추정합니다(서울 일반값은 공식 요일 미명시, 경기 GBIS는 평일 제공값).";

const routeNumberOrder = new Intl.Collator("ko", { numeric: true });

export function createBusRouteTableRows(stations) {
  const found = new Map();
  for (const station of stations) {
    for (const route of Array.isArray(station.routes) ? station.routes : []) {
      const row = [
        transportCell(route.routeType), transportCell(route.routeName),
        transportCell(route.startStation), transportCell(route.endStation),
        transportTime(route.originFirstBusTime), transportTime(route.originLastBusTime),
        // GBIS provides an explicit weekday interval; Seoul retains its general value.
        transportCell(route.dayIntervalSource === "GBIS" ? route.weekdayInterval : route.interval),
        ...[route.saturdayInterval, route.holidayInterval].map(value =>
          ["GBIS", "SEOUL_TDATA"].includes(route.dayIntervalSource) ? transportCell(value) : MANUAL_CHECK),
      ];
      // Same route at multiple stops is one row. Equal numbers with different IDs
      // can be different routes. Legacy rows without IDs require matching endpoints.
      const id = transportCell(route.busRouteId);
      const key = id !== MANUAL_CHECK ? `id:${id}` : row[1] !== MANUAL_CHECK
        ? JSON.stringify(row.slice(0, 4)) : Symbol();
      const previous = found.get(key);
      found.set(key, previous ? previous.map((cell, i) => cell === MANUAL_CHECK ? row[i] : cell) : row);
    }
  }
  const rows = [...found.values()].sort((a, b) =>
    Number(a[1] === MANUAL_CHECK) - Number(b[1] === MANUAL_CHECK)
    || routeNumberOrder.compare(a[1], b[1]) || routeNumberOrder.compare(a.join("|"), b.join("|")));
  return [BUS_ROUTE_COLUMNS, ...rows];
}
