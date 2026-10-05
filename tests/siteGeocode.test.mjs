import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteGeocoder, currentSiteLocation } from '../lib/siteGeocode.js';

function harness() {
  const timers = new Set(), calls = [], states = [];
  const geocoder = createSiteGeocoder({
    onState: state => states.push(state),
    schedule: fn => { timers.add(fn); return fn; }, unschedule: fn => timers.delete(fn),
    fetchImpl: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })),
  });
  const start = () => { const fn = [...timers][0]; timers.delete(fn); return fn(); };
  const reply = (index, data) => calls[index].resolve({ ok: true, json: async () => data });
  return { ...geocoder, timers, calls, states, start, reply };
}
const success = (latitude, longitude) => ({ success: true, latitude, longitude, matchedAddress: '확인 주소' });

test('typing several characters only geocodes the latest address after the delay', async () => {
  const h = harness();
  h.lookup('서울'); h.lookup('서울특별시 강남구'); h.lookup('  서울특별시 강남구 테헤란로 1  ');
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 1);
  const pending = h.start();
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { address: '서울특별시 강남구 테헤란로 1' });
  h.reply(0, success(37.498086, 127.028001)); await pending;
  assert.equal(h.states.at(-1).status, 'ready');
  assert.equal(h.states.at(-1).lat, '37.498086');
});

test('late old-address responses cannot overwrite the new address, including A to B to A', async () => {
  const h = harness();
  h.lookup('A'); const old = h.start();
  h.lookup('B'); const middle = h.start();
  h.lookup('A'); const latest = h.start();
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.reply(2, success(37.263454, 127.028662)); await latest;
  h.reply(0, success(37.5, 127)); await old;
  h.reply(1, success(37.6, 127.1)); await middle;
  assert.equal(h.states.at(-1).address, 'A');
  assert.equal(h.states.at(-1).lat, '37.263454');
  assert.equal(h.states.filter(s => s.status === 'ready').length, 1);
});

test('clearing address cancels lookup and removes coordinates; failures stay empty', async () => {
  const h = harness();
  h.lookup('A'); const old = h.start(); h.lookup('');
  h.reply(0, success(37.5, 127)); await old;
  assert.equal(h.states.at(-1).status, 'idle'); assert.equal(h.states.at(-1).lat, '');
  h.lookup('없는 주소'); const failed = h.start();
  h.reply(1, { success: false, message: '검색 결과가 없습니다.' }); await failed;
  assert.equal(h.states.at(-1).status, 'error'); assert.equal(h.states.at(-1).lng, '');
});

test('invalid coordinates and disposal never create a usable survey center', async () => {
  const h = harness(); h.lookup('A'); const invalid = h.start();
  h.reply(0, success('', 127)); await invalid;
  assert.equal(h.states.at(-1).status, 'error');
  h.lookup('B'); const disposed = h.start(); const count = h.states.length; h.cancel();
  h.reply(1, success(37.5, 127)); await disposed;
  assert.equal(h.states.length, count);
});

test('new address immediately hides old coordinates before the next effect runs', () => {
  const state = { address: 'A', lat: '37.5', lng: '127', status: 'ready' };
  assert.equal(currentSiteLocation('A', state), state);
  assert.equal(currentSiteLocation('B', state).status, 'loading');
  assert.equal(currentSiteLocation('B', state).lat, '');
  assert.equal(currentSiteLocation('', state).status, 'idle');
});
