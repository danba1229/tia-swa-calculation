import { createHash } from "node:crypto";
import XLSX from "xlsx";

const datasets = [
  { kind: "stations", infId: "OA-15067", prefix: "서울시버스정류소위치정보" },
  { kind: "routes", infId: "OA-1095", prefix: "서울시버스노선별정류소정보" },
];
const pageUrl = (id) => `https://data.seoul.go.kr/dataList/${id}/S/1/datasetView.do`;
export class BusRefreshError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new BusRefreshError(code); };
function dateFromDigits(value) {
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso ? iso : null;
}
function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}
export function discoverBusFile(html, kind, today = new Date().toISOString().slice(0,10)) {
  const definition = datasets.find(d => d.kind === kind);
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(m=>m[0]).find(f=>attr(f.split(">")[0], "name") === "frmFile");
  const inputs = new Map([...(form || "").matchAll(/<input\b[^>]*>/gi)].map(m=>[attr(m[0], "name"), attr(m[0], "value")]));
  if (!definition || inputs.get("infId") !== definition.infId || !/^\d+$/.test(inputs.get("infSeq") || "")) fail("FILE_LIST_CHANGED");
  const candidates = [];
  for (const match of html.matchAll(/<(?:span|a)\b[^>]*>/gi)) {
    const filename = attr(match[0], "title") || "";
    const date = filename.match(new RegExp(`^${definition.prefix}\\((\\d{8})\\)\\.xlsx$`));
    const seq = match[0].match(/downloadFile\(\s*['"](\d+)['"]\s*\)/)?.[1];
    const baseDate = date && dateFromDigits(date[1]);
    if (baseDate && seq && baseDate <= today) candidates.push({ kind, infId: definition.infId, infSeq: inputs.get("infSeq"), seq, filename, baseDate, url: pageUrl(definition.infId) });
  }
  candidates.sort((a,b)=>b.baseDate.localeCompare(a.baseDate) || Number(b.seq)-Number(a.seq));
  if (!candidates.length) fail("FILE_LIST_CHANGED");
  return candidates[0];
}

async function boundedFetch(fetchImpl, url, options, maxBytes) {
  const response = await fetchImpl(url, { ...options, redirect: "error", cache: "no-store" });
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) fail("DOWNLOAD_FAILED");
  const chunks = []; let size = 0;
  if (!response.body) fail("DOWNLOAD_FAILED");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); fail("FILE_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function buildBusSnapshot(sheets, sources, previous, now = new Date().toISOString()) {
  if (sources.length !== 2 || sources[0].baseDate !== sources[1].baseDate) fail("SOURCE_DATE_MISMATCH");
  const baseDate = sources[0].baseDate;
  if (previous && baseDate < previous.baseDate) fail("OLDER_SOURCE");
  for (const kind of ["stations", "routes"]) {
    const rows = sheets[kind];
    const columns = ["NODE_ID", "ARS_ID", "정류소명", "X좌표", "Y좌표", ...(kind === "routes" ? ["ROUTE_ID", "노선명"] : ["정류소타입"])];
    if (!Array.isArray(rows) || rows.length < 1000 || columns.some(c=>!(c in rows[0]))) fail("INVALID_SCHEMA");
  }
  const stationMap = new Map(), excludedTypes = {};
  for (const row of sheets.stations) {
    const type = String(row["정류소타입"] || "");
    if (/선착장/.test(type)) { excludedTypes[type] = (excludedTypes[type] || 0) + 1; continue; }
    const id = String(row.NODE_ID || ""), latitude = Number(row["Y좌표"]), longitude = Number(row["X좌표"]);
    if (!/^\d{9}$/.test(id) || !row["정류소명"] || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132 || stationMap.has(id)) fail("INVALID_STATION");
    stationMap.set(id, { id, stationId: id, arsId: String(row.ARS_ID ?? "").padStart(5,"0"), stationName: String(row["정류소명"]), latitude, longitude, stationType: type, routes: [] });
  }
  let unmatchedRouteRows = 0, duplicateRouteRows = 0;
  const seen = new Map();
  for (const row of sheets.routes) {
    const station = stationMap.get(String(row.NODE_ID || ""));
    if (!station) { unmatchedRouteRows++; continue; }
    const busRouteId = String(row.ROUTE_ID || ""), routeName = String(row["노선명"] || "");
    if (!/^\d{9}$/.test(busRouteId) || !routeName) fail("INVALID_ROUTE");
    const key = `${station.id}:${busRouteId}`;
    if (seen.has(key)) { if (seen.get(key) !== routeName) fail("INVALID_ROUTE"); duplicateRouteRows++; continue; }
    seen.set(key, routeName);
    station.routes.push({ id: busRouteId, busRouteId, routeName });
  }
  if (unmatchedRouteRows / sheets.routes.length > 0.2) fail("ROUTE_COVERAGE_CHANGED");
  const stations = [...stationMap.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for (const station of stations) station.routes.sort((a,b)=>a.routeName.localeCompare(b.routeName,"ko",{numeric:true}));
  const links = stations.reduce((n,s)=>n+s.routes.length,0);
  const oldLinks = previous?.stations.reduce((n,s)=>n+s.routes.length,0);
  if (stations.length < 1000 || links < 1000 || (previous && (
    stations.length < previous.stations.length * 0.8 || stations.length > previous.stations.length * 1.25
    || links < oldLinks * 0.8 || links > oldLinks * 1.25))) fail("COUNT_CHANGED");
  return { schemaVersion: 1, baseDate, importedAt: now, sources, diagnostics: { excludedTypes, unmatchedRouteRows, duplicateRouteRows }, stations };
}

export async function collectBusSnapshot(previous, { fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const signal = AbortSignal.timeout(45000);
  const sources = [];
  for (const definition of datasets) {
    const html = await boundedFetch(fetchImpl, pageUrl(definition.infId), { signal }, 3_000_000);
    sources.push(discoverBusFile(html.toString("utf8"), definition.kind, now.slice(0,10)));
  }
  if (sources[0].baseDate !== sources[1].baseDate) fail("SOURCE_DATE_MISMATCH");
  if (previous && sources[0].baseDate < previous.baseDate) fail("OLDER_SOURCE");
  const sheets = {};
  for (const source of sources) {
    const bytes = await boundedFetch(fetchImpl, "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal,
      body: new URLSearchParams({ infId: source.infId, infSeq: source.infSeq, seq: source.seq }),
    }, 20_000_000);
    const workbook = XLSX.read(bytes, { type: "buffer" });
    sheets[source.kind] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });
    source.rowCount = sheets[source.kind].length;
    source.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  const snapshot = buildBusSnapshot(sheets, sources, previous, now);
  const unchanged = previous?.baseDate === snapshot.baseDate && sources.every(s=>previous.sources.some(old=>old.kind === s.kind && old.sha256 === s.sha256));
  return { status: unchanged ? "UNCHANGED" : "UPDATED", snapshot };
}

// A lease and atomic save are supplied by the durable store; failed work never replaces data.
export async function refreshBusSnapshot(store, { collect = collectBusSnapshot } = {}) {
  const token = await store.claim();
  if (!token) return { status: "BUSY" };
  try {
    const previous = await store.current();
    const result = await collect(previous);
    const saved = await store.finish(token, result);
    return { status: saved ? result.status : "SUPERSEDED", baseDate: result.snapshot.baseDate };
  } catch (error) {
    const code = error instanceof BusRefreshError ? error.code : "REFRESH_FAILED";
    await store.finish(token, { status: "FAILED", errorCode: code });
    return { status: "FAILED", errorCode: code };
  }
}
