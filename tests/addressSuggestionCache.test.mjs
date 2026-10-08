import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressSuggestionCache } from '../lib/addressSuggestionCache.js';

test('address cache reuses exact successful queries, including empty results, until expiry', () => {
  let time = 100;
  const cache = createAddressSuggestionCache({ now: () => time, ttlMs: 1000 });
  const items = [{ address: '서울 중구 세종대로 110' }];
  cache.set('서울 시청', items);
  cache.set('없는주소', []);
  time = 1099;
  assert.deepEqual(cache.get('서울 시청'), items);
  assert.deepEqual(cache.get('없는주소'), []);
  assert.equal(cache.get('서울 시'), undefined);
  time = 1100;
  assert.equal(cache.get('서울 시청'), undefined);
  assert.equal(cache.get('없는주소'), undefined);
});

test('address cache bounds retained queries and refreshing a query replaces its lifetime', () => {
  let time = 0;
  const cache = createAddressSuggestionCache({ maxEntries: 2, ttlMs: 100, now: () => time });
  cache.set('첫번째', ['old']);
  cache.set('두번째', []);
  time = 50;
  cache.set('첫번째', ['updated']);
  cache.set('세번째', []);
  assert.equal(cache.get('두번째'), undefined);
  time = 100;
  assert.deepEqual(cache.get('첫번째'), ['updated']);
  time = 150;
  cache.set('네번째', []);
  assert.equal(cache.get('첫번째'), undefined);
  assert.equal(cache.get('세번째'), undefined);
  assert.deepEqual(cache.get('네번째'), []);
});
