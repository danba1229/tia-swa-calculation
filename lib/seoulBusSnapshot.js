import snapshot from "../data/seoul-bus-snapshot.json" with { type: "json" };
import { haversineDistanceMeters } from "./distance.js";

function inside(lat, lng, bounds) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

export function validateSnapshotScope({ center, bounds, width, height }) {
  const values = [center?.lat, center?.lng, bounds?.north, bounds?.south, bounds?.east, bounds?.west, width, height];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))
    || center.lat < 33 || center.lat > 39 || center.lng < 124 || center.lng > 132
    || width < 1 || height < 1 || width > 10000 || height > 10000
    || bounds.north <= bounds.south || bounds.east <= bounds.west
    || bounds.north - bounds.south > 0.1 || bounds.east - bounds.west > 0.13
    || !inside(center.lat, center.lng, bounds)) {
    throw new Error("버스정류장 조사 범위가 올바르지 않습니다. 가로·세로 1~10000m를 사용해 주세요.");
  }
}

export function searchSeoulBusSnapshot(scope) {
  validateSnapshotScope(scope);
  const { center, bounds } = scope;
  const stations = snapshot.stations.filter((station) => inside(station.latitude, station.longitude, bounds)).map((station) => {
    const distanceMeters = haversineDistanceMeters({ latitude: center.lat, longitude: center.lng }, station);
    return { ...station, location: `${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}`, distanceMeters,
      distanceKm: distanceMeters / 1000, source: "서울시 공식 파일", sourceDate: snapshot.baseDate,
      routeError: station.routes.length ? "" : "공식 파일에 연결된 노선 없음 · 수동 확인 필요",
      routes: station.routes.map((route) => ({ ...route, routeType: "수동 확인 필요", dataMode: "OFFICIAL_FILE", sourceDate: snapshot.baseDate })),
    };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return {
    success: true, dataMode: "OFFICIAL_FILE", source: "서울시 버스정류소 위치정보 · 버스노선별 정류소정보",
    sourceUrl: snapshot.sources[0].url, sources: snapshot.sources, sourceDate: snapshot.baseDate,
    fetchedAt: new Date().toISOString(),
    summary: { totalMasterCount: snapshot.stations.length, withinScopeCount: stations.length, returnedCount: stations.length,
      routeCount: stations.reduce((sum, station) => sum + station.routes.length, 0), truncated: false, partial: false,
      unlinkedStationCount: stations.filter((station) => !station.routes.length).length },
    busStops: stations,
  };
}
