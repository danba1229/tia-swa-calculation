import { listTopisMonths, downloadTopisMonth, parseTopisWorkbook } from "../lib/topisMonthly.js";
import { storedTrafficMonth, saveTrafficMonth, recordTrafficSync, trafficDatabaseConfigured } from "../lib/trafficVolumeStore.js";

const yearArg = process.argv.find((s) => s.startsWith("--year="))?.split("=")[1];
const nowYear = new Date().getUTCFullYear();
const years = yearArg ? [Number(yearArg)] : [nowYear - 1, nowYear];
const force = process.argv.includes("--force");
if (!trafficDatabaseConfigured()) throw new Error("TRAFFIC_DATABASE_URL secret is required.");
let failed = 0;
for (const year of years) {
  const failuresBeforeYear = failed;
  let items;
  try { items = await listTopisMonths(year); }
  catch (e) { await recordTrafficSync(String(year), "FAILED", e.message); console.error(`${year}: ${e.message}`); failed++; continue; }
  for (const item of items) {
    try {
      const old = await storedTrafficMonth(item.month);
      if (old?.fingerprint === item.fingerprint && !force) {
        await recordTrafficSync(item.month, "NO_CHANGE");
        console.log(`${item.month}: NO_CHANGE`);
        continue;
      }
      const bytes = await downloadTopisMonth(item);
      const data = parseTopisWorkbook(bytes, item.month);
      if (old && data.rowCount < old.data.rowCount * 0.9) throw new Error("행 수가 기존 대비 10% 이상 감소했습니다. 수동 확인 전 기존 자료를 유지합니다.");
      await saveTrafficMonth(item, data, bytes);
      console.log(`${item.month}: UPDATED (${data.rowCount} rows, ${data.missingValues} missing values)`);
    } catch (e) {
      failed++;
      await recordTrafficSync(item.month, "FAILED", e.message);
      console.error(`${item.month}: ${e.message}`);
    }
  }
  await recordTrafficSync(String(year), failed > failuresBeforeYear ? "PARTIAL" : "CHECKED", `공개된 월 ${items.length}개 확인`);
}
if (failed) process.exitCode = 1;
