const MANUAL_CHECK = "미제공 · 수동 확인 필요";

export const BUS_ROUTE_COLUMNS = [
  "정류장명", "버스종류", "버스번호", "정류장 첫차", "정류장 막차",
  "노선 기점 첫차", "노선 기점 막차", "노선 기점", "노선 종점",
  "배차간격(일반)", "배차시간(평일)", "배차시간(토요일)", "배차시간(공휴일)", "조회 상태",
];

export function createBusRouteTableRows(stations) {
  return [
    BUS_ROUTE_COLUMNS,
    ...stations.flatMap((station) => {
      const routes = Array.isArray(station.routes) ? station.routes : [];
      if (!routes.length) {
        return [[station.stationName || "-", ...Array(12).fill("-"), station.routeError || "노선 정보 없음"]];
      }
      return routes.map((route) => [
        station.stationName || "-", route.routeType || "-", route.routeName || "-",
        route.stationFirstBusTime || MANUAL_CHECK, route.stationLastBusTime || MANUAL_CHECK,
        route.originFirstBusTime || MANUAL_CHECK, route.originLastBusTime || MANUAL_CHECK,
        route.startStation || MANUAL_CHECK, route.endStation || MANUAL_CHECK,
        route.interval || MANUAL_CHECK,
        // These services have no day-specific intervals. Do not reuse old
        // saved weekdayInterval values that were derived from the generic term.
        MANUAL_CHECK, MANUAL_CHECK, MANUAL_CHECK,
        route.detailStatus === "PENDING" ? "공식 파일 목록 유지 · 상세 API 조회 대기"
          : route.detailStatus === "NOT_QUERIED" ? `상세 API 미조회 · ${route.detailError || "수동 확인 필요"}`
          : route.dataMode === "OFFICIAL_FILE"
          ? `공식 파일 ${route.sourceDate} 기준 · 운행 상세 수동 확인 필요`
          : `${[route.detailError, route.stationTimeError].filter(Boolean).join(" / ") || "조회 완료 · 미제공 항목은 수동 확인"}${route.detailFetchedAt ? ` · 상세 API 조회 ${route.detailFetchedAt}` : ""}`,
      ]);
    }),
  ];
}
