// Same north-up rectangular survey convention as the existing workspace map.
// Dimensions are full width/height in metres, not radii.
export function signScope(input) {
  const keys = ['lat', 'lng', 'width', 'height'];
  if (keys.some(key => input[key] == null || String(input[key]).trim() === '' || !Number.isFinite(Number(input[key])))) {
    throw new Error('주소 좌표와 가로·세로 범위를 확인해 주세요.');
  }
  const [lat, lng, width, height] = keys.map(key => Number(input[key]));
  if (lat < 37.4 || lat > 37.72 || lng < 126.75 || lng > 127.2) throw new Error('현재 서울시 공개 표지판 자료만 지원합니다. 서울 주소를 입력해 주세요.');
  if (width < 1 || height < 1 || width > 10000 || height > 10000) throw new Error('가로·세로 범위는 각각 1~10,000m로 입력해 주세요.');
  const dy = height / 2 / 111320, dx = width / 2 / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat, lng, width, height, north: lat + dy, south: lat - dy, east: lng + dx, west: lng - dx };
}

export function selectSigns(rows, scope, limit = 20000) {
  const found = rows.filter(row => row[1] >= scope.south && row[1] <= scope.north && row[2] >= scope.west && row[2] <= scope.east);
  if (found.length > limit) throw new Error(`범위 내 표지판이 ${limit.toLocaleString('ko-KR')}개를 초과합니다. 범위를 줄여 주세요.`);
  // Stable north-to-south numbering, independent of map zoom and selected source.
  found.sort((a, b) => b[1] - a[1] || a[2] - b[2] || a[0].localeCompare(b[0], 'en'));
  return found.map((row, index) => ({ number: index + 1, label: row[0].slice(2), id: row[0], source: row[0][0], lat: row[1], lng: row[2], sourceIndex: row[3], installedOn: row[4], specification: row[5] }));
}

// Screen-space callouts: point coordinates never move. Reserve label rectangles
// and nearby point positions; hide an unplaceable label (never its point).
export function layoutSignLabels(points, width, height, selectedId) {
  const visible = points.filter(p => p.x >= 8 && p.x <= width - 8 && p.y >= 8 && p.y <= height - 36);
  const buckets = new Map(), cell = 48;
  function cells(r) {
    const result = [];
    for (let x = Math.floor(r.x / cell); x <= Math.floor((r.x + r.w) / cell); x++)
      for (let y = Math.floor(r.y / cell); y <= Math.floor((r.y + r.h) / cell); y++) result.push(`${x}:${y}`);
    return result;
  }
  function reserve(r) { for (const key of cells(r)) { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(r); } }
  function overlaps(r) { return cells(r).some(key => (buckets.get(key) || []).some(b => r.x < b.x + b.w + 3 && r.x + r.w + 3 > b.x && r.y < b.y + b.h + 3 && r.y + r.h + 3 > b.y)); }
  visible.forEach(p => reserve({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 }));
  const labels = [];
  for (const p of [...visible].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) || a.number - b.number)) {
    const w = Math.max(26, [...String(p.label)].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7.2), 14)), h = 24;
    let placed;
    for (const distance of [28, 46, 68, 94, 122]) {
      for (const [dx, dy] of [[1,-1],[-1,-1],[1,1],[-1,1],[0,-1],[0,1],[1,0],[-1,0]]) {
        const r = { x: Math.round(p.x + dx * (distance + (dx ? w / 2 : 0)) - w / 2), y: Math.round(p.y + dy * distance - h / 2), w, h };
        if (r.x < 8 || r.y < 8 || r.x + w > width - 42 || r.y + h > height - 36 || overlaps(r)) continue;
        placed = { ...p, box: r }; reserve(r); break;
      }
      if (placed) break;
    }
    if (placed) labels.push(placed);
  }
  return { points: visible, labels };
}
