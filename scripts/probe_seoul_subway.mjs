// node --env-file=.env.local scripts/probe_seoul_subway.mjs
const key = process.env.SEOUL_SUBWAY_API_KEY?.trim();
if (!key) throw new Error('SEOUL_SUBWAY_API_KEY missing');
async function call(service, parts) {
  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${service}/1/1000/${parts.map(encodeURIComponent).join('/')}`;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    const result = data[service];
    console.log(service, response.status, JSON.stringify({code:result?.RESULT?.CODE || data.RESULT?.CODE,total:result?.list_total_count,sample:result?.row?.slice(0,2)}));
    return result?.row || [];
  } catch { console.log(service,'CONNECTION_FAILED'); return []; }
}
const stations = await call('SearchInfoBySubwayNameService',['양재']);
const station = stations.find(row=>String(row.LINE_NUM).includes('3'));
if(station) for(const week of ['1','2','3']) await call('SearchSTNTimeTableByIDService',[station.STATION_CD,week,'1']);
