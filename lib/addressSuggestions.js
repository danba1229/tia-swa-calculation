import { ADDRESS_QUERY_MIN, ADDRESS_QUERY_MAX, ADDRESS_SUGGESTION_LIMIT } from './addressQuery.js';

const text = value => typeof value === 'string' ? value.trim() : '';

export function normalizeAddressSuggestions(documents, kind = 'address') {
  const seen = new Set();
  const suggestions = [];
  for (const document of documents) {
    // A road or administrative-area centroid is not a selectable site address.
    if (kind === 'address' && !['ROAD_ADDR', 'REGION_ADDR'].includes(document?.address_type)) continue;
    const road = text(kind === 'place' ? document?.road_address_name : document?.road_address?.address_name);
    const land = text(kind === 'place' ? document?.address_name : document?.address?.address_name);
    const address = road || land;
    const identity = address.replace(/\s/g, '');
    if (!address || seen.has(identity)) continue;
    seen.add(identity);
    suggestions.push({
      address, roadAddress: road, landAddress: land,
      name: text(kind === 'place' ? document?.place_name : document?.road_address?.building_name),
      type: road ? '도로명' : '지번',
    });
    if (suggestions.length === ADDRESS_SUGGESTION_LIMIT) break;
  }
  return suggestions;
}

// Suggestions are discovery only. The selected address still goes through the
// existing precise site geocoder; provider candidate coordinates are not reused.
export function createAddressSuggester({ fetchImpl = fetch, getApiKey = () => process.env.KAKAO_REST_API_KEY } = {}) {
  return async function suggest(value, { signal } = {}) {
    const query = text(value);
    if (query.length < ADDRESS_QUERY_MIN || query.length > ADDRESS_QUERY_MAX || [...query].some(char => char.charCodeAt(0) < 32)) {
      return { success: false, status: 400, message: '검색어는 2~100자로 입력해 주세요.', suggestions: [] };
    }
    const key = text(getApiKey()).replace(/^["']|["']$/g, '').trim();
    if (!key) return { success: false, status: 503, message: '주소 자동완성을 사용할 수 없습니다. 주소를 직접 입력해 주세요.', suggestions: [] };
    const timeout = AbortSignal.timeout(6000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    async function search(kind) {
      const url = new URL(`https://dapi.kakao.com/v2/local/search/${kind === 'place' ? 'keyword' : 'address'}.json`);
      url.searchParams.set('query', query);
      url.searchParams.set('size', '10');
      if (kind === 'address') url.searchParams.set('analyze_type', 'similar');
      const response = await fetchImpl(url, {
        headers: { Authorization: `KakaoAK ${key}` },
        signal: requestSignal, redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Suggestion provider unavailable');
      const payload = await response.json();
      if (!Array.isArray(payload?.documents)) throw new Error('Invalid suggestion response');
      return normalizeAddressSuggestions(payload.documents, kind);
    }
    try {
      let suggestions = await search('address');
      if (!suggestions.length) suggestions = await search('place');
      return { success: true, status: 200, suggestions };
    } catch {
      return { success: false, status: 502, message: '주소 후보를 불러오지 못했습니다. 잠시 후 다시 입력하거나 주소를 직접 입력해 주세요.', suggestions: [] };
    }
  };
}

export const suggestAddresses = createAddressSuggester();
