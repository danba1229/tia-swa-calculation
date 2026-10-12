import { listTopisMonths, downloadTopisMonth, parseTopisWorkbook } from "../lib/topisMonthly.js";
import { storedTrafficMonth, saveTrafficMonth, recordTrafficSync, trafficDatabaseConfigured } from "../lib/trafficVolumeStore.js";
import { collectTopisYears } from "../lib/topisSync.js";
import { networkErrorDetails } from "../lib/topisRequest.js";

const yearArg = process.argv.find((s) => s.startsWith("--year="))?.split("=")[1];
const nowYear = new Date().getUTCFullYear();
const years = yearArg ? [Number(yearArg)] : [nowYear - 1, nowYear];
const force = process.argv.includes("--force");
if (!trafficDatabaseConfigured()) throw new Error("TRAFFIC_DATABASE_URL secret is required.");
if (years.some((year) => !Number.isInteger(year) || year < 2015 || year > nowYear)) throw new Error("지원하지 않는 연도입니다.");
try {
  const result = await collectTopisYears(years, {
    list: listTopisMonths, download: downloadTopisMonth, parse: parseTopisWorkbook,
    stored: storedTrafficMonth, save: saveTrafficMonth, record: recordTrafficSync,
  }, { force });
  if (!result.success) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ event: "topis_collection_aborted", note: "저장소 또는 수집 실행 오류. 원자료를 임의 삭제하지 않습니다.", error: networkErrorDetails(error) }));
  process.exitCode = 1;
}
