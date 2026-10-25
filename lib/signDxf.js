import proj4 from "proj4";
import {
  Colors, DxfWriter, HatchBoundaryPaths, HatchPolylineBoundary, HatchPredefinedPatterns, LWPolylineFlags,
  TextHorizontalAlignment, TextVerticalAlignment, Units, pattern, point3d,
} from "@tarikjabiri/dxf";

// Plane coordinates matching Korean digital maps (수치지도) so the sign layer
// overlays them in CAD. 5174 uses the NGII Bessel→GRS80 parameters (epsg.io).
export const SIGN_DXF_CRS = {
  5186: { label: "EPSG:5186 (GRS80 중부원점 · 국토지리정보원 수치지형도 v2)",
    proj: "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs" },
  5174: { label: "EPSG:5174 (Bessel 중부원점 · 구 수치지도, 변환 오차 수 m 가능)",
    proj: "+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +units=m +no_defs" },
};

// Callout drawing, in metres: black dot at the sign, leader to a white box
// with a black border holding the chart numbers.
const TEXT_HEIGHT = 1.0, PAD = 0.35, DOT_RADIUS = 0.3;
// Approximate glyph widths (in text heights): Hangul is full width, digits and Latin about 0.62.
const textWidth = (text) => [...text].reduce((w, ch) => w + (/[ㄱ-힣]/.test(ch) ? 1.35 : ch === " " ? 0.4 : 0.62), 0) * TEXT_HEIGHT;
// Signs this close together are one installation (e.g. several plates on a pole).
export const SAME_SPOT_METERS = 0.5;
const BLACK = "0", WHITE_ACI = 255;
const LEADER_RADII = [4, 6, 9, 13, 18], LEADER_ANGLES = [45, 135, 315, 225, 90, 0, 270, 180];

// 일람표: signs with chart numbers. Road signs are not in the chart; unmatched
// safety signs keep their display text ("?", "일방") on a separate layer.
const KINDS = { 일람표: "표지판", 도로표지: "도로표지", 미확인: "표지판_번호미확인", 서울시코드: "표지판_서울시코드" };
export function signKind(point, mode) {
  if (point.source === "R") return "도로표지";
  if (mode === "seoul") return "서울시코드";
  return point.policeCodes?.length ? "일람표" : "미확인";
}

function signLabels(point, kind) {
  if (kind === "일람표") return point.policeCodes.map(String);
  if (kind === "도로표지") return ["도로표지"];
  if (kind === "서울시코드") return [String(point.sourceIndex || point.label || "?")];
  return [String(point.label || "?")];
}

export function projectSign(lat, lng, crs) {
  const def = SIGN_DXF_CRS[crs];
  if (!def) throw new Error("지원하지 않는 좌표계입니다.");
  const [x, y] = proj4("EPSG:4326", def.proj, [Number(lng), Number(lat)]);
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

const byNumber = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b, "ko"));

// One installation per kind within SAME_SPOT_METERS; numbers are merged, deduplicated and sorted.
export function groupSigns(points, mode, crs) {
  const groups = [], cells = new Map();
  for (const point of points) {
    const kind = signKind(point, mode), at = projectSign(point.lat, point.lng, crs);
    const cx = Math.floor(at.x / SAME_SPOT_METERS), cy = Math.floor(at.y / SAME_SPOT_METERS);
    let group = null;
    for (let dx = -1; dx <= 1 && !group; dx++) for (let dy = -1; dy <= 1 && !group; dy++) {
      group = (cells.get(`${kind}:${cx + dx}:${cy + dy}`) || []).find((g) => Math.hypot(g.x - at.x, g.y - at.y) <= SAME_SPOT_METERS) || null;
    }
    if (!group) {
      group = { kind, x: at.x, y: at.y, labels: [], signs: [] };
      groups.push(group);
      const key = `${kind}:${cx}:${cy}`;
      cells.set(key, [...(cells.get(key) || []), group]);
    }
    group.signs.push({ point, ...at });
    for (const label of signLabels(point, kind)) if (!group.labels.includes(label)) group.labels.push(label);
  }
  for (const group of groups) group.labels.sort(byNumber);
  return groups;
}

const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

// Greedy placement: the first candidate around the dot that hits no placed box or dot.
function placeBoxes(groups) {
  const CELL = 20, grid = new Map();
  const cellsOf = (r) => {
    const keys = [];
    for (let x = Math.floor(r.x1 / CELL); x <= Math.floor(r.x2 / CELL); x++) for (let y = Math.floor(r.y1 / CELL); y <= Math.floor(r.y2 / CELL); y++) keys.push(`${x}:${y}`);
    return keys;
  };
  const add = (r) => cellsOf(r).forEach((k) => grid.set(k, [...(grid.get(k) || []), r]));
  const free = (r) => cellsOf(r).every((k) => !(grid.get(k) || []).some((o) => overlaps(o, r)));
  for (const g of groups) add({ x1: g.x - DOT_RADIUS, x2: g.x + DOT_RADIUS, y1: g.y - DOT_RADIUS, y2: g.y + DOT_RADIUS });
  for (const g of groups) {
    const text = g.labels.join(" ");
    const w = Math.max(textWidth(text), TEXT_HEIGHT) + PAD * 2, h = TEXT_HEIGHT + PAD * 2;
    let chosen = null, fallback = null;
    for (const radius of LEADER_RADII) {
      for (const angle of LEADER_ANGLES) {
        const rad = angle * Math.PI / 180, cx = g.x + Math.cos(rad) * radius, cy = g.y + Math.sin(rad) * radius;
        const box = { x1: cx - w / 2, x2: cx + w / 2, y1: cy - h / 2, y2: cy + h / 2 };
        fallback ||= box;
        if (free(box)) { chosen = box; break; }
      }
      if (chosen) break;
    }
    g.box = chosen || fallback;
    g.overlapping = !chosen;
    g.text = text;
    add(g.box);
  }
}

// Leader ends where the line from the dot toward the box centre meets the box edge.
function leaderEnd(g) {
  const b = g.box, cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, dx = cx - g.x, dy = cy - g.y;
  // The ray enters the box at the later of its crossings with the near x and y edges.
  const tx = dx ? ((dx > 0 ? b.x1 : b.x2) - g.x) / dx : -Infinity, ty = dy ? ((dy > 0 ? b.y1 : b.y2) - g.y) / dy : -Infinity;
  const t = Math.min(1, Math.max(0, tx, ty));
  return { x: g.x + dx * t, y: g.y + dy * t };
}

function solidBoundary(vertices) {
  const boundary = new HatchBoundaryPaths(), outline = new HatchPolylineBoundary();
  vertices.forEach((vertex) => outline.add(vertex));
  boundary.addPolylineBoundary(outline);
  return boundary;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildSignDxf({ points, scope, site, crs = "5186", mode = "police", address = "", generatedAt = new Date() }) {
  if (!SIGN_DXF_CRS[crs]) throw new Error("지원하지 않는 좌표계입니다.");
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Meters);
  // TEXT entities use the Standard style, whose default txt font has no Hangul.
  const standard = dxf.tables.styleTable.records.find((style) => style.name === "Standard");
  if (!standard) throw new Error("DXF 기본 글꼴 스타일을 찾지 못했습니다.");
  standard.fontFileName = "malgun.ttf";

  const groups = groupSigns(points, mode, crs);
  placeBoxes(groups);
  const layers = new Set();
  const layer = (kind, part) => {
    const name = `${KINDS[kind]}_${part}`;
    if (!layers.has(name)) { dxf.addLayer(name, Colors.White, "CONTINUOUS"); layers.add(name); }
    return name;
  };
  // Draw order: leaders and dots first, then white fills so boxes cover any crossing leader.
  for (const g of groups) {
    const end = leaderEnd(g);
    dxf.addLine(point3d(g.x, g.y), point3d(end.x, end.y), { layerName: layer(g.kind, "인출선"), trueColor: BLACK });
    // Filled dot: a solid hatch bounded by two half circles (bulge 1).
    dxf.addHatch(solidBoundary([{ x: g.x - DOT_RADIUS, y: g.y, bulge: 1 }, { x: g.x + DOT_RADIUS, y: g.y, bulge: 1 }]),
      pattern({ name: HatchPredefinedPatterns.SOLID }), { layerName: layer(g.kind, "점"), trueColor: BLACK });
  }
  for (const g of groups) {
    const { x1, x2, y1, y2 } = g.box, corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    dxf.addHatch(solidBoundary(corners.map(([x, y]) => ({ x, y }))), pattern({ name: HatchPredefinedPatterns.SOLID }), { layerName: layer(g.kind, "박스"), colorNumber: WHITE_ACI });
    dxf.addLWPolyline(corners.map(([x, y]) => ({ point: { x, y } })), { layerName: layer(g.kind, "박스"), trueColor: BLACK, flags: LWPolylineFlags.Closed });
    const center = point3d((x1 + x2) / 2, (y1 + y2) / 2);
    dxf.addText(center, TEXT_HEIGHT, g.text, { layerName: layer(g.kind, "번호"), trueColor: BLACK,
      horizontalAlignment: TextHorizontalAlignment.Center, verticalAlignment: TextVerticalAlignment.Middle, secondAlignmentPoint: center });
  }

  dxf.addLayer("조사범위", Colors.White, "CONTINUOUS");
  const frame = [[scope.north, scope.west], [scope.north, scope.east], [scope.south, scope.east], [scope.south, scope.west]]
    .map(([lat, lng]) => ({ point: projectSign(lat, lng, crs) }));
  dxf.addLWPolyline(frame, { layerName: "조사범위", flags: LWPolylineFlags.Closed });
  if (Number.isFinite(Number(site?.lat)) && Number.isFinite(Number(site?.lng))) {
    dxf.addLayer("사업지", Colors.Red, "CONTINUOUS");
    const { x, y } = projectSign(site.lat, site.lng, crs);
    dxf.addLWPolyline([[0, 2.5], [2.5, 0], [0, -2.5], [-2.5, 0]].map(([dx, dy]) => ({ point: { x: x + dx, y: y + dy } })), { layerName: "사업지", flags: LWPolylineFlags.Closed });
    dxf.addText(point3d(x + 3, y + 3), TEXT_HEIGHT * 2, "사업지", { layerName: "사업지" });
  }
  // Provenance above the survey frame's top-left corner.
  dxf.addLayer("도면정보", Colors.White, "CONTINUOUS");
  const origin = frame[0].point;
  [`좌표계: ${SIGN_DXF_CRS[crs].label}`,
    `자료: 서울시 안전표지·도로표지 공개자료 (${mode === "seoul" ? "서울시 원본 코드" : "경찰청 일람표 번호"}) · 반경 ${SAME_SPOT_METERS}m 안의 표지는 한 지점으로 표시`,
    `${address ? `주소: ${address} · ` : ""}생성: ${generatedAt.toISOString().slice(0, 10)} · 표지판 ${points.length}개 · 설치지점 ${groups.length}곳 · 모든 자료는 현장 확인 필요`]
    .forEach((line, i) => dxf.addText(point3d(origin.x, origin.y + 4 + (2 - i) * 3), 2, line, { layerName: "도면정보" }));

  const header = ["번호", "설치지점", "레이어", "박스표시", "관리번호", "구분", "서울시코드", "경찰청번호", "규격", "설치일", "위도", "경도", `X_EPSG${crs}`, `Y_EPSG${crs}`];
  const rows = [];
  groups.forEach((g, gi) => g.signs.forEach(({ point, x, y }) => rows.push([rows.length + 1, gi + 1, `${KINDS[g.kind]}_번호`, g.text,
    point.managementId || point.label, point.source === "R" ? "도로표지" : "안전표지", point.sourceIndex || "", (point.policeCodes || []).join(" "),
    point.specification || "", point.installedOn || "", point.lat, point.lng, x, y])));
  const csv = String.fromCharCode(0xfeff) + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const counts = Object.fromEntries(Object.entries(KINDS).map(([kind, name]) => [name, groups.filter((g) => g.kind === kind).length]).filter(([, n]) => n));
  return { dxf: dxf.stringify(), csv, counts, spots: groups.length, overlapping: groups.filter((g) => g.overlapping).length };
}
