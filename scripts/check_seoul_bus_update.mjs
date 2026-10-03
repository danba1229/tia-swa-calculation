import previous from "../data/seoul-bus-snapshot.json" with { type: "json" };
import { collectBusSnapshot, BusRefreshError } from "../lib/seoulBusRefresh.js";

// Read-only verification: does not write to the bundled file or production DB.
try {
  const { status, snapshot } = await collectBusSnapshot(previous);
  console.log(JSON.stringify({ status, baseDate: snapshot.baseDate, stationCount: snapshot.stations.length,
    routeLinks: snapshot.stations.reduce((n,s)=>n+s.routes.length,0),
    sources: snapshot.sources.map(({ kind, filename, seq, rowCount })=>({ kind, filename, seq, rowCount })),
    diagnostics: snapshot.diagnostics }, null, 2));
} catch (error) {
  console.error(error instanceof BusRefreshError ? error.code : "공식 자료 갱신 검사 실패 · 기존 자료 유지");
  process.exitCode = 1;
}
