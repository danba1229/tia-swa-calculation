import { MANUAL_CHECK, transportCell } from "./transportTableDisplay.js";

export const SUBWAY_COLUMNS = ["역명", "노선", "위치", "거리(m)", "운행일", "방향", "행선지", "열차구분", "역 첫차", "역 막차", "시간표 출처"];
export function createSubwayRows(stations) {
  return [SUBWAY_COLUMNS, ...stations.flatMap((station) => {
    const distance = station.distanceMeters;
    const base = [transportCell(station.stationName), transportCell(station.line), transportCell(station.location),
      distance !== null && distance !== undefined && distance !== "" && Number.isFinite(Number(distance)) ? Math.round(Number(distance)) : MANUAL_CHECK];
    return station.schedules?.length ? station.schedules.map((row) => [...base, ...[row.day, row.direction, row.destination, row.trainType, row.firstTime, row.lastTime, row.source || "국토교통부 TAGO"].map(transportCell)])
      : [[...base, ...Array(7).fill(station.status === "PENDING" ? "조회 중" : MANUAL_CHECK)]];
  })];
}
