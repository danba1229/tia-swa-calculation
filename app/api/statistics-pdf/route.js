import { NextResponse } from "next/server";
import { inflateRawSync, inflateSync } from "node:zlib";

export const runtime = "nodejs";

const LANDUSE_CATEGORIES = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원"];
const ZONING_NAMES = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "농림지역", "자연환경보전지역", "미세분지역", "미지정지역"];
const MAX_FILE_SIZE = 35 * 1024 * 1024;
const VALID_LANDUSE_TITLES = ["토지지목별 현황", "지목별 토지현황", "지목별 면적"];
const EXCLUDED_LANDUSE_TITLES = ["도시계획시설", "공원녹지", "공원현황"];
const EXCLUDED_ZONING_NAMES = ["도시지역", "비도시지역", "합계", "계"];

function safe(value) {
  return String(value ?? "").trim();
}

function toNumberString(value) {
  const numeric = safe(value).replace(/[^\d.-]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : "";
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function extractYear(value) {
  return safe(value).match(/(20\d{2}|19\d{2})/)?.[1] || "";
}

function extractFileYear(fileName, fallbackYear = "") {
  return extractYear(fileName) || fallbackYear;
}

function extractBaseYear(text, fallbackYear = "") {
  const patterns = [
    /(20\d{2}|19\d{2})\s*[.년-]\s*12\s*[.월-]\s*31\s*[.일]?\s*기준/,
    /기준\s*[:：]?\s*(20\d{2}|19\d{2})\s*[.년-]\s*12\s*[.월-]\s*31/,
    /(20\d{2}|19\d{2})\s*년\s*말\s*기준/,
    /(20\d{2}|19\d{2})\s*\.?\s*12\s*\.?\s*31/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return fallbackYear;
}

function extractAdminName(text, fileName = "") {
  const source = `${fileName}\n${text.slice(0, 5000)}`;
  const match = source.match(/([가-힣]+(?:시|군|구))/);
  return match?.[1] || "";
}

function detectUnit(windowText) {
  const unitMatch = windowText.match(/단위\s*[:：]?\s*(천?\s*㎡|천?\s*m²|천?\s*m2|㎢|km²|km2|ha|헥타르|㎡|m²|m2)/i);
  return safe(unitMatch?.[1]).replace(/\s+/g, "") || "㎡";
}

function convertAreaToM2(rawValue, sourceUnit) {
  const rawNumber = toNumber(rawValue);
  const unit = safe(sourceUnit) || "㎡";
  const normalizedUnit = unit.replace(/\s+/g, "");
  let beforeRound = Number.isFinite(rawNumber) ? rawNumber : 0;

  if (/km²|㎢|km2/i.test(normalizedUnit)) beforeRound *= 1000000;
  else if (/천㎡|천m²|천m2|1000㎡|1000m²|1000m2/i.test(normalizedUnit)) beforeRound *= 1000;
  else if (/ha|헥타르/i.test(normalizedUnit)) beforeRound *= 10000;

  const rounded = Math.round(beforeRound);
  return {
    rawValue: safe(rawValue),
    sourceUnit: unit,
    convertedM2BeforeRound: beforeRound,
    convertedM2: rounded,
    convertedKm2: beforeRound / 1000000,
    roundedM2: rounded,
  };
}

function normalizeText(value) {
  return safe(value)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeUtf16be(bytes) {
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return output;
}

function decodeBytes(bytes) {
  if (!bytes.length) return "";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16be(bytes.slice(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return Buffer.from(bytes.slice(2)).toString("utf16le");
  return Buffer.from(bytes).toString("utf8");
}

function decodeHexString(value) {
  const cleaned = safe(value).replace(/\s+/g, "");
  if (!cleaned || cleaned.length % 2) return "";
  const bytes = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(parseInt(cleaned.slice(index, index + 2), 16));
  }
  return decodeBytes(bytes);
}

function decodeLiteralString(value) {
  const inner = safe(value).slice(1, -1);
  const bytes = [];

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }

    const next = inner[index + 1];
    if (/[0-7]/.test(next || "")) {
      const octal = inner.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || "";
      bytes.push(parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    const escapeMap = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (next in escapeMap) bytes.push(escapeMap[next]);
    index += 1;
  }

  return decodeBytes(bytes);
}

function decodePdfTextOperators(content) {
  const chunks = [];
  const textOpPattern = /(\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>|\[(?:[^\]]|\][^\sT])*?\])\s*T[Jj]/g;
  let match;

  while ((match = textOpPattern.exec(content))) {
    const token = match[1];
    if (token.startsWith("(")) {
      chunks.push(decodeLiteralString(token));
    } else if (token.startsWith("<")) {
      chunks.push(decodeHexString(token.slice(1, -1)));
    } else if (token.startsWith("[")) {
      const inner = token.slice(1, -1);
      const stringMatches = inner.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) || [];
      chunks.push(stringMatches.map((item) => (
        item.startsWith("(") ? decodeLiteralString(item) : decodeHexString(item.slice(1, -1))
      )).join(""));
    }
  }

  return chunks.join("\n");
}

function inflatePdfStream(streamBuffer) {
  try {
    return inflateSync(streamBuffer).toString("latin1");
  } catch {
    try {
      return inflateRawSync(streamBuffer).toString("latin1");
    } catch {
      return "";
    }
  }
}

function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamPattern.exec(raw))) {
    const dictionary = raw.slice(Math.max(0, match.index - 600), match.index);
    const streamBuffer = Buffer.from(match[1], "latin1");
    const content = /FlateDecode/.test(dictionary)
      ? inflatePdfStream(streamBuffer)
      : streamBuffer.toString("latin1");
    const decoded = decodePdfTextOperators(content);
    if (decoded) chunks.push(decoded);
  }

  const fallback = decodePdfTextOperators(raw);
  if (fallback) chunks.push(fallback);

  return normalizeText(chunks.join("\n"));
}

function buildSearchWindows(text, keywords) {
  const windows = [];
  keywords.forEach((keyword) => {
    let index = text.indexOf(keyword);
    while (index >= 0) {
      windows.push(text.slice(Math.max(0, index - 700), index + 3200));
      index = text.indexOf(keyword, index + keyword.length);
    }
  });
  return windows.length ? windows : [text.slice(0, 6000)];
}

function findAreaEntry(windowText, label, sourceUnit) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|[\\s|,])${escaped}(?:[\\s:：|,]+)([0-9][0-9,\\.\\s]{1,18})`, "m"),
    new RegExp(`${escaped}[^0-9]{0,35}([0-9][0-9,\\.\\s]{1,18})`, "m"),
  ];

  for (const pattern of patterns) {
    const match = windowText.match(pattern);
    const rawValue = match?.[1];
    const converted = convertAreaToM2(rawValue, sourceUnit);
    const value = toNumberString(converted.convertedM2);
    if (value) return { value, conversion: converted };
  }

  return null;
}

function parseLanduseCandidate(text, context) {
  const windows = buildSearchWindows(text, VALID_LANDUSE_TITLES);
  let best = null;

  windows.forEach((windowText, index) => {
    const sourceTableTitle = VALID_LANDUSE_TITLES.find((title) => windowText.includes(title)) || "";
    if (!sourceTableTitle || EXCLUDED_LANDUSE_TITLES.some((title) => windowText.includes(title))) return;

    const sourceUnit = detectUnit(windowText);
    const areas = {};
    const conversionLogs = [];
    LANDUSE_CATEGORIES.forEach((category) => {
      const entry = findAreaEntry(windowText, category, sourceUnit);
      if (entry?.value) {
        areas[category] = entry.value;
        conversionLogs.push({ category, ...entry.conversion });
      }
    });

    const foundCount = Object.keys(areas).length;
    if (foundCount >= 2 && (!best || foundCount > best.foundCount)) {
      best = {
        id: `landuse-${index}`,
        kind: "landuse",
        title: "지목별 토지이용현황 후보",
        confidence: foundCount >= 5 ? "높음" : "확인 필요",
        foundCount,
        landuseAreas: areas,
        zoningRows: [],
        sourceTableTitle,
        sourceUnit,
        conversionLogs,
        ...context,
        preview: normalizeText(windowText).slice(0, 600),
      };
    }
  });

  return best;
}

function parseZoningCandidate(text, context) {
  const windows = buildSearchWindows(text, ["용도지역", "도시지역", "관리지역", "녹지지역"]);
  let best = null;

  windows.forEach((windowText, index) => {
    const sourceTableTitle = windowText.includes("용도지역") ? "용도지역 현황" : "용도지역 후보";
    const sourceUnit = detectUnit(windowText);
    const rows = ZONING_NAMES
      .filter((name) => !EXCLUDED_ZONING_NAMES.includes(name))
      .map((name) => {
        const entry = findAreaEntry(windowText, name, sourceUnit);
        return entry?.value ? { name, area: entry.value, sourceUnit, conversion: entry.conversion } : null;
      })
      .filter(Boolean)
      .filter((row) => row.area);

    if (rows.length >= 2 && (!best || rows.length > best.foundCount)) {
      best = {
        id: `zoning-${index}`,
        kind: "zoning",
        title: "용도지역 현황 후보",
        confidence: rows.length >= 4 ? "높음" : "확인 필요",
        foundCount: rows.length,
        landuseAreas: {},
        zoningRows: rows,
        sourceTableTitle,
        sourceUnit,
        conversionLogs: rows.map((row) => ({ category: row.name, ...row.conversion })),
        ...context,
        preview: normalizeText(windowText).slice(0, 600),
      };
    }
  });

  return best;
}

export function analyzeYearbookPdfBuffer(buffer, { fileName = "", year = "", source = "" } = {}) {
  const text = extractPdfText(buffer);
  const fileYear = extractFileYear(fileName, year);
  const baseYear = extractBaseYear(text, fileYear);
  const adminName = extractAdminName(text, fileName);
  const context = {
    yearbookFileYear: fileYear,
    yearbookBaseYear: baseYear,
    yearbookAdminName: adminName,
  };
  const candidates = [parseLanduseCandidate(text, context), parseZoningCandidate(text, context)].filter(Boolean);
  const resolvedSource = source || `${fileName || "통계연보 PDF"}${year ? ` / ${year}년` : ""}`;

  return {
    fileName,
    source: resolvedSource,
    textLength: text.length,
    candidates: candidates.map((candidate) => ({ ...candidate, source: resolvedSource })),
    message: candidates.length
      ? `${candidates.length}개의 표 후보를 찾았습니다. 후보를 확인한 뒤 현재 양식에 반영해 주세요.`
      : "PDF에서 현재 양식에 맞는 표 후보를 찾지 못했습니다. 스캔 PDF이거나 표 구조가 복잡하면 직접 입력이 필요합니다.",
  };
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const year = safe(formData.get("year"));

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "PDF 파일을 찾지 못했습니다." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "PDF 파일이 너무 큽니다. 35MB 이하 파일로 다시 업로드해 주세요." }, { status: 400 });
    }

    const result = analyzeYearbookPdfBuffer(Buffer.from(await file.arrayBuffer()), {
      fileName: file.name || "",
      year,
      source: `${file.name || "업로드 통계연보 PDF"}${year ? ` / ${year}년` : ""}`,
    });

    return NextResponse.json({
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "PDF 분석 중 오류가 발생했습니다." }, { status: 500 });
  }
}
