import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createTaasBrowserSession, taasErrorDetail } from '../lib/taasBrowser.js';

function fixture() {
  const events = [], errors = [], root = resolve('.preview-test-results/lifecycle-tests');
  const workspace = join(root, 'tia-taas-owned');
  const browser = { close: async () => events.push('browser.close') };
  const context = { browser: () => browser, close: async () => events.push('context.close') };
  return { events, errors, workspace, context, browser, options: {
    platform: 'linux', tempRoot: root,
    chromium: { args: ['--single-process'], executablePath: async () => '/tmp/chromium' },
    fileOps: { mkdtemp: async prefix => { assert.equal(prefix, join(root, 'tia-taas-')); return workspace; }, rm: async (path, options) => { assert.equal(path, workspace); assert.equal(options.recursive, true); events.push('rm.owned'); } },
    playwright: { launch: () => assert.fail('Linux must not create an incognito browser session'), launchPersistentContext: async (profile, options) => { assert.equal(profile, join(workspace, 'profile')); assert.equal(options.env.TMPDIR, workspace); assert.equal(options.acceptDownloads, true); events.push('launch.default'); return context; } },
    onCleanupError: error => errors.push(error.message),
  } };
}

test('serverless browser uses a fresh default context and removes only its owned directory after closing', async () => {
  const f = fixture();
  const session = await createTaasBrowserSession(f.options);
  assert.equal(session.context, f.context);
  await session.close(); await session.close();
  assert.deepEqual(f.events, ['launch.default', 'context.close', 'browser.close', 'rm.owned']);
});
test('failed browser launch still removes the allocated workspace and preserves original error', async () => {
  const f = fixture(), error = new Error('launch failed');
  f.options.playwright.launchPersistentContext = async () => { throw error; };
  await assert.rejects(createTaasBrowserSession(f.options), e => e === error);
  assert.deepEqual(f.events, ['rm.owned']);
});
test('context close failure still closes browser and cleans workspace', async () => {
  const f = fixture();
  f.context.close = async () => { f.events.push('context.close'); throw new Error('context already closed'); };
  const session = await createTaasBrowserSession(f.options); await session.close();
  assert.deepEqual(f.events, ['launch.default', 'context.close', 'browser.close', 'rm.owned']);
  assert.deepEqual(f.errors, ['context already closed']);
});
test('cleanup failure is recorded without masking survey results or preventing lock release', async () => {
  const f = fixture();
  f.options.fileOps.rm = async () => { throw new Error('cleanup unavailable'); };
  const session = await createTaasBrowserSession(f.options);
  await assert.doesNotReject(session.close());
  assert.deepEqual(f.errors, ['cleanup unavailable']);
});
test('cleanup rejects paths outside the invocation-owned temp folder boundary', async () => {
  const f = fixture();
  f.options.fileOps.mkdtemp = async () => f.options.tempRoot;
  f.options.playwright.launchPersistentContext = async () => f.context;
  f.options.fileOps.rm = async () => assert.fail('must not delete shared temp root');
  const session = await createTaasBrowserSession(f.options); await session.close();
  assert.match(f.errors[0], /경계 검증 실패/);
});
test('Windows keeps its Edge channel and closes explicit context before browser', async () => {
  const f = fixture(); f.options.platform = 'win32';
  f.browser.newContext = async () => f.context;
  f.options.playwright.launch = async options => { assert.equal(options.channel, 'msedge'); return f.browser; };
  f.options.fileOps.mkdtemp = async () => assert.fail('Windows must not change the serverless tmp root');
  const session = await createTaasBrowserSession(f.options); await session.close();
  assert.deepEqual(f.events, ['context.close', 'browser.close']);
});
test('error classification preserves cause without URLs, stack traces or temp paths', () => {
  assert.equal(taasErrorDetail(new Error('net::ERR_INSUFFICIENT_RESOURCES')).category, 'RESOURCE_EXHAUSTED');
  assert.equal(taasErrorDetail(new Error('page.goto: Target page, context or browser has been closed')).category, 'BROWSER_CLOSED');
  assert.equal(taasErrorDetail(new Error('Timeout 25000ms exceeded')).category, 'TIMEOUT');
  const detail = taasErrorDetail(new Error('Request failed https://example.test/?key=hidden /tmp/chromium-profile\nsecret stack'));
  assert.ok(!/hidden|chromium-profile|secret stack/.test(detail.message));
});
