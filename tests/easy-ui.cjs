/* RAWAA Cloud 2.15: responsive display behavior for iPhone and computer.
 * Uses a fake Neon session and never accesses production payroll or credentials. */
'use strict';
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const filepath=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!filepath.startsWith(root+path.sep))throw Error('unsafe');
  res.writeHead(200,{'Content-Type':mime[path.extname(filepath)]||'text/plain','Cache-Control':'no-store'});
  res.end(fs.readFileSync(filepath));
 }catch(_){res.writeHead(404);res.end('not found');}
});
async function boot(browser,base,viewport,empty=false,hash=''){
 const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width<600?3:1,hasTouch:viewport.width<600,isMobile:viewport.width<600});
 await context.addInitScript(({empty})=>{
  const store=window.localStorage;
  const read=()=>JSON.parse(store.getItem('mock_nav_row')||'null');
  if(!read())store.setItem('mock_nav_row',JSON.stringify({owner_id:'mock-nav-1',revision:empty?0:2,payload:{}}));
  window.__fakeCloudClient={
   auth:{getSession:async()=>({data:{user:{id:'mock-nav-1',email:'manager@example.com',emailVerified:!empty},session:{id:'mock-session-1'}},error:null})},
   from:()=>({
    select:()=>({eq:()=>({maybeSingle:async()=>({data:read(),error:null})})}),
    insert:input=>({select:()=>({single:async()=>({data:input,error:null})})})
   })
  };
 },{empty});
 await context.route('https://esm.sh/**',route=>route.fulfill({
   status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
   body:'export const createClient = ()=>window.__fakeCloudClient;'
 }));
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/cloud.html'+hash,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof window.RAWAA_EASY_UI_TEST?.getMode==='function',null,{timeout:26000});
 return {page,context,errors};
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const mobile=await boot(browser,base,{width:375,height:812});
  const m=mobile.page;
  assert.equal(await m.evaluate(()=>window.RAWAA_EASY_UI_TEST.getMode()),'easy');
  assert.equal(await m.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'dashboard');
  assert.equal(await m.locator('#rawaa-mobile-tabs').isVisible(),true,'bottom navigation displayed on mobile');
  assert.equal(await m.locator('nav[aria-label="أقسام رواء"]').isVisible(),false,'long navigation hidden on iPhone');
  assert.equal(await m.locator('#rawaa-easy-home').isVisible(),true);
  assert.equal(await m.locator('#cloud-manager-change-button').isVisible(),false,'account actions start collapsed');
  await m.locator('#rawaa-account-menu summary').click();
  assert.equal(await m.locator('#cloud-manager-change-button').isVisible(),true);
  await m.locator('#rawaa-account-menu summary').click();
  assert.equal(await m.locator('#attendance').isVisible(),false,'sections are initially collapsed');
  const widths=await m.evaluate(()=>({screen:document.documentElement.clientWidth,document:document.documentElement.scrollWidth,
   bottom:document.querySelector('#rawaa-mobile-tabs').getBoundingClientRect().width}));
  assert.ok(widths.document<=widths.screen+2,'no global sideways scrolling on iPhone: '+JSON.stringify(widths));
  // Month selection changes only the view; historical months never create payroll writes.
  const monthlyBefore=await m.evaluate(()=>localStorage.getItem('mock_nav_row'));
  await m.locator('#rawaa-home-month').fill('2025-01');
  await m.locator('#rawaa-home-month').dispatchEvent('change');
  assert.equal(await m.locator('#rawaa-home-month-stats .rawaa-easy-metric').count(),4);
  await m.evaluate(()=>document.getElementById('fin-filter').value=window.RAWAA_STAFF.getAll()[0].id);
  await m.locator('.rawaa-home-monthly>a').click();
  assert.equal(await m.locator('#fin-filter').inputValue(),'all','monthly overview opens the same complete roster');
  assert.equal(await m.locator('#fin-month').inputValue(),'2025-01');
  assert.equal(await m.locator('#monthly-ledger').isVisible(),true);
  assert.equal(await m.evaluate(()=>localStorage.getItem('mock_nav_row')),monthlyBefore);
  await m.locator('#rawaa-mobile-tabs a[href="#dashboard"]').click();
  for(const width of [320,390,760]){
   await m.setViewportSize({width,height:844});
   assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),'home fits '+width);
  }
  await m.setViewportSize({width:375,height:812});
  await m.locator('#rawaa-mobile-more').click();
  assert.equal(await m.locator('#rawaa-easy-more-dialog').isVisible(),true);
  assert.equal(await m.locator('#rawaa-mobile-more').getAttribute('aria-expanded'),'true');
  await m.locator('#rawaa-easy-picker-search').fill('قسيمة');
  assert.equal(await m.locator('#rawaa-easy-picker-links a:not([hidden])').count(),1,'search finds payslip');
  await m.locator('#rawaa-easy-picker-links a[href="#payslip"]').click();
  assert.equal(await m.locator('#payslip').isVisible(),true);
  assert.equal(await m.locator('#rawaa-easy-more-dialog').isVisible(),false);
  assert.equal(await m.locator('#rawaa-mobile-more').getAttribute('aria-expanded'),'false');
  assert.equal(await m.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'payslip');
  await m.locator('#rawaa-mobile-more').click();
  await m.keyboard.press('Escape');
  assert.equal(await m.locator('#rawaa-easy-more-dialog').isVisible(),false,'Escape closes navigation');
  await m.locator('#rawaa-mobile-tabs a[href="#dashboard"]').click();
  await m.locator('#rawaa-easy-shortcuts a[href="#shift-planner"]').click();
  assert.equal(await m.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'shift-planner');
  assert.equal(await m.locator('#shift-planner').isVisible(),true,'weekly planner is accessible with one shortcut');
  const rowBefore=await m.evaluate(()=>JSON.parse(window.localStorage.getItem('mock_nav_row')));
  await m.reload({waitUntil:'domcontentloaded'});
  await m.waitForFunction(()=>typeof window.RAWAA_EASY_UI_TEST?.getMode==='function');
  assert.equal(await m.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'shift-planner','deep link survives reload');
  assert.equal(await m.locator('#shift-planner').isVisible(),true);
  const rowAfter=await m.evaluate(()=>JSON.parse(window.localStorage.getItem('mock_nav_row')));
  assert.deepEqual(rowAfter,rowBefore,'display mode must not mutate cloud payroll');
  assert.deepEqual(mobile.errors,[],mobile.errors.join('; '));
  await mobile.context.close();

  const desktop=await boot(browser,base,{width:1440,height:900},false,'#employees');
  const d=desktop.page;
  assert.equal(await d.locator('#employees').isVisible(),true,'desktop direct section deep link opens');
  assert.equal(await d.locator('#rawaa-mobile-tabs').isVisible(),false);
  const originalRoster=await d.evaluate(()=>JSON.stringify(window.RAWAA_STAFF.getAll()));
  const personName=await d.evaluate(()=>window.RAWAA_STAFF.getAll()[1].name);
  await d.locator('#rawaa-staff-search').fill(personName);
  assert.equal(await d.locator('#staff-manage-cards article:not([hidden])').count(),1,'name search narrows the directory');
  await d.locator('#rawaa-staff-status').selectOption('archived');
  assert.equal(await d.locator('#rawaa-directory-empty').isVisible(),true);
  await d.locator('#rawaa-directory-empty button').click();
  assert.equal(await d.locator('#staff-manage-cards article:not([hidden])').count(),3,'clear restores the roster');
  await d.locator('#rawaa-staff-search').fill('no-such-employee');
  assert.equal(await d.locator('#rawaa-directory-empty').isVisible(),true);
  await d.locator('#rawaa-directory-empty button').click();
  await d.locator('#rawaa-staff-add').click();
  assert.equal(await d.evaluate(()=>document.activeElement.id),'staff-name','add shortcut focuses the editor');
  assert.equal(await d.evaluate(()=>JSON.stringify(window.RAWAA_STAFF.getAll())),originalRoster,'directory filters never mutate staff data');
  for(const width of [320,390,760,1440]){
   await d.setViewportSize({width,height:900});
   assert.ok(await d.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),'employee page fits '+width);
  }
  const firstPerson=await d.evaluate(()=>window.RAWAA_STAFF.getAll()[0].id);
  await d.locator('#live-employee-cards a').first().click();
  assert.equal(await d.locator('#att-filter').inputValue(),firstPerson,'employee link opens their records');
  assert.equal(await d.locator('#attendance-log').isVisible(),true);

  const desktopNav=await d.locator('nav[aria-label="أقسام رواء"]').evaluate(el=>({
   position:getComputedStyle(el).position,rect:el.getBoundingClientRect().toJSON(),
   main:document.querySelector('main').getBoundingClientRect().toJSON()
  }));
  assert.equal(desktopNav.position,'fixed','desktop uses real fixed sidebar');
  assert.ok(desktopNav.main.right<desktopNav.rect.left+1,'desktop sidebar does not overlap main content');
  await d.locator('#rawaa-easy-nav-search').fill('قسيمة');
  assert.equal(await d.locator('nav[aria-label="أقسام رواء"] a[href="#payslip"]').isVisible(),true);
  assert.equal(await d.locator('nav[aria-label="أقسام رواء"] a[href="#employees"]').isVisible(),false);
  await d.locator('nav[aria-label="أقسام رواء"] a[href="#payslip"]').click();
  assert.equal(await d.locator('#payslip').isVisible(),true);
  await d.locator('#rawaa-view-toggle').click();
  assert.equal(await d.evaluate(()=>window.RAWAA_EASY_UI_TEST.getMode()),'full','toggle opens full detailed layout');
  assert.equal(await d.locator('#attendance').isVisible(),true,'full mode shows other sections');
  assert.equal(await d.evaluate(()=>sessionStorage.getItem('rawaa_ui_display_mode_v215')),'full','view preference not stored in cloud payroll');
  await d.locator('#rawaa-view-toggle').click();
  assert.equal(await d.evaluate(()=>window.RAWAA_EASY_UI_TEST.getMode()),'easy','toggle restores simple mode');
  await d.emulateMedia({media:'print'});
  assert.equal(await d.locator('#payslip').evaluate(el=>getComputedStyle(el).display),'block','print can display payslip in easy mode');
  assert.equal(await d.locator('#rawaa-easy-toolbar').evaluate(el=>getComputedStyle(el).display),'none','print suppresses navigation');
  await d.emulateMedia({media:'screen'});
  assert.deepEqual(desktop.errors,[],desktop.errors.join('; '));
  await desktop.context.close();

  const empty=await boot(browser,base,{width:375,height:812},true);
  assert.equal(await empty.page.locator('.rawaa-easy-empty').isVisible(),true,'new account shows restore warning, not fake metrics');
  assert.equal(await empty.page.locator('#cloud-manager-setup').count(),1);
  assert.deepEqual(empty.errors,[],empty.errors.join('; '));
  await empty.context.close();
  console.log('PASS: RAWAA 2.15 mobile 375, desktop 1440, fast navigation, deep links, view toggle, print, empty account and payroll isolation');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
