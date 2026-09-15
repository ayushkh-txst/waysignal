// Real citizen UI -> FastAPI/SQLite -> worker notification. Geocoder/weather/AI fixtures.
// TEST_PYTHON=/absolute/venv/bin/python CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/dispatch.browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const serveBuilt=process.env.TEST_SERVE_BUILT==='1';
const appUrl=serveBuilt?'http://127.0.0.1:8000':'http://127.0.0.1:5173';
const temp=await mkdtemp(join(tmpdir(),'dispatch-browser-'));
const backend=spawn(process.env.TEST_PYTHON || 'python3',['-c',`
import uvicorn
from app.main import app
from app.services import dispatch_contacts, dispatch_ai
from app.core.config import settings
from pydantic import SecretStr
settings.openai_api_key=SecretStr('browser-fixture-only')
settings.dispatch_ai_model='browser-fixture-only'
async def location(lat,lon):
    if lat == 0: raise TimeoutError('Fixture geocoder outage')
    return dict(label='Houston test road' if lat>28 else 'Kathmandu test road',country='US' if lat>28 else 'NP',city='Houston' if lat>28 else 'Kathmandu',region='Texas' if lat>28 else 'Bagmati',source='ArcGIS reverse geocoding')
async def review(note):
    return dict(status='complete',signals=[dict(kind='mobility_assistance',evidence='cannot walk')] if 'cannot walk' in note else [],notice='AI fixture: verify the original citizen note.')
dispatch_contacts.resolve_location=location
dispatch_ai.review_note=review
uvicorn.run(app,host='127.0.0.1',port=8000,log_level='error')
`],{cwd:resolve('../backend'),env:{...process.env,JWT_SECRET:'isolated-dispatch-browser-secret-0123456789',DATABASE_URL:`sqlite:///${join(temp,'dispatch.db')}`,FRONTEND_ORIGIN:appUrl,FRONTEND_DIST:serveBuilt?resolve('dist'):'',ENVIRONMENT:serveBuilt?'production':'development'},stdio:['ignore','pipe','pipe']});
let logs=''; backend.stdout.on('data',x=>logs+=x);backend.stderr.on('data',x=>logs+=x);
let vite,browser;
try {
  if(!serveBuilt){vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',server:{host:'127.0.0.1',port:5173,strictPort:true}});await vite.listen();}
  for(let i=0;i<100;i++) { if(backend.exitCode!==null)throw Error(logs);try{if((await fetch('http://127.0.0.1:8000/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100)); }
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
  const worker=await browser.newPage({viewport:{width:1440,height:1000}});
  const citizen=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];for(const p of [worker,citizen]) { p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000); }
  async function login(page,role) {
    await page.goto(appUrl);
    await page.locator('input[type=email]').fill(role==='worker'?'worker@example.com':'citizen@example.com');
    await page.locator('input[type=password]').fill(role==='worker'?'WorkerDemo2026!':'CitizenDemo2026!');
    const response=page.waitForResponse(r=>r.url().endsWith('/auth/login')&&r.request().method()==='POST');
    await page.locator('button[type=submit]').click();await page.waitForURL(role==='worker'?'**/responder':'**/citizen');
    return (await (await response).json()).access_token;
  }
  await citizen.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:29.7179,longitude:-95.402,accuracy:14}}),watchPosition:()=>1,clearWatch:()=>{}}}));
  await citizen.route('**/api/v1/safety/context?**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':appUrl,'access-control-allow-credentials':'true'},body:JSON.stringify({latitude:29.7179,longitude:-95.402,observed_at:new Date().toISOString(),source:'Test weather fixture',temperature_c:22,precipitation_next_6h_mm:0,precipitation_probability_max_6h:0,river_discharge_m3s:null,river_discharge_tomorrow_m3s:null,river_trend_percent:null,prototype_risk_score:20,prototype_risk_level:'low'})}));
  const workerToken=await login(worker,'worker');
  await worker.locator('[data-worker-nav=reports]').click();
  await worker.getByRole('button',{name:'Dispatch notifications, 0 unread'}).waitFor();
  assert.equal(await worker.locator('[data-dispatch-toast]').count(),0,'Demo seeds must not alert');
  await login(citizen,'citizen');
  await citizen.getByRole('button',{name:'View Details',exact:true}).click();
  await citizen.locator('.figma-nav button').filter({hasText:'Emergency Help'}).click();
  await citizen.locator('.emergency-launch').count().then(async count=>{if(count) await citizen.locator('.emergency-launch').click();});
  await citizen.getByRole('button',{name:/Use my location/}).click();
  await citizen.locator('.emergency-type-grid button').filter({hasText:'Medical'}).click();
  await citizen.locator('.emergency-field textarea').fill('We cannot walk to the road. <b>Keep this as plain text</b>');
  const sent=citizen.waitForResponse(r=>r.url().endsWith('/api/v1/emergencies')&&r.request().method()==='POST');
  await citizen.locator('.emergency-submit').click();
  const record=await (await sent).json();assert.ok(record.id.startsWith('SOS-'));
  await worker.locator('[data-dispatch-toast]').waitFor();
  await worker.locator('[data-dispatch-toast] a[href="tel:911"]').waitFor();
  assert.equal(await worker.locator('.ops-shell').getAttribute('data-worker-view'),'reports');
  console.log('PASS citizen form -> persisted SOS -> admin popup while viewing Reports');
  await worker.getByRole('button',{name:'Review request & contacts'}).click();
  const inbox=worker.locator('[data-dispatch-inbox]');
  await inbox.locator('[data-dispatch-contact=houston-police]').waitFor();
  await worker.waitForFunction(()=>document.querySelector('[data-dispatch-inbox] .dispatch-ai-review')?.textContent.includes('cannot walk'));
  assert.equal(await inbox.locator('a[href="tel:911"]').count(),1);
  assert.match(await inbox.locator('.dispatch-call-note').innerText(),/caller/);
  assert.equal(await inbox.locator('.dispatch-citizen-note p b').count(),0,'Citizen HTML is escaped');
  await inbox.getByRole('button',{name:'Mark reviewed',exact:true}).click();
  await worker.getByRole('button',{name:'Dispatch notifications, 0 unread'}).waitFor();
  await inbox.getByRole('button',{name:'Open incident',exact:true}).click();
  await worker.waitForFunction(id=>document.querySelector('.ops-id-row')?.textContent.includes(id),record.id);
  await worker.getByRole('button',{name:'Open dispatch assistance',exact:true}).click();
  await inbox.locator('a[href="tel:911"]').waitFor();
  await login(worker,'worker');
  await worker.getByRole('button',{name:'Dispatch notifications, 0 unread'}).waitFor();
  assert.equal(await worker.locator('[data-dispatch-toast]').count(),0);
  console.log('PASS sourced contacts, optional AI evidence, safe rendering and durable review after sign-in');
  const patchLocation=async(latitude,longitude)=> {
    const result=await fetch(`http://127.0.0.1:8000/api/v1/emergencies/${record.id}/location`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${workerToken}`},body:JSON.stringify({latitude,longitude,accuracy_m:15})});assert.equal(result.status,200);
  };
  await patchLocation(27.7172,85.324);
  await worker.locator('[data-dispatch-toast] a[href="tel:102"]').waitFor();
  await worker.getByRole('button',{name:'Review request & contacts'}).click();
  await inbox.locator('a[href="tel:101"]').waitFor();
  assert.equal(await inbox.locator('a[href="tel:911"]').count(),0);
  assert.equal(await inbox.locator('a[href="tel:100"]').count(),1);
  let failWrite=true;
  await worker.route('**/admin/dispatch/incidents/*/review',route=>failWrite?(failWrite=false,route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':appUrl,'access-control-allow-credentials':'true'},body:JSON.stringify({detail:'Test review write failed'})})):route.continue());
  await inbox.getByRole('button',{name:'Mark reviewed',exact:true}).click();
  await worker.waitForFunction(()=>document.querySelector('[data-dispatch-inbox]')?.textContent.includes('Test review write failed'));
  await worker.getByRole('button',{name:'Dispatch notifications, 1 unread'}).waitFor();
  await inbox.getByRole('button',{name:'Mark reviewed',exact:true}).click();
  await worker.getByRole('button',{name:'Dispatch notifications, 0 unread'}).waitFor();
  console.log('PASS changed GPS re-alert, Nepal directory and failed-review retry');
  const output=process.env.TEST_SCREENSHOT_DIR||temp;await mkdir(output,{recursive:true});
  await worker.screenshot({path:join(output,'dispatch-desktop.png'),fullPage:true});
  await worker.setViewportSize({width:390,height:844});
  await worker.screenshot({path:join(output,'dispatch-mobile.png'),fullPage:true});
  const overflow=await worker.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,18).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,min:getComputedStyle(el).minWidth,grid:getComputedStyle(el).gridTemplateColumns}))}));
  assert.ok(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));
  const bounds=await inbox.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  await patchLocation(0,0);
  await inbox.getByLabel('Emergency contact directory').waitFor();
  await worker.waitForFunction(()=>document.querySelector('[data-dispatch-inbox] .dispatch-location')?.textContent.includes('0.00000, 0.00000'));
  assert.equal(await inbox.locator('.dispatch-call').count(),0);
  await inbox.getByLabel('Emergency contact directory').selectOption('US');
  await inbox.locator('a[href="tel:911"]').waitFor();
  assert.match(await inbox.locator('.dispatch-directory-label').innerText(),/manually selected/);
  await patchLocation(27.7172,85.324);
  await inbox.locator('a[href="tel:102"]').waitFor();
  assert.equal(await inbox.locator('a[href="tel:911"]').count(),0,'A new GPS location clears the manual directory choice');
  await worker.route('**/admin/dispatch/notifications',route=>route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':appUrl,'access-control-allow-credentials':'true'},body:JSON.stringify({detail:'Test dispatch feed outage'})}));
  await worker.waitForFunction(()=>document.querySelector('[data-dispatch-inbox]')?.textContent.includes('Test dispatch feed outage'));
  assert.equal(await inbox.locator('.dispatch-call').count(),0);
  await worker.unroute('**/admin/dispatch/notifications');
  await inbox.getByRole('button',{name:'Retry notifications'}).click();
  await worker.waitForFunction(()=>!document.querySelector('[data-dispatch-inbox]')?.textContent.includes('Test dispatch feed outage'));
  await fetch(`http://127.0.0.1:8000/api/v1/emergencies/${record.id}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${workerToken}`}});
  await worker.waitForFunction(()=>document.querySelector('[data-dispatch-inbox]')?.textContent.includes('No active live requests'));
  assert.equal(await inbox.locator('.dispatch-call').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS mobile fit, geocoder outage/manual directory, stale-feed handling and closed-request cleanup');
  console.log('All dispatch browser checks passed (real API/SQLite; external geocoder/weather/AI fixtures). No numbers were dialed.');
} finally {
  await browser?.close();await vite?.close();backend.kill('SIGTERM');
  await new Promise(r=>backend.exitCode!==null?r():backend.once('exit',r));
  await rm(temp,{recursive:true,force:true});
}
