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
  "정류장명", "버스종류", "버스번호", "노선 기점", "기점 첫차", "기점 막차",
  "노선 종점", "종점 첫차", "종점 막차", "운행시간 기준",
  "배차간격(일반)", "배차시간(평일)", "배차시간(토요일)", "배차시간(일요일)", "배차시간(공휴일)",
];

export function createBusRouteTableRows(stations) {
  return [
    BUS_ROUTE_COLUMNS,
    ...stations.flatMap((station) => {
      const routes = Array.isArray(station.routes) ? station.routes : [];
      if (!routes.length) {
        return [[transportCell(station.stationName), ...Array(BUS_ROUTE_COLUMNS.length - 1).fill(MANUAL_CHECK)]];
      }
      return routes.map((route) => [
        transportCell(station.stationName), transportCell(route.routeType), transportCell(route.routeName),
        transportCell(route.startStation), transportTime(route.originFirstBusTime), transportTime(route.originLastBusTime),
        transportCell(route.endStation), transportTime(route.terminalFirstBusTime), transportTime(route.terminalLastBusTime),
        // A provided basis may legitimately describe missing day distinctions.
        route.endpointTimeBasis && /기점|종점|평일/.test(route.endpointTimeBasis) ? route.endpointTimeBasis : transportCell(route.endpointTimeBasis),
        transportCell(route.interval),
        // Only trusted day-specific sources may replace unknown saved values.
        route.dayIntervalSource === "GBIS" ? transportCell(route.weekdayInterval) : MANUAL_CHECK,
        ["GBIS", "SEOUL_TDATA"].includes(route.dayIntervalSource) ? transportCell(route.saturdayInterval) : MANUAL_CHECK,
        route.dayIntervalSource === "GBIS" ? transportCell(route.sundayInterval) : MANUAL_CHECK,
        ["GBIS", "SEOUL_TDATA"].includes(route.dayIntervalSource) ? transportCell(route.holidayInterval) : MANUAL_CHECK,
      ]);
    }),
  ];
}
