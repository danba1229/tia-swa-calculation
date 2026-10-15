import { validSurveyCenter } from './researchIntegrity.js';

// A newer address supersedes a pending timer and an in-flight lookup, even when
// the upstream response arrives after cancellation.
export function createSiteGeocoder({ onState, fetchImpl = fetch, delayMs = 600, schedule = setTimeout, unschedule = clearTimeout }) {
  let timer, controller, revision = 0;
  function cancel() {
    revision++;
    unschedule(timer);
    controller?.abort();
  }
  function lookup(value) {
    cancel();
    const address = String(value || '').trim(), id = revision;
    const base = { address, matchedAddress: '', lat: '', lng: '' };
    if (!address) { onState({ ...base, status: 'idle', message: '상단에 주소지를 입력해 주세요.' }); return; }
    onState({ ...base, status: 'loading', message: '주소의 위도·경도를 자동 계산하고 있습니다.' });
    controller = new AbortController();
    const signal = controller.signal;
    timer = schedule(async () => {
      try {
        const response = await fetchImpl('/api/geocode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }), signal,
        });
        const data = await response.json();
        if (revision !== id || signal.aborted) return;
        if (!response.ok || !data.success) throw new Error(data.message || '주소의 좌표를 찾지 못했습니다. 상세 주소를 확인해 주세요.');
        if (!validSurveyCenter(data.latitude, data.longitude)) throw new Error('주소 조회 결과에 유효한 좌표가 없습니다.');
        onState({ address, matchedAddress: String(data.matchedAddress || '').trim(), lat: Number(data.latitude).toFixed(6), lng: Number(data.longitude).toFixed(6), status: 'ready', message: `주소 확인: ${data.matchedAddress || address}` });
      } catch (error) {
        if (revision !== id || signal.aborted) return;
        onState({ ...base, status: 'error', message: error instanceof SyntaxError || error instanceof TypeError ? '주소 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.' : error.message });
      }
    }, delayMs);
  }
  return { lookup, cancel };
}

export function currentSiteLocation(addressValue, state) {
  const address = String(addressValue || '').trim();
  if (state.address === address) return state;
  return { address, matchedAddress: '', lat: '', lng: '', status: address ? 'loading' : 'idle', message: address ? '주소의 위도·경도를 자동 계산하고 있습니다.' : '상단에 주소지를 입력해 주세요.' };
}

// Only a successful match for the current input may determine its survey region.
// Keep the user's input separate; never infer a province from status-message text.
export function resolvedSurveyAddress(address, location) {
  if (!String(address || '').trim() || location?.address !== String(address).trim()
    || location.status !== 'ready' || !validSurveyCenter(location.lat, location.lng)) return '';
  return String(location.matchedAddress || '').trim();
}

// All investigation steps consume the same verified address, even if the user
// starts a search before the debounced address lookup has completed.
export async function resolveInvestigationSite(addressValue, location, { signal, fetchImpl = fetch } = {}) {
  const input = String(addressValue || '').trim();
  if (!input) throw new Error('주소지를 입력해 주세요.');
  const matched = resolvedSurveyAddress(input, location);
  if (matched) return { input, address: matched, center: { lat: Number(location.lat), lng: Number(location.lng) } };
  const response = await fetchImpl('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: input }), signal });
  const data = await response.json();
  if (signal?.aborted) throw new DOMException('취소된 조사', 'AbortError');
  if (!response.ok || !data.success || !data.matchedAddress || !validSurveyCenter(data.latitude, data.longitude)) {
    throw new Error(data.message || '확인된 주소와 좌표가 없습니다. 주소를 다시 확인해 주세요.');
  }
  return { input, address: data.matchedAddress.trim(), center: { lat: Number(data.latitude), lng: Number(data.longitude) } };
}
