// Run with node --env-file=.env.local scripts/check_transport_live.mjs.
const { searchGyeonggiBus, fetchGyeonggiBusDetails } = await import('../lib/gyeonggiBus.js');
const { findSubwayStations, getSubwaySchedule } = await import('../lib/subway.js');
const { fetchTdataSupplement } = await import('../lib/seoulTdata.js');
const scope = { center: { lat: 37.2636, lng: 127.0286 }, bounds: { south: 37.2492, north: 37.278, west: 127.0156, east: 127.0416 }, width: 2300, height: 3200 };
for (const [label, run] of [
 ['ggBus',async()=>{const r=await searchGyeonggiBus(scope);return {count:r.busStops.length,sourceDate:r.sourceDate,nearest:r.busStops[0]?.stationName,routeCount:new Set(r.busStops.flatMap(s=>s.routes.map(r=>r.busRouteId))).size};}],
 ['ggDetail',()=>fetchGyeonggiBusDetails(['200000085'])],
 ['subway',async()=>{const r=await findSubwayStations(scope);return r;}],
 ['timetable',()=>getSubwaySchedule('MTRKRK1K243')],
 ['tdata',()=>fetchTdataSupplement('121900013')],
]) {
 try{const result=await run();console.log(label,JSON.stringify(result).slice(0,7000));}
 catch(e){console.log(label,'ERROR',e.message);process.exitCode=1;}
}
