// Local compiled UI + real public production API responses and Kakao SDK.
// This checks client behavior only; server collectors are covered separately.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, request } from 'playwright-core';
import c from '@sparticuz/chromium';
const base=process.argv[2] || 'http://127.0.0.1:3021';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const origin='https://tia-support.vercel.app', out='.preview-test-results/investigation-reliability';
await mkdir(out,{recursive:true});
const upstream=await request.newContext({proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined,timeout:60000});
const local=await request.newContext();
const html=await (await upstream.get(origin)).text();
const publicKey=/\\"kakaoJsKey\\":\\"([^"\\]+)\\"/.exec(html)?.[1];
assert.ok(publicKey);
const browser=await chromium.launch({args:c.args.filter(a=>a!=='--single-process'),executablePath:await c.executablePath(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(15000);
const calls=[],errors=[],checks={};
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 try{
  if(url.origin===origin&&url.pathname.startsWith('/api/')){
   const call={path:url.pathname,http:null,body:req.postDataJSON()};calls.push(call);
   const response=await upstream.fetch(req);
   call.http=response.status();
   return await route.fulfill({response});
  }
  const response=url.origin===origin?await local.fetch(base+url.pathname+url.search):await upstream.fetch(req);
  if(url.origin===origin&&url.pathname==='/')return await route.fulfill({response,body:(await response.text()).replaceAll('\\"kakaoJsKey\\":\\"\\"',`\\"kakaoJsKey\\":\\"${publicKey}\\"`)});
  await route.fulfill({response});
 }catch{await route.abort();}
});
try{
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.getByText('초기 화면이 준비되었습니다.',{exact:true}).waitFor();
 const nav=page.getByRole('navigation',{name:'조사 항목'}),choose=i=>nav.getByRole('button').nth(i).click();
 await choose(8);await page.locator('.accident-grid select').first().selectOption('1');
 await page.getByRole('combobox',{name:'주소지',exact:true}).fill('서초구 남부순환로 2584');
 await page.getByLabel('가로 범위(m)',{exact:true}).fill('500');await page.getByLabel('세로 범위(m)',{exact:true}).fill('500');
 await page.getByRole('button',{name:'조사 시작',exact:true}).click();await choose(5);
 for(let i=0;i<8;i++){await page.waitForTimeout(10000);console.log('Waiting for real investigation '+(i+1)*10+'s');}
 for(const name of ['/api/local-statistics','/api/seoul-bus','/api/subway','/api/seoul-bike']) assert.ok(calls.some(c=>c.path===name&&c.http===200),name);
 // The old production TIA collector is deliberately not used as a pass/fail
 // oracle for the new server code: its timeout is one of the issues fixed here.
 assert.ok(calls.some(c=>c.path==='/api/tia/search'));
 assert.ok(calls.filter(c=>c.path==='/api/local-statistics').every(c=>c.body.address==='서울 서초구 남부순환로 2584'));
 assert.ok(calls.filter(c=>c.path==='/api/tia/search').every(c=>c.body.siteAddress==='서울 서초구 남부순환로 2584'&&c.body.sido==='서울특별시'&&c.body.sigungu==='서초구'));
 checks.prefixlessAddress=true;
 const first=page.getByRole('button',{name:'서초구청 버스정류장 정보 보기',exact:true}).first();
 const hit=await first.evaluate(button=>{
  const r=button.getBoundingClientRect();
  const x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y)?.closest('.bus-stop-button');
  return {x,y,name:top?.title};
 });
 // At a wide scale several real stop icons overlap. A normal pointer click
 // must reach the visible top icon rather than a transparent overlay wrapper.
 assert.ok(hit.name,'visible bus icon must receive pointer events');
 await page.mouse.click(hit.x,hit.y);
 assert.ok((await page.getByRole('region',{name:'선택한 버스정류장 정보'}).innerText()).includes(hit.name));checks.wideMapPopup=true;
 await page.getByRole('button',{name:'지도 크게 보기',exact:true}).click();
 await page.getByRole('button',{name:'조사 범위 맞추기',exact:true}).click();
 await first.click();const popup=await page.getByRole('region',{name:'선택한 버스정류장 정보'}).innerText();assert.match(popup,/서초구청\(22863\)/);checks.busPopup=popup;
 await page.getByRole('button',{name:'기본 화면으로',exact:true}).click();
 const text=await page.locator('.workspace-results').innerText();assert.match(text,/기점 첫·막차 미제공 0개 노선/);assert.doesNotMatch(text,/기종점 첫·막차 22/);checks.busGapCount=true;
 assert.ok(await page.locator('.step-section:visible tr').filter({hasText:'토요일'}).filter({hasText:'신분당'}).count()>=2);checks.missingSaturdayVisible=true;
 await page.screenshot({path:out+'/transport.png',fullPage:true});
 await choose(3);await page.getByRole('combobox',{name:'기준연도',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'기준연도',exact:true}).inputValue(),'2025');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'엑셀 출력',exact:true}).click();await (await download).saveAs(out+'/landuse.xlsx');checks.landuseDownload=true;
 await page.setViewportSize({width:390,height:1050});await choose(5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);await page.screenshot({path:out+'/mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);checks.noRuntimeErrors=true;console.log(JSON.stringify(checks));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{await writeFile(out+'/summary.json',JSON.stringify({checks,errors,calls},null,2));await browser.close();await upstream.dispose();await local.dispose();}
