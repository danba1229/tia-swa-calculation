export const SUBWAY_COLUMNS = ["역명", "노선", "위치", "거리(m)", "운행일", "방향", "행선지", "열차구분", "역 첫차", "역 막차", "시간표 출처"];
export function createSubwayRows(stations) {
  return [SUBWAY_COLUMNS, ...stations.flatMap((station) => {
    const base = [station.stationName, station.line || "-", station.location || "-", Math.round(station.distanceMeters)];
    return station.schedules?.length ? station.schedules.map((row) => [...base, row.day, row.direction, row.destination, row.trainType || "미제공", row.firstTime, row.lastTime, row.source || "국토교통부 TAGO"])
      : [[...base, station.status === "PENDING" ? "시간표 조회 중" : "수동 확인 필요", "-", "-", "-", "-", "-", "-"]];
  })];
}
