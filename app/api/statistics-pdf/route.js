import { NextResponse } from "next/server";
import { inflateRawSync, inflateSync } from "node:zlib";

export const runtime = "nodejs";

const LANDUSE_CATEGORIES = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원"];
const ZONING_NAMES = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "농림지역", "자연환경보전지역", "미세분지역", "미지정지역"];
const MAX_FILE_SIZE = 35 * 1024 * 1024;

function safe(value) {
  return String(value ?? "").trim();
}

function toNumberString(value) {
  const numeric = safe(value).replace(/[^\d.-]/g, "");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : "";
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

function findAreaValue(windowText, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|[\\s|,])${escaped}(?:[\\s:：|,]+)([0-9][0-9,\\.\\s]{1,18})`, "m"),
    new RegExp(`${escaped}[^0-9]{0,35}([0-9][0-9,\\.\\s]{1,18})`, "m"),
  ];

  for (const pattern of patterns) {
    const match = windowText.match(pattern);
    const value = toNumberString(match?.[1]);
    if (value) return value;
  }

  return "";
}

function parseLanduseCandidate(text) {
  const windows = buildSearchWindows(text, ["토지지목별", "지목별", "지목", "토지"]);
  let best = null;

  windows.forEach((windowText, index) => {
    const areas = {};
    LANDUSE_CATEGORIES.forEach((category) => {
      const value = findAreaValue(windowText, category);
      if (value) areas[category] = value;
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
        preview: normalizeText(windowText).slice(0, 600),
      };
    }
  });

  return best;
}

function parseZoningCandidate(text) {
  const windows = buildSearchWindows(text, ["용도지역", "도시지역", "관리지역", "녹지지역"]);
  let best = null;

  windows.forEach((windowText, index) => {
    const rows = ZONING_NAMES
      .map((name) => ({ name, area: findAreaValue(windowText, name) }))
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
        preview: normalizeText(windowText).slice(0, 600),
      };
    }
  });

  return best;
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = extractPdfText(buffer);
    const candidates = [parseLanduseCandidate(text), parseZoningCandidate(text)].filter(Boolean);
    const source = `${file.name || "업로드 통계연보 PDF"}${year ? ` / ${year}년` : ""}`;

    return NextResponse.json({
      fileName: file.name || "",
      source,
      textLength: text.length,
      candidates: candidates.map((candidate) => ({ ...candidate, source })),
      message: candidates.length
        ? `${candidates.length}개의 표 후보를 찾았습니다. 후보를 확인한 뒤 현재 양식에 반영해 주세요.`
        : "PDF에서 현재 양식에 맞는 표 후보를 찾지 못했습니다. 스캔 PDF이거나 표 구조가 복잡하면 직접 입력이 필요합니다.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "PDF 분석 중 오류가 발생했습니다." }, { status: 500 });
  }
}
