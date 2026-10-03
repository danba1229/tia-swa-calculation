import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(pathToFileURL(resolve(process.env.TIA_NEXT_MODULE_ROOT || ".", "package.json")));
const XLSX = require("xlsx");
const definitions = [
  { kind: "stations", infId: "OA-15067", infSeq: "1", seq: "58", filename: "서울시버스정류소위치정보(20260902).xlsx" },
  { kind: "routes", infId: "OA-1095", infSeq: "2", seq: "58", filename: "서울시버스노선별정류소정보(20260902).xlsx" },
];
const sources = [];
const sheets = {};
for (const definition of definitions) {
  const response = await fetch("https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ infId: definition.infId, infSeq: definition.infSeq, seq: definition.seq }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Official file download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });
  const columns = ["NODE_ID", "ARS_ID", "정류소명", "X좌표", "Y좌표", ...(definition.kind === "routes" ? ["ROUTE_ID", "노선명"] : ["정류소타입"])];
  if (rows.length < 1000 || columns.some((column) => !(column in rows[0]))) throw new Error("Unexpected official file schema or row count");
  sheets[definition.kind] = rows;
  sources.push({ ...definition, url: `https://data.seoul.go.kr/dataList/${definition.infId}/S/1/datasetView.do`, rowCount: rows.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const stationMap = new Map();
const excludedTypes = {};
for (const row of sheets.stations) {
  const type = String(row["정류소타입"] || "");
  if (/선착장/.test(type)) { excludedTypes[type] = (excludedTypes[type] || 0) + 1; continue; }
  const id = String(row.NODE_ID || "");
  const latitude = Number(row["Y좌표"]);
  const longitude = Number(row["X좌표"]);
  if (!id || !row["정류소명"] || row["X좌표"] === null || row["Y좌표"] === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) throw new Error(`Invalid station: ${id}`);
  if (stationMap.has(id)) throw new Error(`Duplicate station ID: ${id}`);
  stationMap.set(id, { id, stationId: id, arsId: String(row.ARS_ID ?? "").padStart(5, "0"), stationName: String(row["정류소명"]), latitude, longitude, stationType: type, routes: [] });
}
let unmatchedRouteRows = 0;
let duplicateRouteRows = 0;
for (const row of sheets.routes) {
  const station = stationMap.get(String(row.NODE_ID || ""));
  if (!station) { unmatchedRouteRows += 1; continue; }
  const busRouteId = String(row.ROUTE_ID || "");
  const routeName = String(row["노선명"] || "");
  if (!busRouteId || !routeName) throw new Error("Invalid route identity");
  if (station.routes.some((route) => route.busRouteId === busRouteId)) { duplicateRouteRows += 1; continue; }
  station.routes.push({ id: busRouteId, busRouteId, routeName });
}
const stations = [...stationMap.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const station of stations) station.routes.sort((a, b) => a.routeName.localeCompare(b.routeName, "ko", { numeric: true }));
const snapshot = { schemaVersion: 1, baseDate: "2026-09-02", importedAt: new Date().toISOString(), sources, diagnostics: { excludedTypes, unmatchedRouteRows, duplicateRouteRows }, stations };
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/seoul-bus-snapshot.json", import.meta.url), JSON.stringify(snapshot));
console.log(JSON.stringify({ baseDate: snapshot.baseDate, stationCount: stations.length, routeLinks: stations.reduce((sum, station) => sum + station.routes.length, 0), diagnostics: snapshot.diagnostics, types: [...new Set(stations.map((station) => station.stationType))] }, null, 2));
