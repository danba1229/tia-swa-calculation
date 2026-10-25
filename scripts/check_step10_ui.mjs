import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, request } from 'playwright-core';
import serverChromium from '@sparticuz/chromium';
const base = process.argv[2] || 'http://127.0.0.1:3010';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const production = 'https://tia-support.vercel.app';
// Render the local build under the owner's existing authorized map origin.
// All application assets and facility requests are still fulfilled by the local server.
// This does not publish or modify the production application.
const appOrigin = process.argv.includes('--production-origin') ? production : base;
const output = '.preview-test-results/step10';
await mkdir(output, { recursive: true });
// Node's API transport uses the cloud CA and proxy. The browser receives genuine
// upstream SDK/tiles; no fake map, geocode, or sign response is used in screenshots.
const transport = await request.newContext({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const local = await request.newContext();
const browser = await chromium.launch({ args: serverChromium.args.filter(arg => arg !== '--single-process'), executablePath: await serverChromium.executablePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1600 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [], requests = [], failures = [];
let pendingImages = 0;
async function waitForMapImages() {
  for (let i = 0; i < 100 && pendingImages; i++) await page.waitForTimeout(200);
  assert.equal(pendingImages, 0, "Map image responses completed");
  await page.waitForTimeout(700);
}
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname === '/api/traffic-facilities') requests.push(req.url());
  const imageRequest = req.resourceType() === 'image';
  if (imageRequest) pendingImages++;
  try {
    let response;
    if (url.origin === appOrigin) {
      response = ['/api/geocode', '/api/address-suggestions', '/api/traffic-volume'].includes(url.pathname)
        ? await transport.fetch(production + url.pathname + url.search, { method: req.method(), data: req.postData() || undefined, headers: { 'content-type': 'application/json' } })
        : await local.fetch(base + url.pathname + url.search, { method: req.method(), data: req.postData() || undefined, headers: req.headers() });
    } else response = await transport.fetch(req);
    if (response.status() >= 400) failures.push({ host: url.hostname, path: url.pathname, status: response.status() });
    await route.fulfill({ response });
  } catch (e) { failures.push({ host: url.hostname, path: url.pathname, error: e.message.split('\n')[0] }); await route.abort(); }
  finally { if (imageRequest) pendingImages--; }
});
try {
  await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
  await page.getByText('초기 화면이 준비되었습니다.', { exact: true }).waitFor();
  assert.equal(requests.length,0,'No facility requests outside Step 10');
  const nav=page.getByRole('navigation',{name:'조사 항목'});
  await nav.getByRole('button').nth(10).click();
  const facilities=page.getByRole('region',{name:'STEP 10 교통시설물'});
  assert.ok(await facilities.isVisible());
  await page.getByRole('combobox',{name:'주소지'}).fill('서울 서초구 남부순환로 2584');
  await page.getByLabel('가로 범위(m)',{exact:true}).fill('1000');
  await page.getByLabel('세로 범위(m)',{exact:true}).fill('1000');
  await page.locator('.facility-status').filter({hasText:'1000 × 1000m'}).waitFor();
  await page.locator('.facility-callout').first().waitFor();
  await waitForMapImages();
  const info=await page.evaluate(()=>({status:document.querySelector('.facility-status').textContent,dots:document.querySelectorAll('.traffic-facilities .signs-dot').length,tiles:[...document.querySelectorAll('.traffic-facilities .signs-map img')].filter(n=>n.complete&&n.naturalWidth>0).length}));
  assert.ok(info.tiles>5,'Genuine Kakao tiles loaded');assert.ok(info.dots>20);
  assert.ok(await facilities.getByText('모든 자료는 추가 확인이 필요합니다.',{exact:true}).isVisible());
  const filters=page.getByRole('group',{name:'교통시설물 종류'});
  // Seoul unsignalised candidates come from T-GIS crosswalks, so the filter reports a count, not "미연결".
  assert.ok((await filters.getByRole('button',{name:/^비신호교차로 후보/}).textContent()).includes('개 표시'));
  assert.ok((await filters.getByRole('button',{name:/^신호교차로\(보행등 기준\)/}).textContent()).includes('개 표시'));
  await facilities.locator('.facility-table tbody button').first().click();
  assert.ok(await page.locator('.facility-selected-number').isVisible());
  const roadview=await page.locator('.facility-links a').first().getAttribute('href');
  assert.match(roadview,/^https:\/\/map.kakao.com\/link\/roadview\/37[.]/);
  const downloadEvent=page.waitForEvent('download');
  await facilities.getByRole('button',{name:'표시 목록 CSV'}).click();
  const download=await downloadEvent;await download.saveAs(`${output}/facilities.csv`);
  const {readFile}=await import('node:fs/promises');const csv=await readFile(`${output}/facilities.csv`,'utf8');
  assert.ok(csv.includes('위치근거')&&csv.includes('추가확인필요'));
  const before=await facilities.locator('.facility-table').textContent();
  await filters.getByRole('button',{name:/이미지험프/}).click();
  assert.equal(await filters.getByRole('button',{name:/이미지험프/}).getAttribute('aria-pressed'),'false');
  assert.ok(!(await facilities.locator('.facility-table').textContent()).includes('이미지험프'));
  await filters.getByRole('button',{name:/이미지험프/}).click();
  assert.equal(await facilities.locator('.facility-table').textContent(),before);
  await facilities.getByRole('button',{name:'범위에 맞추기'}).click();
  await waitForMapImages();
  const overlapsLegend=await facilities.evaluate(n=>{
    const b=n.querySelector('.facility-legend').getBoundingClientRect();
    return [...n.querySelectorAll('.facility-callout rect')].some(r=>{const a=r.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});
  });
  assert.equal(overlapsLegend,false,'Facility callouts avoid legend');
  await page.screenshot({path:`${output}/seoul-desktop.png`,fullPage:true});
  await facilities.locator('.facility-workbench').screenshot({path:`${output}/seoul-map.png`});
  const requestCount=requests.length;
  await nav.getByRole('button').nth(5).click();
  assert.equal(await facilities.isVisible(),false);
  assert.equal(await facilities.locator('.signs-overlay').count(),0);
  await page.waitForTimeout(500);assert.equal(requests.length,requestCount);
  await nav.getByRole('button').nth(10).click();
  await page.locator('.facility-callout').first().waitFor();
  await page.getByLabel('가로 범위(m)',{exact:true}).fill('0');
  await page.locator('.facility-status').filter({hasText:'1~10,000m'}).waitFor();
  assert.equal(await facilities.locator('.signs-overlay').count(),0);
  await page.getByLabel('가로 범위(m)',{exact:true}).fill('1000');
  await page.locator('.facility-callout').first().waitFor();
  await page.setViewportSize({width:390,height:844});
  await facilities.getByRole('button',{name:'범위에 맞추기'}).click();
  await waitForMapImages();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile overflow');
  await page.evaluate(()=>document.activeElement?.blur());
  await page.screenshot({path:`${output}/seoul-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1800,height:1600});
  const gyeonggiResponse=page.waitForResponse(r=>r.url().includes('/api/traffic-facilities?')&&r.url().includes('region=gyeonggi')&&r.status()===200);
  await page.getByRole('combobox',{name:'주소지'}).fill('경기 수원시 팔달구 효원로 241');
  const gyeonggi=await (await gyeonggiResponse).json();
  assert.ok(gyeonggi.points.some(p=>p.kind==='crosswalk'),'Gyeonggi crosswalk data is available even without local bus credentials');
  assert.ok(gyeonggi.points.every(p=>!p.id.startsWith('seoul-')),'Province switch cannot retain Seoul facilities');
  await page.waitForFunction(()=>document.querySelector('.facility-coverage')?.textContent.includes('경기 신호교차로'));
  await page.locator('.facility-callout').first().waitFor();
  await waitForMapImages();
  await facilities.locator('.facility-workbench').screenshot({path:`${output}/gyeonggi-map.png`});
  assert.deepEqual(errors,[]);
  const evidence={info,requests:requests.length,errors,failures,csvRows:csv.split('\r\n').length-1,gyeonggi:{count:gyeonggi.points.length,busError:gyeonggi.busError}};
  await writeFile(`${output}/evidence.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} catch(e) {
  await page.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});
  console.log(JSON.stringify({errors,failures,status:await page.locator('.facility-status').textContent().catch(()=>''),mapError:await page.locator('.traffic-facilities .signs-map-message').textContent().catch(()=>'' )}));throw e;
} finally {await browser.close();await transport.dispose();await local.dispose();}
