import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { countValue, isoDate } from "./trafficPeak.js";

export const TOPIS_PAGE = "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily";
const ORIGIN = "https://topis.seoul.go.kr";
const MAX_BYTES = 30 * 1024 * 1024;

async function post(path, params, { fetchImpl = fetch, timeout = 60000, binary = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(`${ORIGIN}${path}`, {
        method: "POST", body: new URLSearchParams(params), redirect: "error",
        signal: AbortSignal.timeout(timeout),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Referer: TOPIS_PAGE },
      });
      if (!response.ok) throw new Error(`TOPIS HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("TOPIS 파일 크기 제한 초과");
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error("TOPIS 파일 크기 제한 초과"); }
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      return binary ? bytes : JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`TOPIS 원자료 수집 실패: ${lastError?.message || "응답 없음"}`);
}

export async function listTopisMonths(year, options) {
  if (!Number.isInteger(year) || year < 2015 || year > new Date().getUTCFullYear()) throw new Error("지원하지 않는 연도입니다.");
  const data = await post("/refroom/selectRefRoomListASC.do", { blbdDivCd: "08", bdwrDivCd: String(year), mainBdwrRowNum: "12" }, options);
  if (!Array.isArray(data.rows)) throw new Error("TOPIS 월별 목록 형식 변경: 자동수집을 중단합니다.");
  return data.rows.filter((r) => r.apndFileNm && r.apndFilePathNm && r.bdwrSeq).map((r) => {
    const month = `${year}-${String(r.months).padStart(2, "0")}`;
    isoDate(`${month}-01`);
    if (!/\.(xlsx|xls)$/i.test(r.apndFileNm)) throw new Error("지원하지 않는 TOPIS 첨부 형식");
    return { month, fileName: r.apndFileNm, filePath: r.apndFilePathNm, boardId: String(r.bdwrSeq),
      sourceUpdatedAt: r.updateDate || r.createDate || null,
      fingerprint: createHash("sha256").update(JSON.stringify([r.apndFilePathNm, r.apndFileSeq, r.updateDate])).digest("hex") };
  });
}

export async function downloadTopisMonth(item, options = {}) {
  return post("/downloadFileRefRoom.do", { apndFileNm: item.fileName, apndFilePathNm: item.filePath, bdwrSeq: item.boardId, blbdDivCd: "08" }, { ...options, binary: true });
}

export function parseTopisWorkbook(buffer, month) {
  isoDate(`${month}-01`);
  if (buffer.length > MAX_BYTES || !["504b", "d0cf"].includes(buffer.subarray(0, 2).toString("hex"))) throw new Error("교통량 엑셀 파일이 아닙니다.");
  const book = XLSX.read(buffer, { type: "buffer", cellHTML: false, cellFormula: false, sheetRows: 20000 });
  const records = [], points = new Map(), keys = new Set();
  let invalidValues = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet["!fullref"] && sheet["!fullref"] !== sheet["!ref"]) throw new Error("원자료 행 수 제한 초과: 일부만 수집하지 않습니다.");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const headerIndex = rows.slice(0, 15).findIndex((r) => r.includes("일자") && r.includes("지점번호") && r.includes("0시"));
    if (headerIndex < 0) continue;
    const header = rows[headerIndex].map((v) => String(v ?? "").trim());
    const col = (label) => header.indexOf(label);
    const hours = Array.from({ length: 24 }, (_, h) => col(`${h}시`));
    if (hours.some((h) => h < 0) || ["일자", "지점명", "방향"].some((v) => col(v) < 0)) throw new Error("TOPIS 교통량 열 구조가 변경되었습니다.");
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((v) => v === null || v === "")) continue;
      const rawDate = String(row[col("일자")] ?? "");
      const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : rawDate;
      isoDate(date);
      if (!date.startsWith(`${month}-`)) throw new Error("파일명 기준 월과 원자료 일자가 다릅니다.");
      const station = String(row[col("지점번호")] ?? "").trim();
      const direction = ({ 유입: "in", 유출: "out" })[String(row[col("방향")] ?? "").trim()];
      if (!/^[A-F]-\d{2}$/.test(station) || !direction) throw new Error("지점번호 또는 방향 매핑 실패");
      const key = `${station}|${date}|${direction}`;
      if (keys.has(key)) throw new Error(`중복 원자료: ${key}`);
      keys.add(key);
      const values = hours.map((index) => {
        const value = countValue(row[index]);
        if (value === null) invalidValues++;
        return value;
      });
      const pointName = String(row[col("지점명")] ?? "");
      const directionName = String(row[col("구분")] ?? "");
      const point = points.get(station) || { code: station, name: pointName, directions: {} };
      if (point.name !== pointName) throw new Error("한 지점번호에 복수 지점명이 있습니다.");
      point.directions[direction] = directionName;
      points.set(station, point);
      records.push({ station, date, direction, hours: values, weekday: String(row[col("요일")] ?? ""), dayType: String(row[col("요일(2)")] ?? "") });
    }
  }
  if (!records.length || !records.some((r) => r.hours.some((v) => v !== null))) throw new Error("시간대별 교통량을 추출하지 못했습니다.");
  return { version: 1, month, records, points: [...points.values()].sort((a, b) => a.code.localeCompare(b.code)),
    rowCount: records.length, missingValues: invalidValues, sourceSha256: createHash("sha256").update(buffer).digest("hex") };
}
