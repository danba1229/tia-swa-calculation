import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { discoverBusFile, buildBusSnapshot, collectBusSnapshot, refreshBusSnapshot, BusRefreshError } from "../lib/seoulBusRefresh.js";
import { selectBusSnapshot, getBusSnapshot, isBusStoreConfigured } from "../lib/seoulBusStore.js";
import { busRefreshStatusText } from "../lib/seoulBusRefreshStatus.js";
import { searchSeoulBusSnapshot } from "../lib/seoulBusSnapshot.js";
import XLSX from "xlsx";

const definitions = { stations: ["OA-15067", "1", "서울시버스정류소위치정보"], routes: ["OA-1095", "2", "서울시버스노선별정류소정보"] };
function html(kind, dates = ["20260902"], seq = "60") {
  const [id, infSeq, prefix] = definitions[kind];
  return `<form name="other"><input name="infSeq" value="999"></form><form name="frmFile"><input name="infId" value="${id}"><input name="infSeq" value="${infSeq}"></form>`
    + dates.map(date=>`<span title="${prefix}(${date}).xlsx" onclick="javascript:downloadFile('${seq}');"></span>`).join("");
}
function fixtures(count = 1000) {
  const stations = Array.from({ length: count }, (_,i)=>({ NODE_ID: String(100000000+i), ARS_ID: String(i+1), "정류소명": `정류장${i}`, "X좌표":127, "Y좌표":37.5, "정류소타입":"일반차로" }));
  const routes = stations.map(s=>({ ...s, ROUTE_ID: "100100001", "노선명":"100" }));
  return { stations, routes };
}
const sources = () => ["stations","routes"].map(kind=>({...discoverBusFile(html(kind),kind,"2026-10-03"),sha256:"a".repeat(64),rowCount:1000}));
const errorCode = code=>error=>error instanceof BusRefreshError && error.code===code;

test("bus cron runs monthly on the fifth in Korea while the existing project cron stays unchanged", () => {
  const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(config.crons.find(c=>c.path==="/api/cron/seoul-bus-sync").schedule,"0 19 4 * *");
  assert.equal(config.crons.find(c=>c.path==="/api/cron/tia-sync").schedule,"0 18 * * *");
  for(let month=0;month<12;month++) {
    const korean=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(Date.UTC(2026,month,4,19)));
    assert.equal(korean.find(p=>p.type==="day").value,"05");
    assert.equal(korean.find(p=>p.type==="hour").value,"04");
  }
  assert.match(busRefreshStatusText({status:"UNCHANGED",automatic:true}),/매월 5일 04시대/);
});

test("official file discovery ignores definitions, sorts dates and uses the download form", () => {
  const source = discoverBusFile(html("stations",["20260804","20260902","20270201","20260230"]),"stations","2026-10-03");
  assert.equal(source.baseDate,"2026-09-02"); assert.equal(source.seq,"60"); assert.equal(source.infSeq,"1");
  assert.equal(discoverBusFile(html("routes"),"routes","2026-10-03").infSeq,"2");
  assert.throws(()=>discoverBusFile("<html>login</html>","stations"),errorCode("FILE_LIST_CHANGED"));
  assert.throws(()=>discoverBusFile(html("routes"),"stations"),errorCode("FILE_LIST_CHANGED"));
});

test("snapshot validation preserves leading zero ARS, deduplicates links and rejects corrupt pairs", () => {
  const sheets=fixtures(); sheets.routes.push({...sheets.routes[0]});
  const result=buildBusSnapshot(sheets,sources());
  assert.equal(result.stations[0].arsId,"00001"); assert.equal(result.stations[0].routes.length,1);
  assert.equal(result.diagnostics.duplicateRouteRows,1);
  const mismatched=sources(); mismatched[1].baseDate="2026-08-04";
  assert.throws(()=>buildBusSnapshot(sheets,mismatched),errorCode("SOURCE_DATE_MISMATCH"));
  assert.throws(()=>buildBusSnapshot(sheets,sources(),{...result,baseDate:"2026-10-01"}),errorCode("OLDER_SOURCE"));
  const bad=fixtures(); bad.stations[0]["X좌표"]=null;
  assert.throws(()=>buildBusSnapshot(bad,sources()),errorCode("INVALID_STATION"));
  bad.stations[0]["X좌표"]=127; bad.stations[1].NODE_ID=bad.stations[0].NODE_ID;
  assert.throws(()=>buildBusSnapshot(bad,sources()),errorCode("INVALID_STATION"));
  const noMatch=fixtures(); noMatch.routes.forEach(r=>r.NODE_ID="999999999");
  assert.throws(()=>buildBusSnapshot(noMatch,sources()),errorCode("ROUTE_COVERAGE_CHANGED"));
  assert.throws(()=>buildBusSnapshot(fixtures(),sources(),{...result,stations:Array(1500).fill(result.stations[0])}),errorCode("COUNT_CHANGED"));
});

test("collector reads both official workbooks, detects same-date revisions and never follows redirects", async () => {
  const rows=fixtures(), bytes={};
  for (const kind of ["stations","routes"]) {
    const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows[kind]),"data");
    bytes[kind]=XLSX.write(book,{type:"buffer",bookType:"xlsx"});
  }
  const calls=[];
  const fetchImpl=async (url,options)=>{
    assert.equal(options.redirect,"error"); assert.ok(url.startsWith("https://"));
    assert.ok(options.signal instanceof AbortSignal); calls.push(url);
    const kind=String(options.body || url).includes("OA-15067") ? "stations" : "routes";
    return new Response(options.method === "POST" ? bytes[kind] : html(kind));
  };
  const first=await collectBusSnapshot(null,{fetchImpl,now:"2026-10-03T00:00:00Z"});
  assert.equal(first.status,"UPDATED"); assert.equal(calls.length,4);
  const same=await collectBusSnapshot(first.snapshot,{fetchImpl}); assert.equal(same.status,"UNCHANGED");
  const changed=structuredClone(first.snapshot); changed.sources[0].sha256="b".repeat(64);
  assert.equal((await collectBusSnapshot(changed,{fetchImpl})).status,"UPDATED");
  await assert.rejects(collectBusSnapshot(first.snapshot,{fetchImpl:async()=>new Response("redirect",{status:302})}),errorCode("DOWNLOAD_FAILED"));
  await assert.rejects(collectBusSnapshot(first.snapshot,{fetchImpl:async()=>new Response("too large",{headers:{"content-length":"3000001"}})}),errorCode("DOWNLOAD_FAILED"));
});

test("different latest dates are held rather than mixing the two official datasets", async () => {
  let downloads=0;
  await assert.rejects(collectBusSnapshot(null,{fetchImpl:async(url,options)=>{
    if(options.method) downloads++;
    const kind=url.includes("OA-15067")?"stations":"routes";
    return new Response(html(kind,[kind==="stations"?"20260902":"20260804"]));
  }}),errorCode("SOURCE_DATE_MISMATCH"));
  assert.equal(downloads,0);
});

test("failed or concurrent refresh keeps last successful data, while valid update promotes atomically", async () => {
  const old=buildBusSnapshot(fixtures(),sources()); let current=old, saved, claim="lease1", calls=0;
  const store={claim:async()=>claim,current:async()=>current,finish:async(token,result)=>{
    assert.equal(token,"lease1"); saved=result; if(result.status==="UPDATED")current=result.snapshot; return true;
  }};
  const fail=await refreshBusSnapshot(store,{collect:async()=>{throw new Error("serviceKey=never-echo");}});
  assert.equal(fail.status,"FAILED"); assert.equal(current,old); assert.ok(!JSON.stringify(saved).includes("never-echo"));
  claim=null;
  assert.equal((await refreshBusSnapshot(store,{collect:async()=>{calls++;}})).status,"BUSY"); assert.equal(calls,0);
  claim="lease1";
  const fresh={...old,baseDate:"2026-10-02"};
  assert.equal((await refreshBusSnapshot(store,{collect:async()=>({status:"UPDATED",snapshot:fresh})})).status,"UPDATED");
  assert.equal(current,fresh);
  assert.equal((await refreshBusSnapshot({...store,finish:async()=>false},{collect:async()=>({status:"UPDATED",snapshot:fresh})})).status,"SUPERSEDED");
});

test("stored snapshots drive both scope searches and provenance, corrupt snapshots fall back", () => {
  const fresh=buildBusSnapshot(fixtures(),sources()); fresh.baseDate="2026-10-02";
  const selected=selectBusSnapshot({snapshot:fresh,status:"UPDATED",checked_at:"2026-10-03T00:00:00Z"});
  const scope={center:{lat:37.5,lng:127},width:1000,height:1000,bounds:{north:37.51,south:37.49,east:127.01,west:126.99}};
  const result=searchSeoulBusSnapshot(scope,selected.snapshot);
  assert.equal(result.sourceDate,"2026-10-02"); assert.equal(result.busStops.length,1000);
  assert.equal(selected.refresh.storage,"DATABASE");
  const fallback=selectBusSnapshot({snapshot:{broken:true},status:"UPDATED"});
  assert.equal(fallback.refresh.status,"INVALID_STORED_DATA"); assert.equal(fallback.refresh.storage,"BUNDLED");
  assert.match(busRefreshStatusText({status:"FAILED"}),/기존 자료 유지/);
  assert.match(busRefreshStatusText({status:"NOT_CONFIGURED"}),/미설정/);
});

test("unconfigured store serves the bundled file and cron is fail-closed without its secret", async () => {
  const names=["SEOUL_BUS_DATABASE_URL","SEOUL_BUS_POSTGRES_URL","DATABASE_URL","POSTGRES_URL","CRON_SECRET"], saved=names.map(n=>process.env[n]);
  names.forEach(n=>delete process.env[n]);
  try {
    assert.equal((await getBusSnapshot()).refresh.status,"NOT_CONFIGURED");
    process.env.SEOUL_BUS_DATABASE_URL="postgresql://synthetic.invalid/bus";
    assert.equal(isBusStoreConfigured(),true);
    assert.equal(process.env.DATABASE_URL,undefined);
    delete process.env.SEOUL_BUS_DATABASE_URL;
    const require=createRequire(import.meta.url);
    let src=readFileSync(new URL("../app/api/cron/seoul-bus-sync/route.js",import.meta.url),"utf8");
    src=src.replace('"next/server"',JSON.stringify(pathToFileURL(require.resolve("next/server.js")).href));
    for(const name of ["seoulBusStore","seoulBusRefresh"])src=src.replace(`"../../../../lib/${name}.js"`,JSON.stringify(new URL(`../lib/${name}.js`,import.meta.url).href));
    const {GET}=await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
    assert.equal((await GET(new Request("http://local"))).status,401);
    process.env.CRON_SECRET="test-secret";
    assert.equal((await GET(new Request("http://local",{headers:{authorization:"Bearer wrong"}}))).status,401);
    assert.equal((await GET(new Request("http://local",{headers:{authorization:"Bearer test-secret"}}))).status,503);
  }finally{names.forEach((n,i)=>saved[i]===undefined?delete process.env[n]:process.env[n]=saved[i]);}
});
