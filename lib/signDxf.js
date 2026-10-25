import proj4 from "proj4";
import { Colors, DxfWriter, LWPolylineFlags, Units, point3d } from "@tarikjabiri/dxf";

// Plane coordinates matching Korean digital maps (수치지도) so the sign layer
// overlays them in CAD. 5174 uses the NGII Bessel→GRS80 parameters (epsg.io).
export const SIGN_DXF_CRS = {
  5186: { label: "EPSG:5186 (GRS80 중부원점 · 국토지리정보원 수치지형도 v2)",
    proj: "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs" },
  5174: { label: "EPSG:5174 (Bessel 중부원점 · 구 수치지도, 변환 오차 수 m 가능)",
    proj: "+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +units=m +no_defs" },
};

const LAYERS = {
  주의: { name: "표지판_주의", color: Colors.Yellow, shape: "triangle" },
  규제: { name: "표지판_규제", color: Colors.Red, shape: "circle" },
  지시: { name: "표지판_지시", color: Colors.Blue, shape: "square" },
  보조: { name: "표지판_보조", color: Colors.White, shape: "rectangle" },
  노면: { name: "표지판_노면표시", color: Colors.Green, shape: "diamond" },
  도로표지: { name: "도로표지", color: Colors.Cyan, shape: "square" },
  서울시코드: { name: "표지판_서울시코드", color: Colors.Blue, shape: "circle" },
  미확인: { name: "표지판_번호미확인", color: Colors.Magenta, shape: "circle" },
};
const POLICE_GROUPS = { 1: "주의", 2: "규제", 3: "지시", 4: "보조", 5: "노면" };
const SYMBOL = 0.8, TEXT_HEIGHT = 1.2;

// Police chart numbers start with their group digit (1xx 주의 … 5xx 노면표시).
export function signLayerKey(point, mode) {
  if (point.source === "R") return "도로표지";
  if (mode === "seoul") return "서울시코드";
  return POLICE_GROUPS[String(point.policeCodes?.[0] || "")[0]] || "미확인";
}

export function projectSign(lat, lng, crs) {
  const def = SIGN_DXF_CRS[crs];
  if (!def) throw new Error("지원하지 않는 좌표계입니다.");
  const [x, y] = proj4("EPSG:4326", def.proj, [Number(lng), Number(lat)]);
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

function shapeVertices(shape, x, y) {
  const s = SYMBOL;
  const corners = {
    triangle: [[0, s], [-s * 0.87, -s / 2], [s * 0.87, -s / 2]],
    square: [[-s, -s], [s, -s], [s, s], [-s, s]],
    rectangle: [[-s * 1.4, -s * 0.6], [s * 1.4, -s * 0.6], [s * 1.4, s * 0.6], [-s * 1.4, s * 0.6]],
    diamond: [[0, s], [s, 0], [0, -s], [-s, 0]],
  }[shape];
  return corners.map(([dx, dy]) => ({ point: { x: x + dx, y: y + dy } }));
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
  // Point it at a TrueType font so Korean labels and layer notes stay readable.
  const standard = dxf.tables.styleTable.records.find((style) => style.name === "Standard");
  if (!standard) throw new Error("DXF 기본 글꼴 스타일을 찾지 못했습니다.");
  standard.fontFileName = "malgun.ttf";
  const used = new Set(), rows = [], counts = {};
  const layerOf = (key) => {
    const layer = LAYERS[key];
    if (!used.has(key)) { dxf.addLayer(layer.name, layer.color, "CONTINUOUS"); used.add(key); }
    return layer;
  };

  for (const [index, point] of points.entries()) {
    const key = signLayerKey(point, mode), layer = layerOf(key);
    const { x, y } = projectSign(point.lat, point.lng, crs);
    const options = { layerName: layer.name };
    if (layer.shape === "circle") dxf.addCircle(point3d(x, y), SYMBOL, options);
    else dxf.addLWPolyline(shapeVertices(layer.shape, x, y), { ...options, flags: LWPolylineFlags.Closed });
    dxf.addPoint(x, y, 0, options);
    const label = point.source === "R" ? point.managementId || point.label : point.label || "?";
    dxf.addText(point3d(x + SYMBOL + 0.3, y - TEXT_HEIGHT / 2), TEXT_HEIGHT, label, options);
    counts[layer.name] = (counts[layer.name] || 0) + 1;
    rows.push([index + 1, layer.name, label, point.managementId || point.label, point.source === "R" ? "도로표지" : "안전표지",
      point.sourceIndex || "", (point.policeCodes || []).join(" "), point.specification || "", point.installedOn || "",
      point.lat, point.lng, x, y]);
  }

  const frame = { name: "조사범위", color: Colors.White };
  dxf.addLayer(frame.name, frame.color, "CONTINUOUS");
  const corners = [[scope.north, scope.west], [scope.north, scope.east], [scope.south, scope.east], [scope.south, scope.west]]
    .map(([lat, lng]) => ({ point: projectSign(lat, lng, crs) }));
  dxf.addLWPolyline(corners, { layerName: frame.name, flags: LWPolylineFlags.Closed });

  if (Number.isFinite(Number(site?.lat)) && Number.isFinite(Number(site?.lng))) {
    dxf.addLayer("사업지", Colors.Red, "CONTINUOUS");
    const { x, y } = projectSign(site.lat, site.lng, crs);
    dxf.addLWPolyline(shapeVertices("diamond", x, y).map(({ point: p }) => ({ point: { x: x + (p.x - x) * 3, y: y + (p.y - y) * 3 } })),
      { layerName: "사업지", flags: LWPolylineFlags.Closed });
    dxf.addText(point3d(x + 3, y + 3), TEXT_HEIGHT * 2, "사업지", { layerName: "사업지" });
  }

  // Provenance inside the drawing, above the survey frame's top-left corner.
  dxf.addLayer("도면정보", Colors.White, "CONTINUOUS");
  const origin = corners[0].point;
  [`좌표계: ${SIGN_DXF_CRS[crs].label}`, `자료: 서울시 안전표지·도로표지 공개자료 (${mode === "seoul" ? "서울시 원본 코드" : "경찰청 일람표 번호"} 표시)`,
    `${address ? `주소: ${address} · ` : ""}생성: ${generatedAt.toISOString().slice(0, 10)} · 표지판 ${points.length}개 · 모든 자료는 현장 확인 필요`]
    .forEach((line, i) => dxf.addText(point3d(origin.x, origin.y + 4 + (2 - i) * 3), 2, line, { layerName: "도면정보" }));

  const header = ["번호", "레이어", "표시번호", "관리번호", "구분", "서울시코드", "경찰청번호", "규격", "설치일", "위도", "경도", `X_EPSG${crs}`, `Y_EPSG${crs}`];
  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return { dxf: dxf.stringify(), csv, counts };
}
