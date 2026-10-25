import { MANUAL_CHECK, transportCell } from "./transportTableDisplay.js";

export const SUBWAY_COLUMNS = ["역명", "노선", "위치", "거리(m)", "운행일", "방향", "행선지", "열차구분", "역 첫차", "역 막차", "시간표 출처"];
export function createSubwayRows(stations) {
  return [SUBWAY_COLUMNS, ...stations.flatMap((station) => {
    const distance = station.distanceMeters;
    const base = [transportCell(station.stationName), transportCell(station.line), transportCell(station.location),
      distance !== null && distance !== undefined && distance !== "" && Number.isFinite(Number(distance)) ? Math.round(Number(distance)) : MANUAL_CHECK];
    const rows = (station.schedules || []).map((row) => [...base, ...[row.day, row.direction, row.destination, row.trainType, row.firstTime, row.lastTime, row.source || "국토교통부 TAGO"].map(transportCell)]);
    // A missing Saturday slot must remain visible even when weekday rows exist.
    for (const slot of station.scheduleSlots || []) {
      const [dayKey, directionKey] = slot.key.split(':');
      const day = { '01': '평일', '02': '토요일', '03': '일요일·공휴일' }[dayKey];
      const direction = directionKey === 'U' ? '상행(U)' : '하행(D)';
      if (day && slot.status === 'TERMINUS') {
        rows.push([...base, day, direction, '종착역 · 출발 열차 없음', '-', '-', '-', '-']);
      } else if (day && !station.schedules?.some(row => row.day === day && row.direction === direction)) {
        rows.push([...base, day, direction, ...Array(5).fill(MANUAL_CHECK)]);
      }
    }
    return rows.length ? rows : [[...base, ...Array(7).fill(station.status === "PENDING" ? "조회 중" : MANUAL_CHECK)]];
  })];
}

export function subwaySlotStatus(slot) {
  if (slot.retained || slot.cacheInfo?.stale || /이전.*자료/.test(slot.error || '')) return '이전 자료';
  return { SUCCESS: '확인', TERMINUS: '종착역(출발 없음)', PARTIAL: '일부 확인 필요', NO_DATA: '자료 미제공', FAILED: '조회 실패' }[slot.status] || '조회 중';
}
