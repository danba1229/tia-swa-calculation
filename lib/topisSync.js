const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (entry) => console.log(JSON.stringify(entry));

// Only retry the failed source operations. Successful months and permanent
// parse/validation failures must not be downloaded again in the same run.
export async function collectTopisYears(years, deps, {
  force = false, retryDelays = [120000, 300000], sleepImpl = sleep, logger = log,
} = {}) {
  const finished = new Set(), permanent = new Set();
  let pendingYears = [...years];
  let failures = [];
  for (let round = 0; round <= retryDelays.length; round++) {
    const nextYears = new Set();
    failures = failures.filter((f) => !f.retryable);
    for (const year of pendingYears) {
      let items;
      try { items = await deps.list(year); }
      catch (e) {
        const retryable = e.retryable === true;
        const note = e.diagnostic ? e.message : "TOPIS 월별 목록 형식 또는 조회 오류: 수동 확인 필요";
        await deps.record(String(year), "FAILED", note);
        failures.push({ key: String(year), retryable, note });
        logger({ event: "topis_year_failure", year, round: round + 1, retryable, note });
        if (retryable) nextYears.add(year);
        continue;
      }
      for (const item of items) {
        if (finished.has(item.month) || permanent.has(item.month)) continue;
        // DB failures are not TOPIS transport failures: let them stop this run.
        const old = await deps.stored(item.month);
        if (old && old.fingerprint === item.fingerprint && !force) {
          await deps.record(item.month, "NO_CHANGE");
          finished.add(item.month);
          logger({ event: "topis_month_complete", month: item.month, status: "NO_CHANGE" });
          continue;
        }
        let data, bytes;
        try {
          bytes = await deps.download(item);
          data = deps.parse(bytes, item.month);
          if (old && data.rowCount < old.data.rowCount * 0.9) throw new Error("행 수가 기존 대비 10% 이상 감소했습니다. 기존 자료를 유지합니다.");
        } catch (e) {
          const retryable = e.retryable === true;
          const note = e.diagnostic ? e.message : "TOPIS 엑셀 형식/값/행 수 검증 실패: 기존 자료 유지, 수동 확인 필요";
          await deps.record(item.month, "FAILED", note);
          failures.push({ key: item.month, retryable, note });
          logger({ event: "topis_month_failure", month: item.month, round: round + 1, retryable, note });
          if (retryable) nextYears.add(year);
          else permanent.add(item.month);
          continue;
        }
        await deps.save(item, data, bytes);
        finished.add(item.month);
        logger({ event: "topis_month_complete", month: item.month, status: "UPDATED", rows: data.rowCount, missingValues: data.missingValues });
      }
      const yearFailed = failures.some((f) => f.key.startsWith(String(year)));
      await deps.record(String(year), yearFailed ? "PARTIAL" : "CHECKED", `공개된 월 ${items.length}개 확인`);
    }
    if (!nextYears.size || round === retryDelays.length) break;
    const delayMs = retryDelays[round];
    logger({ event: "topis_collection_retry", nextRound: round + 2, delayMs, years: [...nextYears] });
    await sleepImpl(delayMs);
    pendingYears = [...nextYears];
  }
  const result = { success: failures.length === 0, completedMonths: [...finished], failures };
  logger({ event: "topis_collection_complete", ...result });
  return result;
}
