import { createHash } from "node:crypto";
import XLSX from "xlsx";

export const BIKE_SOURCE_URL = "https://data.seoul.go.kr/dataList/OA-13252/F/1/datasetView.do";
export class BikeRefreshError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new BikeRefreshError(code); };
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
const number = value => value == null || String(value).trim() === "" ? null : Number(value);
const text = value => String(value ?? "").trim();

export function discoverBikeFile(html, today = new Date().toISOString().slice(0, 7)) {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(m => m[0]).find(f => attr(f.split(">")[0], "name") === "frmFile");
  const inputs = new Map([...(form || "").matchAll(/<input\b[^>]*>/gi)].map(m => [attr(m[0], "name"), attr(m[0], "value")]));
  if (inputs.get("infId") !== "OA-13252" || !/^\d+$/.test(inputs.get("infSeq") || "")) fail("FILE_LIST_CHANGED");
  const files = [];
  for (const [tag] of html.matchAll(/<(?:span|a)\b[^>]*>/gi)) {
    const filename = attr(tag, "title") || "";
    const match = filename.match(/^공공자전거 대여소 정보\((\d{2}|\d{4})\.(\d{1,2})월 기준\)\.xlsx$/);
    const seq = tag.match(/downloadFile\(\s*['"](\d+)['"]\s*\)/)?.[1];
    if (!match || !seq || +match[2] < 1 || +match[2] > 12) continue;
    const baseMonth = `${match[1].length === 2 ? "20" : ""}${match[1]}-${match[2].padStart(2, "0")}`;
    if (baseMonth <= today) files.push({ filename, baseMonth, seq, infId: "OA-13252", infSeq: inputs.get("infSeq"), url: BIKE_SOURCE_URL });
  }
  files.sort((a, b) => b.baseMonth.localeCompare(a.baseMonth) || +b.seq - +a.seq);
  if (!files.length) fail("FILE_LIST_CHANGED");
  return files[0];
}

export function parseBikeRows(rows) {
  const normalize = v => text(v).replace(/\s/g, "");
  const header = rows.findIndex(row => row.some(v => normalize(v) === "대여소번호"));
  if (header < 0) fail("INVALID_SCHEMA");
  const top = rows[header].map(normalize);
  const location = rows.slice(header, header + 5).find(row => row.some(v => normalize(v) === "위도"));
  const installation = rows.slice(header, header + 5).find(row => row.some(v => normalize(v) === "QR"));
  if (!location || !installation) fail("INVALID_SCHEMA");
  const loc = location.map(normalize), type = installation.map(normalize);
  const cols = { id: top.indexOf("대여소번호"), name: top.findIndex(v => /대여소.*명/.test(v)), district: loc.indexOf("자치구"), address: loc.indexOf("상세주소"), lat: loc.indexOf("위도"), lng: loc.indexOf("경도"), lcd: type.indexOf("LCD"), qr: type.indexOf("QR") };
  if (Object.values(cols).some(i => i < 0)) fail("INVALID_SCHEMA");
  const stations = [], seen = new Set();
  for (const row of rows.slice(header + 1)) {
    const id = text(row[cols.id]);
    if (!id) {
      // Only the known multi-row header and completely blank lines may be skipped.
      if (rows.indexOf(row) <= header + 4 || row.every(v => !text(v))) continue;
      fail("MISSING_STATION_NUMBER");
    }
    const latitude = number(row[cols.lat]), longitude = number(row[cols.lng]);
    const racks = [number(row[cols.lcd]), number(row[cols.qr])];
    if (!/^\d+$/.test(id) || seen.has(id) || !text(row[cols.name])
      || !Number.isFinite(latitude) || latitude < 37.3 || latitude > 37.8
      || !Number.isFinite(longitude) || longitude < 126.7 || longitude > 127.3
      || racks.some(v => v !== null && (!Number.isInteger(v) || v < 0 || v > 1000))) {
      const error = new BikeRefreshError("INVALID_STATION");
      error.stationNumber = id;
      throw error;
    }
    seen.add(id);
    stations.push({ stationNumber: id, stationName: text(row[cols.name]), district: text(row[cols.district]), address: text(row[cols.address]), latitude, longitude,
      rackCount: racks.every(v => v === null) ? null : racks.reduce((sum, v) => sum + (v ?? 0), 0) });
  }
  return stations;
}

export function buildBikeSnapshot(stations, source, previous, now = new Date().toISOString()) {
  if (previous && source.baseMonth < previous.baseMonth) fail("OLDER_SOURCE");
  if (stations.length < 1000 || stations.length > 10000 || (previous && (stations.length < previous.stations.length * 0.8 || stations.length > previous.stations.length * 1.25))) fail("COUNT_CHANGED");
  return { schemaVersion: 1, baseMonth: source.baseMonth, importedAt: now, source, stations,
    diagnostics: { missingRackCount: stations.filter(s => s.rackCount === null).length, missingAddressCount: stations.filter(s => !s.address).length } };
}

async function download(fetchImpl, url, options, limit) {
  const response = await fetchImpl(url, { ...options, redirect: "error", cache: "no-store" });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) fail("DOWNLOAD_FAILED");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); fail("FILE_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function collectBikeSnapshot(previous, { fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const signal = AbortSignal.timeout(45000);
  const html = await download(fetchImpl, BIKE_SOURCE_URL, { signal }, 3_000_000);
  const source = discoverBikeFile(html.toString("utf8"), now.slice(0, 7));
  if (previous && source.baseMonth < previous.baseMonth) fail("OLDER_SOURCE");
  const bytes = await download(fetchImpl, "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false", {
    signal, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ infId: source.infId, infSeq: source.infSeq, seq: source.seq }),
  }, 10_000_000);
  source.sha256 = createHash("sha256").update(bytes).digest("hex");
  if (previous?.source.sha256 === source.sha256 && previous.baseMonth === source.baseMonth) return { status: "UNCHANGED", snapshot: previous };
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheetName = workbook.SheetNames.find(name => name.includes("대여소"));
  if (!sheetName) fail("INVALID_SCHEMA");
  source.sheetName = sheetName;
  const stations = parseBikeRows(XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null }));
  return { status: "UPDATED", snapshot: buildBikeSnapshot(stations, source, previous, now) };
}

export async function refreshBikeSnapshot(store, { collect = collectBikeSnapshot } = {}) {
  const token = await store.claim();
  if (!token) return { status: "BUSY" };
  try {
    const result = await collect(await store.current());
    const saved = await store.finish(token, result);
    return { status: saved ? result.status : "SUPERSEDED", baseMonth: result.snapshot.baseMonth, stationCount: result.snapshot.stations.length };
  } catch (error) {
    const errorCode = error instanceof BikeRefreshError ? error.code : "REFRESH_FAILED";
    await store.finish(token, { status: "FAILED", errorCode });
    return { status: "FAILED", errorCode };
  }
}
