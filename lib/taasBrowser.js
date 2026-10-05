import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function taasRuntimeStats() {
  if (process.platform !== 'linux') return {};
  try {
    const root = tmpdir(), disk = statfsSync(root), files = readdirSync(root);
    return { tmpFreeMb: Math.round(disk.bavail * disk.bsize / 1048576), coreDumpCount: files.filter(name => /^core\.chromium\.\d+$/.test(name)).length, workspaceCount: files.filter(name => name.startsWith('tia-taas-')).length };
  } catch { return { tmpStatsUnavailable: true }; }
}

export function taasErrorDetail(error) {
  const message = String(error?.message || error);
  const category = /ERR_INSUFFICIENT_RESOURCES|ENOSPC/.test(message) ? 'RESOURCE_EXHAUSTED'
    : /Timeout|timeout|timed out/i.test(message) ? 'TIMEOUT'
      : /Target.*closed|browser.*closed/i.test(message) ? 'BROWSER_CLOSED' : 'UPSTREAM_ERROR';
  // Retain diagnostic text without request URLs, paths or a stack trace.
  return { category, message: message.split('\n')[0].replace(/https?:\/\/\S+/g, '[url]').replace(/(?:[A-Za-z]:[\\/]|\/tmp\/)[^\s"']+/g, '[path]').slice(0, 400) };
}

export async function createTaasBrowserSession({ playwright, chromium, platform = process.platform, tempRoot = tmpdir(), fileOps = { mkdtemp, rm }, onCleanupError = () => {} }) {
  let browser, context, workspace, closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    // A persistent context owns its browser. Close it before the fallback browser close.
    for (const resource of [context, browser]) {
      try { await resource?.close(); } catch (error) { onCleanupError(error); }
    }
    if (workspace) {
      // Only remove the directory created by this invocation. Never sweep shared /tmp.
      if (dirname(resolve(workspace)) !== resolve(tempRoot) || !basename(workspace).startsWith('tia-taas-')) {
        onCleanupError(new Error('TAAS 임시 폴더 경계 검증 실패'));
        return;
      }
      try { await fileOps.rm(workspace, { recursive: true, force: true, maxRetries: 2 }); }
      catch (error) { onCleanupError(error); }
    }
  }
  try {
    if (platform === 'win32') {
      browser = await playwright.launch({ channel: 'msedge', headless: true });
      context = await browser.newContext({ acceptDownloads: true });
    } else {
      const executablePath = await chromium.executablePath();
      workspace = await fileOps.mkdtemp(join(tempRoot, 'tia-taas-'));
      // The single-process serverless build produced shutdown core dumps with newContext().
      // A fresh default context avoids that failure; its profile and temp files are disposable.
      context = await playwright.launchPersistentContext(join(workspace, 'profile'), {
        args: chromium.args, executablePath, headless: true, acceptDownloads: true,
        env: { ...process.env, TMPDIR: workspace },
      });
      browser = context.browser();
    }
    return { browser, context, close };
  } catch (error) {
    await close();
    throw error;
  }
}
