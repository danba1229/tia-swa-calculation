export function createSiteMapMarker(maps, map, position) {
  return new maps.CustomOverlay({
    map,
    position,
    content: '<span class="site-center-dot" role="img" aria-label="사업지 위치"></span>',
    xAnchor: 0.5,
    yAnchor: 0.5,
    // Decorative site marker must never cover interactive facility overlays.
    zIndex: 0,
  });
}
