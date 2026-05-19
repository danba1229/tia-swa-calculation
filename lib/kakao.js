const kakaoGeocodeCache = new Map();

function readKakaoRestApiKey() {
  return String(process.env.KAKAO_REST_API_KEY || "").replace(/^["']|["']$/g, "").trim();
}

export async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (!query) {
    return { success: false, message: "주소가 비어 있습니다." };
  }

  if (kakaoGeocodeCache.has(query)) {
    return kakaoGeocodeCache.get(query);
  }

  const apiKey = readKakaoRestApiKey();
  if (!apiKey) {
    return { success: false, message: "KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다." };
  }

  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", query);

  const response = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "카카오 API 인증키 오류가 발생했습니다."
      : "카카오 API 호출에 실패했습니다.";
    return { success: false, message, status: response.status };
  }

  const payload = await response.json();
  const first = Array.isArray(payload?.documents) ? payload.documents[0] : null;

  if (!first?.x || !first?.y) {
    const result = { success: false, message: "사업지 주소 좌표 변환 실패" };
    kakaoGeocodeCache.set(query, result);
    return result;
  }

  const result = {
    success: true,
    x: Number(first.x),
    y: Number(first.y),
    longitude: Number(first.x),
    latitude: Number(first.y),
    matchedAddress: first.address_name || first.road_address?.address_name || query,
    raw: first,
  };

  kakaoGeocodeCache.set(query, result);
  return result;
}
