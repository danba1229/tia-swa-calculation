// The response uses the last verified snapshot. The host's after()/waitUntil()
// owns refresh lifetime; an unawaited promise must not be used on serverless.
export function createBackgroundSnapshotReader({ read, refresh, now = Date.now }) {
  let scheduled = false;
  return async function get({ defer } = {}) {
    const saved = await read();
    if (saved?.fresh) return { snapshot: saved.snapshot, stale: false, refreshing: false };
    const cooling = saved?.retryAt > now();
    if (!defer) return refresh();
    if (!scheduled && !cooling) {
      scheduled = true;
      defer(async () => { try { await refresh(); } catch { /* retry state is persisted by refresh */ } finally { scheduled = false; } });
    }
    return { snapshot: saved?.snapshot || null, stale: Boolean(saved?.snapshot), refreshing: !cooling,
      warning: cooling ? `${saved.lastError || '원문 갱신 재시도 대기 중입니다.'} ${saved?.snapshot ? '기존 확인 자료를 표시합니다.' : '최초 수집이 완료되지 않았습니다. 잠시 후 저장자료 새로고침을 눌러 주세요.'}`
        : saved?.snapshot ? '저장된 관측자료를 먼저 표시하고 원문을 별도로 갱신합니다. 자료의 관측연도를 확인해 주세요.' : '경기도 교통량을 최초 수집 중입니다. 완료되면 자동으로 표시합니다.' };
  };
}
