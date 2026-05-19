export function haversineDistanceMeters(from, to) {
  const fromLat = Number(from?.latitude);
  const fromLng = Number(from?.longitude);
  const toLat = Number(to?.latitude);
  const toLng = Number(to?.longitude);

  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return null;

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const a = (
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2
  );

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
