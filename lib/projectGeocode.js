const PROVINCES = {
  서울특별시: "서울", 서울시: "서울", 부산광역시: "부산", 부산시: "부산",
  대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전",
  울산광역시: "울산", 세종특별자치시: "세종", 세종시: "세종", 경기도: "경기",
  강원특별자치도: "강원", 강원도: "강원", 충청북도: "충북", 충청남도: "충남",
  전북특별자치도: "전북", 전라북도: "전북", 전라남도: "전남",
  경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주", 제주도: "제주",
};
const PROVINCE_NAMES = new Set(Object.values(PROVINCES));
const SITE_FIELDS = ["위치", "사업위치", "사업지위치", "위치상세", "소재지", "대상지", "주소",
  "location", "addr", "address", "adres", "bsnsLc", "bsnsLcdtl", "bsnsDstrct"];
export const GEOCODE_SYSTEM_ERRORS = new Set(["MISSING_API_KEY", "AUTH_ERROR", "RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR", "API_ERROR", "INVALID_RESPONSE"]);

export function normalizeGeocodeAddress(value) {
  return String(value || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/(\d)\s*번지/g, "$1").replace(/\s*(?:일원|일대)\s*$/, "")
    .replace(/\s+/g, " ").trim();
}

function canonical(value) {
  let text = normalizeGeocodeAddress(value);
  for (const [name, alias] of Object.entries(PROVINCES)) text = text.replaceAll(name, alias);
  return text;
}

function adminParts(value) {
  const tokens = [];
  for (const token of canonical(value).split(/\s+/)) {
    if (PROVINCE_NAMES.has(token) || /^[가-힣]{2,}(?:시|군|구|읍|면)$/.test(token)) tokens.push(token);
    else break;
  }
  return {
    province: tokens.find((token) => PROVINCE_NAMES.has(token)),
    city: tokens.find((token) => /^[가-힣]+(?:시|군)$/.test(token)),
    district: tokens.find((token) => /^[가-힣]+구$/.test(token)),
    town: tokens.find((token) => /^[가-힣]+(?:읍|면)$/.test(token)),
  };
}

function adminConflict(a, b) {
  const left = adminParts(a), right = adminParts(b);
  const metros = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);
  return ["province", "city", "district", "town"].some((key) => left[key] && right[key] && left[key] !== right[key])
    || Boolean(metros.has(left.province) && !left.city && right.city)
    || Boolean(metros.has(right.province) && !right.city && left.city);
}

function addressIdentity(value) {
  const text = normalizeGeocodeAddress(value);
  const match = text.match(/([가-힣\d·.]+(?:대로|로|길|동|가|읍|면|리))\s+(산\s*)?(\d+)(?:\s*-\s*(\d+))?(?!\d)/);
  if (!match) return null;
  return `${match[1]} ${match[2] ? "산" : ""}${Number(match[3])}-${Number(match[4] || 0)}`;
}

function failure(code, message, extra = {}) {
  return { success: false, code, message, ...extra };
}

// A REGION result is a district centroid, not the location of a building or parcel.
export function selectPreciseAddress(query, documents, totalCount = documents?.length) {
  if (!Array.isArray(documents)) return failure("INVALID_RESPONSE", "카카오 주소검색 응답 형식 오류");
  if (!documents.length) return failure("NOT_FOUND", "해당 주소의 검색 결과가 없습니다.");
  const detailed = documents.filter((doc) => ["REGION_ADDR", "ROAD_ADDR"].includes(doc?.address_type));
  if (!detailed.length) return failure("REGION_ONLY", "동·지역 대표 좌표만 반환되어 사업지 위치를 확정하지 않았습니다.");
  const identity = addressIdentity(query);
  if (!identity) return failure("INSUFFICIENT_ADDRESS", "건물번호 또는 지번이 없어 정확한 위치 확인이 필요합니다.");
  const matches = detailed.filter((doc) => {
    const names = [doc.address_name, doc.address?.address_name, doc.road_address?.address_name].filter(Boolean);
    const qAdmin = adminParts(query);
    return doc.x !== "" && doc.x != null && doc.y !== "" && doc.y != null
      && Number.isFinite(Number(doc.x)) && Number.isFinite(Number(doc.y))
      && Number(doc.x) >= 124 && Number(doc.x) <= 132 && Number(doc.y) >= 32 && Number(doc.y) <= 40
      && names.some((name) => {
        const resultAdmin = adminParts(name);
        return addressIdentity(name) === identity
          && ["province", "city", "district", "town"].every((key) => !qAdmin[key] || qAdmin[key] === resultAdmin[key]);
      });
  });
  if (!matches.length) return failure("ADDRESS_MISMATCH", "검색 결과의 행정구역·건물번호·지번이 요청 주소와 일치하지 않습니다.");
  const distinct = new Set(matches.map((doc) => `${Number(doc.x)},${Number(doc.y)}`));
  if (distinct.size > 1 || Number(totalCount) > documents.length) {
    return failure("AMBIGUOUS_ADDRESS", "주소검색 결과가 여러 위치에 해당하여 수동 확인이 필요합니다.");
  }
  const match = matches[0];
  return {
    success: true, code: "PRECISE_ADDRESS", message: "상세 주소 일치 확인",
    x: Number(match.x), y: Number(match.y), longitude: Number(match.x), latitude: Number(match.y),
    matchedAddress: match.address_name, addressType: match.address_type, raw: match,
  };
}

function adminPrefix(value) {
  const tokens = canonical(value).split(/\s+/);
  const parts = [];
  for (const token of tokens) {
    if (PROVINCE_NAMES.has(token) || /^[가-힣]+(?:시|군|구|읍|면)$/.test(token)) parts.push(token);
    else break;
  }
  const prefix = parts.join(" ");
  const admin = adminParts(prefix);
  return admin.province && (admin.city || admin.district || admin.province === "세종") ? prefix : "";
}

function parcelMatches(value) {
  return [...String(value || "").matchAll(/(?:[가-힣]+(?:읍|면)\s+)?[가-힣\d·]+(?:동|가|리)\s+(?:산\s*)?\d+(?:\s*-\s*\d+)?(?:번지)?/g)]
    .map((match) => normalizeGeocodeAddress(match[0]));
}

export function buildProjectAddressCandidates(project) {
  const sources = [...new Set([project.location, ...SITE_FIELDS.map((field) => project.raw?.[field])]
    .filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  const title = String(project.projectName || "");
  const all = [...sources, title];
  if (all.some((left, i) => all.slice(i + 1).some((right) => adminConflict(left, right)))) {
    return { candidates: [], ...failure("ADMIN_CONFLICT", "사업명과 위치 자료의 행정구역이 달라 수동 확인이 필요합니다.") };
  }
  const parcels = [...new Set(all.flatMap(parcelMatches).map((text) => addressIdentity(text)))];
  const multiple = all.some((text) => /\d+(?:-\d+)?\s*(?:번지)?\s*(?:\([^)]*\))?\s*(?:[,、/~]|및|와|과)\s*(?:산\s*)?\d/.test(text)
    || /(?:외|등)\s*\d+\s*필지|\d+\s*~\s*\d+/.test(text)
    || [...text.matchAll(/(\d+)\s*필지/g)].some((match) => Number(match[1]) > 1));
  if (parcels.length > 1 || multiple) {
    return { candidates: [], ...failure("MULTIPLE_LOCATIONS", "여러 필지·구간이 포함된 사업으로 단일 대표 위치를 자동 확정하지 않았습니다.") };
  }
  const candidates = [];
  const add = (query, method) => {
    if (query && !candidates.some((candidate) => candidate.query === query)) candidates.push({ query, method });
  };
  for (const source of sources) {
    add(source, "ORIGINAL");
    add(normalizeGeocodeAddress(source), "NORMALIZED");
  }
  // Only the candidate's own source address may provide a missing jurisdiction.
  const prefix = sources.map(adminPrefix).find(Boolean) || adminPrefix(title);
  for (const text of all) {
    for (const parcel of parcelMatches(text)) {
      let ownPrefix = adminPrefix(text) || prefix;
      if (/^[가-힣]+(?:읍|면)\s/.test(parcel)) ownPrefix = ownPrefix.replace(/\s+[가-힣]+(?:읍|면)$/, "");
      if (ownPrefix) add(`${ownPrefix} ${parcel}`, "PARCEL_FALLBACK");
    }
  }
  const primaryCount = sources[0] && normalizeGeocodeAddress(sources[0]) !== sources[0] ? 2 : 1;
  const preferred = [...candidates.slice(0, primaryCount),
    ...candidates.filter((candidate) => candidate.method === "PARCEL_FALLBACK"),
    ...candidates.slice(primaryCount)];
  return { candidates: preferred.filter((candidate, i) => preferred.findIndex((item) => item.query === candidate.query) === i).slice(0, 6) };
}

export async function geocodeProject(project, { lookup, budgetMs = 12000, now = Date.now } = {}) {
  const plan = buildProjectAddressCandidates(project);
  const attempts = [];
  if (plan.code) return { ...plan, attempts };
  if (!plan.candidates.length) return failure("EMPTY_ADDRESS", "사업지 위치 정보가 없습니다.", { attempts });
  const deadline = now() + budgetMs;
  let result = failure("NOT_FOUND", "정확한 사업지 주소를 찾지 못했습니다.");
  for (const candidate of plan.candidates) {
    const remaining = deadline - now();
    if (remaining <= 0) return failure("TIMEOUT", "주소 재검색 시간이 초과되었습니다. 다시 검색해 주세요.", { attempts });
    let attempt;
    try {
      attempt = await lookup(candidate.query, { timeoutMs: Math.min(5000, remaining) });
    } catch {
      attempt = failure("NETWORK_ERROR", "카카오 주소검색 연결 실패. 다시 검색해 주세요.");
    }
    attempts.push({ ...candidate, code: attempt.code, message: attempt.message, matchedAddress: attempt.matchedAddress || "" });
    if (attempt.success) return { ...attempt, query: candidate.query, method: candidate.method, attempts };
    if (GEOCODE_SYSTEM_ERRORS.has(attempt.code)) return { ...attempt, attempts };
    if (result.code === "NOT_FOUND" || attempt.code !== "NOT_FOUND") result = attempt;
  }
  return { ...result, attempts };
}
