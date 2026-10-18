import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { recommendPlans, planAdminFromGeocode } from '../lib/planRecommendations.js';
import { selectSummary, summaryBlobPath, verifiedSummaryBytes } from '../lib/planDownload.js';
import { createPlanDownloadHandler } from '../lib/planDownloadHandler.js';
import { createSession, readSession } from '../lib/indicatorAuth.js';
const registry = JSON.parse(readFileSync(new URL('../data/plans/registry.json', import.meta.url), 'utf8'));
const admin = code => ({ code, province: '테스트 시도', municipality: '테스트 시군구' });
const rows = (code, year=2026) => recommendPlans(registry, admin(code), year);
const one = (code,id,year) => rows(code,year).find(p => p.planId===id);

test('registry reconciles 73 research IDs / 74 document groups / 27 summaries without source files', () => {
  assert.equal(new Set(registry.plans.map(p=>p.researchId)).size, 73);
  assert.equal(registry.plans.length, 74);
  assert.equal(registry.plans.filter(p=>p.summary).length,27);
  assert.equal(new Set(registry.plans.map(p=>p.versionId)).size,74);
  for (const p of registry.plans) {
    for (const s of p.sources) { assert.match(s.url,/^https:\/\//); assert.doesNotMatch(s.url,/drive.google|X-Amz-|Signature=|kns.tv|fnnews.com/i); }
    if (p.summary) { assert.match(p.summary.sha256,/^[a-f0-9]{64}$/); assert.ok(p.summary.bytes>0); }
  }
});
test('Seoul, Suwon, Seongnam, Yangpyeong, Siheung and Gangneung match different plans', () => {
  assert.equal(one('1165010800','P20').autoSelected,true);
  assert.equal(one('4111112900','P21').autoSelected,true);
  assert.equal(one('4113510100','P21').relevance,'other');
  assert.equal(one('4183031021','P14').autoSelected,true);
  assert.equal(one('4183031021','P21').relevance,'other');
  assert.equal(one('4139010100','P22').relevance,'direct');
  assert.equal(one('4139010100','P22').autoSelected,false);
  assert.equal(one('5115010100','P29').autoSelected,true);
  assert.equal(one('4215010100','P29').autoSelected,true);
  assert.equal(one('5115010100','A13').autoSelected,true);
  assert.equal(one('5115010100','P03').relevance,'other');
});
test('metropolitan and city-specific boundaries never invent proximity', () => {
  assert.equal(one('1165010800','P03').relevance,'metropolitan');
  assert.equal(one('4111112900','P31').relevance,'metropolitan');
  assert.equal(one('4111112900','P34').relevance,'review');
  assert.equal(one('1165010800','A08').autoSelected,false);
  assert.equal(one('1165010800','P46-urban').autoSelected,false);
  assert.equal(one('1165010800','P46-residential').autoSelected,false);
  assert.equal(rows('1165010800').filter(p=>p.planId==='P05').length,1);
});
test('source exceptions and period boundaries survive recommendation', () => {
  for (const id of ['A14','P02','P22','P32']) assert.equal(one('4111112900',id).autoSelected,false);
  assert.match(one('1165010800','A14').note,/3.94km.*3.86km/);
  assert.match(one('1165010800','P32').note,/전문 3권 미확보/);
  assert.equal(one('1165010800','A01',2027).autoSelected,false);
  assert.match(one('1165010800','A01',2027).periodStatus,/기간 경과/);
  assert.match(one('1165010800','A08',2025).periodStatus,/이전/);
  assert.ok(rows('1165010800',2024).every(p=>!p.autoSelected));
  assert.throws(()=>rows('1165010800',NaN),/연도/);
});
test('canonical admin requires precise geocoding and does not accept name-only guesses', () => {
  assert.throws(()=>planAdminFromGeocode({success:true,raw:{address:{h_code:'1165065100'}}}),/법정동/);
  assert.throws(()=>rows(''),/행정코드/);
  const result = planAdminFromGeocode({success:true,matchedAddress:'경기 성남시 분당구',raw:{address:{b_code:'4113510100',region_1depth_name:'경기',region_2depth_name:'성남시 분당구'}}});
  assert.equal(result.municipality,'성남시 분당구');
});
test('public recommendation JSON has no private IDs or storage paths', () => {
  const text=JSON.stringify(rows('1165010800'));
  assert.doesNotMatch(text,/driveId|blob|sha256|[A-Z]:\\|access_token/i);
});
test('existing session signature is required, tampered session is rejected', () => {
  const before=process.env.TIA_CALCULATOR_SESSION_SECRET;
  process.env.TIA_CALCULATOR_SESSION_SECRET='test-only-secret'.repeat(4);
  try {
    const token=createSession({userId:'u1',username:'kim'});
    const request=value=>({cookies:{get:()=>({value})}});
    assert.equal(readSession(request(token)).userId,'u1');
    assert.equal(readSession(request(token+'tampered')),null);
  } finally { if(before===undefined) delete process.env.TIA_CALCULATOR_SESSION_SECRET; else process.env.TIA_CALCULATOR_SESSION_SECRET=before; }
});
const bytes=Buffer.from('PK-test-docx');
const plan={versionId:'P-test',summary:{fileName:'계획-요약본.docx',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
const stream=value=>new Response(value).body;
test('download selects only registered immutable versions and verifies size/hash', async () => {
  assert.throws(()=>selectSummary(registry,'../../.env'),/NOT_FOUND/);
  assert.match(summaryBlobPath(plan),/^tia-plan-summaries-v1\/[a-f0-9]{64}\.docx$/);
  assert.deepEqual(await verifiedSummaryBytes(plan,stream(bytes)),bytes);
  await assert.rejects(verifiedSummaryBytes(plan,stream('PK-test-fake')),/MISMATCH/);
  await assert.rejects(verifiedSummaryBytes(plan,stream('short')),/MISMATCH/);
  await assert.rejects(verifiedSummaryBytes(plan,stream('long'.repeat(500))),/MISMATCH/);
});
test('anonymous HTTP download serves only registered summaries and fails closed', async () => {
  let reads=0;
  const request=new Request('https://app.test/api/plans/download?version=P-test');
  const config={registry:{plans:[plan]},log:()=>{},getBlob:async()=>{reads++;return {statusCode:200,stream:stream(bytes)};}};
  const handler=createPlanDownloadHandler(config);
  for (const version of ['unknown', '../../.env', 'tia-indicator-v1/users/test.json', 'https://example.test/private.docx']) {
    assert.equal((await handler(new Request(`https://app.test/?version=${encodeURIComponent(version)}`))).status,404);
    assert.equal(reads,0);
  }
  const response=await handler(request);
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await handler(new Request('https://app.test/?version=unknown'))).status,404);
  const corrupt=createPlanDownloadHandler({...config,getBlob:async()=>({statusCode:200,stream:stream('fake')})});
  assert.equal((await corrupt(request)).status,503);
  const unavailable=createPlanDownloadHandler({...config,getBlob:async()=>{throw Error('SECRET');}});
  assert.doesNotMatch(await (await unavailable(request)).text(),/SECRET/);
});
