import { trafficPointMetadata } from "./trafficPointLink.js";

export function validPointPosition(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && point.lat >= 33 && point.lat <= 39 && point.lng >= 124 && point.lng <= 132;
}

export function surveyMapPoints(region, topis = [], gyeonggi = [], reference = null) {
  const rows = (region === "seoul" ? topis : region === "gyeonggi" ? gyeonggi : []).slice(0, 3).map((p, index) => ({
    ...p, key: `${region}:${p.routeCode || ""}:${p.pointCode || p.code}`,
    code: p.pointCode || p.code, rank: index + 1, kind: "recommendation",
    title: region === "seoul" ? p.name : `${p.routeName} / ${p.sectionName}`,
    note: region === "seoul" ? p.address : "구간명 검색 근사 위치 · 공식 측정 좌표 아님",
    approximate: region === "gyeonggi",
  })).filter((p) => p.locationResolved !== false && validPointPosition(p));
  if (region === "gyeonggi" && reference && validPointPosition(reference)) rows.push({
    ...reference, key: `reference:${reference.code}`, kind: "reference", approximate: true,
    title: reference.name, note: `사용자 확인 참고 근사위치 · ${reference.matchedName} / ${reference.matchedAddress} · 공식 측정 좌표 아님`,
  });
  return rows;
}

export function referenceSearchQueries(point) {
  const { region } = trafficPointMetadata(point);
  const landmark = String(point?.locationName || point?.name?.split(" · ").slice(2).join(" ") || "").trim();
  if (!region || !landmark) return [];
  const clean = landmark.replace(/분기$/g, "").trim();
  return [...new Set([`${region} ${landmark}`, `${region} ${clean}`])];
}

export function referenceLocationChoices(point, places) {
  const { region } = trafficPointMetadata(point);
  // Require a municipality match, never fall back to the project address or a province centroid.
  const city = region.replace(/^경기도?\s*/, "").split(/\s+/)[0]?.replace(/[시군]$/, "");
  if (!city) return [];
  const seen = new Set();
  return places.flatMap((place) => {
    const address = String(place.address_name || place.road_address_name || "");
    const tokens = address.split(/\s+/);
    const position = { lat: Number(place.y), lng: Number(place.x) };
    const key = `${place.id || place.place_name}:${position.lat}:${position.lng}`;
    if (!/^경기(도)?$/.test(tokens[0]) || tokens[1]?.replace(/[시군]$/, "") !== city
      || !validPointPosition(position) || seen.has(key)) return [];
    seen.add(key);
    return [{ ...position, id: key, matchedName: String(place.place_name || ""), matchedAddress: address }];
  });
}

export function createSurveyPointLayer({ maps, map, points, onSelect, ownerDocument = document }) {
  const entries = [];
  for (const point of points.filter(validPointPosition)) {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = `survey-point-overlay ${point.kind === "reference" ? "survey-reference-point" : ""}`;
    button.textContent = `${point.kind === "reference" ? "참고" : `${point.rank}순위`} ${point.code}${point.approximate ? " · 근사" : ""}`;
    button.title = `${point.title} / ${point.note}`;
    button.setAttribute("aria-label", `${button.textContent} ${button.title} 정보 보기`);
    const overlay = new maps.CustomOverlay({ map, position: new maps.LatLng(point.lat, point.lng), content: button, clickable: true, yAnchor: 1.2, zIndex: 5 });
    const click = (event) => { event.stopPropagation(); onSelect(point); };
    button.addEventListener("click", click);
    entries.push({ overlay, button, click });
  }
  return { count: entries.length, destroy() {
    for (const { overlay, button, click } of entries) { button.removeEventListener("click", click); overlay.setMap(null); }
    entries.length = 0;
  } };
}
