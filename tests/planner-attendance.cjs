/* RAWAA Cloud 2.16: planned shifts must never turn into payable attendance
   without reviewing real hours and confirming. Fake Neon only; no private data. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{
 try{
  const uri=new URL(request.url,'http://127.0.0.1');
  const file=path.resolve(root,'.'+(uri.pathname==='/'?'/index.html':decodeURIComponent(uri.pathname)));
  if(!file.startsWith(root+path.sep))throw Error('outside repository');
  response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
  response.end(fs.readFileSync(file));
 }catch(_){response.writeHead(404);response.end('Not found');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const url='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:375,height:812},deviceScaleFactor:3,hasTouch:true,isMobile:true});
  await context.addInitScript(()=>{
   const local=window.localStorage;
   const key='mock_planned_to_actual_neon_row';
   if(!local.getItem(key))local.setItem(key,JSON.stringify({owner_id:'test-a',revision:1,payload:{}}));
   const get=()=>JSON.parse(local.getItem(key));
   window.__fakeCloudClient={
    auth:{getSession:async()=>({data:{user:{id:'test-a',email:'existing@example.com',emailVerified:true},session:{id:'test-session'}},error:null})},
    from:()=>({
     select:()=>({eq:()=>({maybeSingle:async()=>({data:get(),error:null})})}),
     insert:rows=>({select:()=>({single:async()=>({data:rows,error:null})})}),
     update:values=>{
      const filter={};
      const query={
       eq:(name,value)=>{filter[name]=value;return query;},
       select:()=>query,
       maybeSingle:async()=>{
        const old=get();
        if(old.owner_id!==filter.owner_id||old.revision!==filter.revision)return {data:null,error:null};
        const next={...old,...values};local.setItem(key,JSON.stringify(next));return {data:next,error:null};
       }
      };
      return query;
     }
    })
   };
  });
  await context.route('https://esm.sh/**',route=>route.fulfill({
   status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
   body:'export const createClient=()=>window.__fakeCloudClient;'
  }));
  const page=await context.newPage(),errors=[],decision=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{
   const accept=decision.length?decision.shift():true;
   return accept?dialog.accept():dialog.dismiss();
  });
  await page.goto(url+'/cloud.html?rawaa=216',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.RAWAA_PLANNER_TEST?.getPlans==='function',null,{timeout:25000});
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('shift-planner'));
  const one=async (date,start,end)=>{
   await page.locator('#planner-day').fill(date);
   await page.locator('#planner-start').fill(start);
   await page.locator('#planner-end').fill(end);
   await page.locator('#planner-next-day').uncheck();
   await page.locator('#planner-save').click();
  };
  await one('2026-10-27','08:00','17:00');
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===1);
  await one('2026-10-28','08:00','12:00');
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===2);
  await page.locator('#planner-week-start').fill('2026-10-27');
  const before=await page.evaluate(()=>({
   attend:window.RAWAA_ATTENDANCE_BRIDGE.getEntries(),
   payroll:window.RAWAA_FINANCE_TEST?.sumMonthly?.('001','2026-10')?.gross
  }));
  assert.equal(before.attend.length,0);
  assert.equal(before.payroll,0,'planning has not created any salary');

  const buttons=page.locator('#planner-rows [data-action="prefill"]');
  assert.equal(await buttons.count(),2,'manager can select unsaved planned shifts');
  await buttons.first().click();
  assert.equal(await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'attendance','switch to actual attendance form');
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-27');
  assert.equal(await page.locator('#att-start').inputValue(),'08:00');
  assert.equal(await page.locator('#att-end').inputValue(),'17:00');
  assert.equal(await page.locator('#att-plan-review-hint').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0,'prefill must never silently save');
  assert.equal(await page.evaluate(()=>window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross),0,'prefill must not affect salary');
  const filledName=await page.locator('#attendance-form-title').innerText();
  assert.match(filledName,/مراجعة الحضور الفعلي/);

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('shift-planner'));
  decision.push(false);
  await page.locator('#planner-rows [data-action="prefill"]').nth(1).click();
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-27','declined discard keeps unsaved existing draft');
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('attendance'));
  await page.locator('#att-end').fill('18:00');
  assert.match(await page.locator('#attendance-preview').innerText(),/إضافي: 2/,'actual overtime recalculated from corrected time');

  decision.push(false);
  await page.locator('#attendance-form button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0,'rejecting pay confirmation makes no data mutation');

  decision.push(true);
  await page.locator('#attendance-form button[type="submit"]').click();
  await page.waitForFunction(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length===1);
  const actual=await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries());
  assert.equal(actual[0].date,'2026-10-27');
  assert.equal(actual[0].end,'18:00','real checkout adjustment was saved');
  assert.equal(actual[0].rate,18,'staff rate is used, not a planned rate');
  assert.equal(actual[0].note,'','planned notes never become payroll evidence automatically');
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getCalculated()[0].extra),2);
  assert.ok((await page.evaluate(()=>window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross))>0,'salary only changes after explicit confirmation');
  assert.equal(await page.locator('#att-plan-review-hint').isHidden(),true,'form resets after actual save');

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('shift-planner'));
  await page.locator('#planner-rows [data-action="prefill"]').first().click();
  assert.match(await page.locator('#planner-feedback').innerText(),/تتداخل|تعارض/,'duplicate and overlapping actual shifts are rejected');
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),1);

  try{
   await page.waitForFunction(()=>{
    const row=JSON.parse(localStorage.getItem('mock_planned_to_actual_neon_row')||'null');
    if(!row||row.revision<2||!row.payload?.RAWAA_STAFF_SHIFT_PLAN_V1||!row.payload?.RAWAA_DEMO_ATTENDANCE_V12)return false;
    try{
     return JSON.parse(row.payload.RAWAA_STAFF_SHIFT_PLAN_V1).length===2 &&
       JSON.parse(row.payload.RAWAA_DEMO_ATTENDANCE_V12).length===1;
    }catch{return false;}
   },null,{timeout:9000});
  }catch(error){
   const diagnostic=await page.evaluate(()=>({
    mock:JSON.parse(localStorage.getItem('mock_planned_to_actual_neon_row')||'null'),
    virtual:window.RAWAA_CLOUD_STORAGE._snapshot(),
    cloud:document.querySelector('#cloud-control-bar span')?.textContent,
    block:document.querySelector('#cloud-sync-lock')?.textContent?.slice(0,180)
   }));
   throw new Error('Cloud sync verification failed in fake test: '+JSON.stringify({
    revision:diagnostic.mock?.revision,serverKeys:Object.keys(diagnostic.mock?.payload||{}),
    virtualKeys:Object.keys(diagnostic.virtual||{}),cloud:diagnostic.cloud,block:diagnostic.block,
    serverPlan:diagnostic.mock?.payload?.RAWAA_STAFF_SHIFT_PLAN_V1?.length,serverAttendance:diagnostic.mock?.payload?.RAWAA_DEMO_ATTENDANCE_V12?.length
   }));
  }
  const cloud=await page.evaluate(()=>JSON.parse(localStorage.getItem('mock_planned_to_actual_neon_row')));
  assert.ok(cloud.payload.RAWAA_STAFF_SHIFT_PLAN_V1,'plan persists in cloud snapshot');
  assert.ok(cloud.payload.RAWAA_DEMO_ATTENDANCE_V12,'confirmed actual persists independently');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.RAWAA_PLANNER_TEST?.getPlans==='function',null,{timeout:24000});
  assert.equal(await page.evaluate(()=>window.RAWAA_PLANNER_TEST.getPlans().length),2,'plans persist after reload');
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),1,'actual attendance persists after reload');
  assert.deepEqual(errors,[],errors.join('; '));
  await context.close();
  console.log('PASS: planned-to-actual review, declined confirmation, real overtime, overlap rejection, safe cloud persistence, iPhone view');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
