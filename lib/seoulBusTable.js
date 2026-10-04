const MANUAL_CHECK = "미제공 · 수동 확인 필요";

export const BUS_ROUTE_COLUMNS = [
  "정류장명", "버스종류", "버스번호", "정류장 첫차", "정류장 막차",
  "노선 기점", "노선 종점",
  "배차간격(일반)", "배차시간(평일)", "배차시간(토요일)", "배차시간(일요일)", "배차시간(공휴일)",
];

export function createBusRouteTableRows(stations) {
  return [
    BUS_ROUTE_COLUMNS,
    ...stations.flatMap((station) => {
      const routes = Array.isArray(station.routes) ? station.routes : [];
      if (!routes.length) {
        return [[station.stationName || "-", ...Array(BUS_ROUTE_COLUMNS.length - 1).fill("-")]];
      }
      return routes.map((route) => [
        station.stationName || "-", route.routeType || "-", route.routeName || "-",
        route.stationFirstBusTime || MANUAL_CHECK, route.stationLastBusTime || MANUAL_CHECK,
        route.startStation || MANUAL_CHECK, route.endStation || MANUAL_CHECK,
        route.interval || MANUAL_CHECK,
        // Only trusted day-specific sources may replace unknown saved values.
        route.dayIntervalSource === "GBIS" ? route.weekdayInterval || MANUAL_CHECK : MANUAL_CHECK,
        ["GBIS", "SEOUL_TDATA"].includes(route.dayIntervalSource) ? route.saturdayInterval || MANUAL_CHECK : MANUAL_CHECK,
        route.dayIntervalSource === "GBIS" ? route.sundayInterval || MANUAL_CHECK : MANUAL_CHECK,
        ["GBIS", "SEOUL_TDATA"].includes(route.dayIntervalSource) ? route.holidayInterval || MANUAL_CHECK : MANUAL_CHECK,
      ]);
    }),
  ];
}
