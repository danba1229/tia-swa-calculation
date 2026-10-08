import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGbisRoute, parseGbisFile } from '../lib/gyeonggiBus.js';
import { matchTdataRoute } from '../lib/seoulTdata.js';
import { matchSubwayCodes, subwayServiceMinutes, summarizeSubwayTimes } from '../lib/subway.js';
import { createBusRouteTableRows } from '../lib/seoulBusTable.js';
import { createSubwayRows } from '../lib/subwayTable.js';
import { loadBusDetails } from '../lib/busDetailLoader.js';

test('GBIS parser preserves station IDs and leading zero mobile numbers', () => {
 const rows=parseGbisFile('stationId|mobileNo|x|y^201000001|00102|127.0|37.0^',['stationId','x','y']);
 assert.equal(rows[0].mobileNo,'00102');
 assert.throws(()=>parseGbisFile('wrong|field^a|b',['stationId']));
 assert.throws(()=>parseGbisFile('stationId|x|y^1|2',['stationId']));
});
test('GBIS weekday weekend and holiday intervals remain distinct, no origin time substitution', () => {
 const route=mapGbisRoute({routeId:200000085,routeName:98,routeTypeCd:13,upFirstTime:'04:50',upLastTime:'22:10',peekAlloc:18,nPeekAlloc:22,satPeekAlloc:23,satNPeekAlloc:30,sunPeekAlloc:25,sunNPeekAlloc:31,wePeekAlloc:26,weNPeekAlloc:32});
 assert.match(route.stationFirstBusTime,/수동/);
 assert.equal(route.originFirstBusTime,'04:50');
 assert.deepEqual([route.weekdayInterval,route.saturdayInterval,route.sundayInterval,route.holidayInterval],['18~22분','23~30분','25~31분','26~32분']);
 const row=createBusRouteTableRows([{stationName:'test',routes:[route]}])[1];
 assert.deepEqual(row.slice(11),['18~22분','23~30분','25~31분','26~32분']);
 assert.equal(mapGbisRoute({routeId:1,routeName:1,peekAlloc:0,nPeekAlloc:0}).weekdayInterval,'');
});
test('T-DATA exact ID and active status are required, duplicate IDs are ambiguous', () => {
 const row={routeId:'121900013',useAt:'1',opratAt:'1',caralcS:'13',caralcH:'17'};
 assert.equal(matchTdataRoute([row],'100100001'),null);
 assert.equal(matchTdataRoute([row,{...row}],'121900013'),null);
 assert.equal(matchTdataRoute([{...row,useAt:'0'}],'121900013'),null);
 assert.equal(matchTdataRoute([row],row.routeId).holidayInterval,'17분');
 const data=createBusRouteTableRows([{stationName:'a',routes:[{weekdayInterval:'10분',saturdayInterval:'12분'}]}])[1];
 assert.match(data[11],/수동/);assert.match(data[12],/수동/);
});
test('subway matching requires both station name and line; ambiguous names are not substituted', () => {
 const rows=[{subwayStationName:'수원시청(경기도문화의전당)',subwayRouteName:'수인분당',subwayStationId:'MTRKRK1K243'}, {subwayStationName:'수원',subwayRouteName:'1호선'}];
 assert.equal(matchSubwayCodes({place_name:'수원시청역 수인분당선'},rows).length,1);
 assert.equal(matchSubwayCodes({place_name:'수원시청역 1호선'},rows).length,0);
 assert.equal(matchSubwayCodes({place_name:'수원시청역'},rows).length,0);
});
test('subway first/last is computed per service day/destination, ignoring mismatched upstream rows', () => {
 const base={subwayStationId:'MTRKRK1K243',dailyTypeCode:'01',upDownTypeCode:'D',endSubwayStationNm:'고색'};
 const result=summarizeSubwayTimes([{...base,depTime:'053000'},{...base,depTime:'001200'},{...base,depTime:'251500'},{...base,depTime:'999999'},{...base,dailyTypeCode:'02',depTime:'060000'}],base.subwayStationId,'01','D');
 assert.equal(result.invalid,2);assert.equal(result.rows[0].firstTime,'05:30');assert.equal(result.rows[0].lastTime,'익일 01:15');
 assert.equal(subwayServiceMinutes(null),null);assert.equal(subwayServiceMinutes(''),null);assert.equal(subwayServiceMinutes('126000'),null);
});
test('subway export has equal column counts and does not manufacture missing schedules', () => {
 const rows=createSubwayRows([{stationName:'역',distanceMeters:3,line:'1호선',schedules:[],status:'PARTIAL'}]);
 assert.equal(rows[0].length,11);assert.equal(rows[1].length,11);assert.equal(rows[1][7],'수동확인필요');
});
test('complete GBIS base routes are not re-requested or marked pending', async () => {
 let final;
 const stations=[{stationName:'역',routes:[{busRouteId:'200000001',detailStatus:'PARTIAL',weekdayInterval:'10분'}]}];
 await loadBusDetails({stations,scope:{},request:{current:()=>true},needsDetail:()=>false,
  fetchImpl:()=>{throw new Error('unnecessary request')},onProgress:(p)=>{final=p;}});
 assert.equal(final.total,0);assert.equal(final.loading,false);
 assert.equal(final.stations[0].routes[0].detailStatus,'PARTIAL');
 assert.equal(final.stations[0].routes[0].weekdayInterval,'10분');
});
