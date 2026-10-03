export function isInsideScope(site, point, width, height, radiusMeters) {
  if (!Number.isFinite(point.distanceMeters)) return false;
  if (!(width > 0 && height > 0)) return point.distanceMeters <= radiusMeters;
  const latitudeOffset = height / 2 / 111320;
  const longitudeOffset = width / 2 / (111320 * Math.cos(site.latitude * Math.PI / 180));
  return Math.abs(point.latitude - site.latitude) <= latitudeOffset
    && Math.abs(point.longitude - site.longitude) <= longitudeOffset;
}

export function summarizeProjects(totalRawCount, results) {
  const within = results.filter((result) => result.withinScope);
  return {
    totalRawCount,
    geocodedCount: results.filter((result) => result.geocodeStatus === "success").length,
    withinRadiusCount: within.length,
    reflectCount: within.filter((result) => result.reflectionStatus === "반영").length,
    reviewCount: within.filter((result) => result.reflectionStatus === "반영검토").length,
    referenceCount: within.filter((result) => result.reflectionStatus === "참고").length,
    excludedCount: results.filter((result) => result.reflectionStatus === "제외후보").length,
  };
}
