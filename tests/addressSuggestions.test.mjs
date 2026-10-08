import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressSuggester, normalizeAddressSuggestions } from '../lib/addressSuggestions.js';

const address = (value, extra = {}) => ({ address_type: 'ROAD_ADDR', road_address: { address_name: value, building_name: '시청' }, address: { address_name: '서울 중구 태평로1가 31' }, x: '126.978', y: '37.5665', ...extra });
const reply = documents => ({ ok: true, json: async () => ({ documents }) });

test('suggestions prefer road addresses, retain land/building labels, deduplicate and exclude centroids', () => {
  const results = normalizeAddressSuggestions([
    { address_type: 'REGION', address: { address_name: '서울 중구' } },
    { address_type: 'ROAD', address_name: '서울 중구 세종대로' },
    address('서울 중구 세종대로 110'), address('서울  중구 세종대로 110'),
    { address_type: 'REGION_ADDR', address: { address_name: '경기 양평군 양평읍 양근리 1' } }, null,
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].address, '서울 중구 세종대로 110');
  assert.equal(results[0].landAddress, '서울 중구 태평로1가 31');
  assert.equal(results[0].name, '시청');
  assert.equal(results[1].type, '지번');
  assert.equal(results[0].x, undefined, 'A candidate must not supply a verified site coordinate');
  assert.equal(normalizeAddressSuggestions(Array.from({ length: 20 }, (_, i) => address(`도로 ${i}`))).length, 6);
});

test('input validation and missing configuration never call the provider', async () => {
  let calls = 0;
  const suggest = createAddressSuggester({ fetchImpl: () => { calls++; }, getApiKey: () => 'test-key' });
  for (const query of ['', '서', null, {}, '가'.repeat(101), '서울\n중구']) assert.equal((await suggest(query)).status, 400);
  assert.equal((await createAddressSuggester({ fetchImpl: () => { calls++; }, getApiKey: () => '' })('서울시청')).status, 503);
  assert.equal(calls, 0);
});

test('address search uses a fixed HTTPS endpoint and server-only authentication, without unnecessary keyword calls', async () => {
  const calls = [];
  const suggest = createAddressSuggester({ getApiKey: () => 'test-key', fetchImpl: async (url, options) => { calls.push({ url, options }); return reply([address('서울 중구 세종대로 110')]); } });
  const result = await suggest('  세종대로 110  ');
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://dapi.kakao.com');
  assert.equal(calls[0].url.pathname, '/v2/local/search/address.json');
  assert.equal(calls[0].url.searchParams.get('query'), '세종대로 110');
  assert.equal(calls[0].url.searchParams.get('analyze_type'), 'similar');
  assert.equal(calls[0].options.headers.Authorization, 'KakaoAK test-key');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(!JSON.stringify(result).includes('test-key'));
});

test('building-name fallback only follows a successful address search without selectable addresses', async () => {
  const calls = [];
  const suggest = createAddressSuggester({ getApiKey: () => 'test-key', fetchImpl: async url => {
    calls.push(url.pathname);
    return calls.length === 1 ? reply([{ address_type: 'REGION', address: { address_name: '수원' } }])
      : reply([{ place_name: '수원시청', road_address_name: '경기 수원시 팔달구 효원로 241', address_name: '경기 수원시 팔달구 인계동 1111' }]);
  } });
  const result = await suggest('수원시청');
  assert.equal(result.suggestions[0].name, '수원시청');
  assert.equal(result.suggestions[0].address, '경기 수원시 팔달구 효원로 241');
  assert.deepEqual(calls, ['/v2/local/search/address.json', '/v2/local/search/keyword.json']);
});

test('provider errors and malformed responses are not treated as empty results or exposed to the browser', async () => {
  for (const response of [{ ok: false, status: 401 }, { ok: false, status: 429 }, { ok: true, json: async () => ({ unexpected: 'provider-private-detail' }) }]) {
    let calls = 0;
    const result = await createAddressSuggester({ getApiKey: () => 'test-key', fetchImpl: async () => { calls++; return response; } })('서울시청');
    assert.equal(result.status, 502);
    assert.equal(result.success, false);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('provider-private-detail'));
  }
});

test('empty successful searches remain empty, while cancellations propagate to the upstream request', async () => {
  const empty = await createAddressSuggester({ getApiKey: () => 'test-key', fetchImpl: async () => reply([]) })('없는주소');
  assert.equal(empty.success, true);
  assert.deepEqual(empty.suggestions, []);
  const controller = new AbortController();
  controller.abort();
  let propagated = false;
  const result = await createAddressSuggester({ getApiKey: () => 'test-key', fetchImpl: async (_url, options) => {
    propagated = options.signal.aborted;
    throw new DOMException('Request aborted', 'AbortError');
  } })('서울시청', { signal: controller.signal });
  assert.equal(propagated, true);
  assert.equal(result.success, false);
});
