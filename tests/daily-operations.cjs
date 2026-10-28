/* Daily operations board regression — private data never used.
 * Browser emulates signed-in Neon, iPhone and desktop. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 try{
  const parsed=new URL(req.url,'http://127.0.0.1');
  const file=path.resolve(root,'.'+(parsed.pathname==='/'?'/index.html':decodeURIComponent(parsed.pathname)));
  if(!file.startsWith(root+path.sep))throw Error('unsafe');
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
  res.end(fs.readFileSync(file));
 }catch(_){res.writeHead(404);res.end('not found');}
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({...(process.env.RAWAA_TEST_BROWSER?{executablePath:process.env.RAWAA_TEST_BROWSER}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:375,height:812},deviceScaleFactor:3,hasTouch:true,isMobile:true,acceptDownloads:true});
  await context.addInitScript(()=>{
   const native=window.localStorage,key='mock_daily_operations_row';
   if(!native.getItem(key))native.setItem(key,JSON.stringify({owner_id:'daily-owner',revision:1,payload:{}}));
   const read=()=>JSON.parse(native.getItem(key));
   window.__fakeCloudClient={
    auth:{getSession:async()=>({data:{user:{id:'daily-owner',email:'manager@example.com',emailVerified:true},session:{id:'daily-session'}},error:null})},
    from:()=>({
     select:()=>({eq:()=>({maybeSingle:async()=>({data:read(),error:null})})}),
     insert:values=>({select:()=>({single:async()=>({data:values,error:null})})}),
     update:values=>{
      const wh={};
      const q={eq:(key,value)=>{wh[key]=value;return q;},select:()=>q,maybeSingle:async()=>{
       const previous=read();
       if(previous.owner_id!==wh.owner_id||previous.revision!==wh.revision)return {data:null,error:null};
       const next={...previous,...values};native.setItem(key,JSON.stringify(next));return {data:next,error:null};
      }};
      return q;
     }
    })
   };
  });
  await context.route('https://esm.sh/**',route=>route.fulfill({
   status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
   body:'export const createClient=()=>window.__fakeCloudClient;'
  }));
  const page=await context.newPage(),errors=[],decisions=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>decisions.length&&decisions.shift()===false?dialog.dismiss():dialog.accept());
  await page.goto(base+'/cloud.html?rawaa=217#daily-operations',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.RAWAA_DAILY_OPERATIONS_TEST?.getRows==='function'&&typeof window.RAWAA_EASY_UI_TEST?.getSection==='function',null,{timeout:25000});
  assert.equal(await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'daily-operations');
  assert.equal(await page.locator('#daily-operations').isVisible(),true);
  assert.equal(await page.locator('#rawaa-mobile-tabs a[href="#daily-operations"]').isVisible(),true,'daily follow-up is one tap on iPhone');
  await page.locator('#operations-date').fill('2026-10-27');
  const initial=await page.evaluate(()=>({
   actual:window.RAWAA_ATTENDANCE_BRIDGE.getEntries(),
   payroll:window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross
  }));
  assert.equal(initial.actual.length,0);
  assert.equal(initial.payroll,0);
  // Isolated view fixtures: restore every bridge before continuing UI tests.
  const matching=await page.evaluate(()=>{
   const planner=window.RAWAA_PLANNER_TEST,attendance=window.RAWAA_ATTENDANCE_BRIDGE;
   const originalPlans=planner.getPlans,originalActual=attendance.getCalculated;
   const shift=(id,start,end)=>({id,employeeId:'001',date:'2026-10-27',start,end,nextDay:false});
   let plans=[],actual=[];
   planner.getPlans=()=>plans.map(x=>({...x}));
   attendance.getCalculated=()=>actual.map(x=>({...x}));
   const rows=()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows('2026-10-27','all').rows;
   try{
    plans=[shift('early','08:00','12:00'),shift('late','16:00','20:00')];
    actual=[{...shift('record','16:00','20:00'),duration:4}];
    const reserved=rows().map(r=>({plan:r.plan?.id,actual:r.actual?.id,kind:r.kind}));
    plans.reverse();
    const reversed=rows().map(r=>({plan:r.plan?.id,actual:r.actual?.id,kind:r.kind}));
    actual=[{...shift('record','13:00','15:00'),duration:2}];
    const ambiguous=rows().map(r=>r.kind);
    plans=[shift('one','08:00','16:00')];
    actual=[{...shift('record','09:00','17:00'),duration:8}];
    const moved=rows()[0];
    actual=[{...shift('record','08:00','16:00'),duration:8}];
    const exact=rows()[0];
    actual=[{...shift('record','17:00','21:00'),duration:4}];
    const sole=rows()[0];
    return {reserved,reversed,ambiguous,moved:{kind:moved.kind,delta:moved.delta},exact:exact.kind,sole:{kind:sole.kind,actual:sole.actual?.id}};
   }finally{planner.getPlans=originalPlans;attendance.getCalculated=originalActual;}
  });
  assert.deepEqual(matching.reserved,[{plan:'early',actual:undefined,kind:'pending'},{plan:'late',actual:'record',kind:'recorded'}],'later exact match cannot be consumed by an earlier plan');
  assert.deepEqual(matching.reversed,matching.reserved,'matching is independent of plan input order');
  assert.deepEqual(matching.ambiguous,['pending','pending','unplanned'],'ambiguous non-overlapping attendance stays unassigned');
  assert.deepEqual(matching.moved,{kind:'difference',delta:0},'equal-length shifts with changed times need review');
  assert.equal(matching.exact,'recorded');
  assert.deepEqual(matching.sole,{kind:'difference',actual:'record'},'one moved shift remains linkable');
  await page.locator('#operations-date').fill('');
  await page.locator('#operations-next').click();
  assert.equal(await page.locator('#operations-date').inputValue(),await page.evaluate(()=>window.RAWAA_PLANNER_TEST.addDate(window.RAWAA_RESTAURANT_TODAY(),1)),'empty date navigates from today without throwing');
  await page.locator('#operations-date').fill('2026-10-27');

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('shift-planner'));
  const plan=async(date,start,end,nextDay)=>{
   await page.locator('#planner-day').fill(date);
   await page.locator('#planner-start').fill(start);
   await page.locator('#planner-end').fill(end);
   if(nextDay)await page.locator('#planner-next-day').check();
   else await page.locator('#planner-next-day').uncheck();
   await page.locator('#planner-save').click();
  };
  await plan('2026-10-27','20:00','06:00',true);
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===1);
  await plan('2026-10-28','08:00','16:00',false);
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===2);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  await page.locator('#operations-date').fill('2026-10-27');
  const pending=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(pending.summary.planned,1);
  assert.equal(pending.summary.pending,1);
  assert.equal(pending.summary.recorded,0);
  assert.equal(pending.summary.actualHours,0);
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0,'daily board must not create salary');
  assert.equal(await page.locator('#operations-list .operations-review').count(),1);
  await page.locator('#operations-list .operations-review').click();
  assert.equal(await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'attendance');
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-27');
  assert.equal(await page.locator('#att-next').isChecked(),true);
  decisions.push(false);
  await page.locator('#attendance-form button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),0,'declined approval must not save');
  decisions.push(true);
  await page.locator('#attendance-form button[type="submit"]').click();
  await page.waitForFunction(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length===1);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  const completed=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(completed.summary.recorded,1);
  assert.equal(completed.summary.actualHours,10);
  assert.equal(completed.summary.pending,0);
  assert.equal(completed.summary.unplanned,0);
  await page.locator('#operations-date').fill('2026-10-28');
  const carry=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(carry.summary.overnight,1,'show previous-day overnight carry-over');
  assert.equal(carry.summary.pending,1,'today has separately planned shift');
  assert.equal(carry.summary.actualHours,0,'previous-day overnight hours are not counted twice today');
  assert.equal(carry.rows.filter(x=>x.carryover&&x.actual).length,1);
  assert.equal(carry.rows.filter(x=>x.carryover&&x.canReview).length,0,'carry-over does not permit duplicate paid attendance');
  await page.locator('#operations-status').selectOption('overnight');
  assert.equal(await page.locator('#operations-list article').count(),1);
  await page.locator('#operations-status').selectOption('needs-review');
  assert.equal(await page.locator('#operations-list article').count(),1);
  await page.locator('#operations-status').selectOption('all');
  await page.locator('#operations-employee').selectOption('002');
  assert.equal(await page.locator('#operations-list article').count(),0,'employee filter is working');
  await page.locator('#operations-employee').selectOption('all');

  // An actual shift for staff member 002 was never planned: it must be shown
  // as registered work, not a "missing plan" or an absence.
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('attendance'));
  await page.locator('#att-employee').selectOption('002');
  await page.locator('#att-date').fill('2026-10-28');
  await page.locator('#att-start').fill('11:00');
  await page.locator('#att-end').fill('15:00');
  await page.locator('#att-next').uncheck();
  await page.locator('#attendance-form button[type="submit"]').click();
  await page.waitForFunction(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length===2);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  const unplanned=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(unplanned.summary.unplanned,1);
  assert.equal(unplanned.summary.actualHours,4);
  assert.equal(unplanned.summary.overnight,1);
  await page.locator('#operations-status').selectOption('unplanned');
  assert.equal(await page.locator('#operations-list article').count(),1);
  await page.locator('#operations-status').selectOption('all');
  await page.locator('#operations-list .operations-review').click();
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-28');
  await page.locator('#att-start').fill('09:00');
  decisions.push(true);
  await page.locator('#attendance-form button[type="submit"]').click();
  await page.waitForFunction(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length===3);
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  const reviewed=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(reviewed.summary.differing,1,'actual 7h vs planned 8h requires review');
  assert.equal(reviewed.summary.recorded,1);
  assert.equal(reviewed.summary.unplanned,1);
  assert.equal(reviewed.summary.pending,0);
  assert.equal(reviewed.summary.actualHours,11);
  assert.equal(reviewed.summary.overnight,1);


  // New v2.19 path: directly review a saved attendance record from the
  // daily card without silently editing paid hours or discarding drafts.
  const paidBeforeCorrection=await page.evaluate(()=>window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross);
  const actualBeforeCorrection=await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries());
  assert.ok(await page.locator('#operations-list .operations-edit-actual').count()>=2,
    'actual records can be reviewed without drilling into the full attendance table');
  await page.locator('#operations-list .operations-difference .operations-edit-actual').click();
  assert.equal(await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.getSection()),'attendance');
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-28');
  assert.equal(await page.locator('#att-start').inputValue(),'09:00');
  assert.equal(await page.locator('#att-actual-review-hint').isVisible(),true,'editing stored pay displays warning');
  await page.locator('#att-end').fill('15:00');
  assert.deepEqual(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries()),actualBeforeCorrection,
    'opening and changing an unsaved draft must not alter attendance');

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  decisions.push(false);
  await page.locator('#operations-list .operations-unplanned .operations-edit-actual').click();
  assert.equal(await page.locator('#att-end').inputValue(),'15:00','declining to replace draft preserves unsaved edit');
  assert.deepEqual(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries()),actualBeforeCorrection);

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('attendance'));
  decisions.push(false);
  await page.locator('#attendance-form button[type="submit"]').click();
  assert.deepEqual(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries()),actualBeforeCorrection,
    'rejecting payroll impact confirmation must leave actual attendance untouched');
  assert.equal(await page.evaluate(()=>window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross),paidBeforeCorrection);

  decisions.push(true);
  await page.locator('#attendance-form button[type="submit"]').click();
  await page.waitForFunction(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().some(r=>r.employeeId==='001'&&r.date==='2026-10-28'&&r.end==='15:00'));
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),3,
    'correction updates existing attendance row instead of paying a duplicate shift');
  assert.ok(await page.evaluate(()=>window.RAWAA_FINANCE_TEST.sumMonthly('001','2026-10').gross)<paidBeforeCorrection,
    'payroll recalculates only after signed-off correction');

  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  const afterCorrection=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows());
  assert.equal(afterCorrection.summary.differing,1,'shorter saved work remains flagged for review');
  assert.equal(afterCorrection.summary.actualHours,10);
  // A carryover card is dated for the previous day. Opening it for review
  // must use the original date and never double-count on today's dashboard.
  const carryoverEdit=page.locator('#operations-list .operations-overnight .operations-edit-actual');
  assert.equal(await carryoverEdit.count(),1);
  await carryoverEdit.click();
  assert.equal(await page.locator('#att-date').inputValue(),'2026-10-27');
  assert.equal(await page.locator('#att-next').isChecked(),true);
  await page.locator('#att-cancel').click();
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  assert.equal(await page.evaluate(()=>window.RAWAA_ATTENDANCE_BRIDGE.getEntries().length),3);

  // Search and one-tap status shortcuts operate on visible rows only.
  const payrollBefore=await page.evaluate(()=>JSON.stringify(window.RAWAA_CLOUD_STORAGE._snapshot()));
  const todayRows=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows().rows);
  const recordedRow=todayRows.find(r=>r.kind==='difference');
  const unplannedRow=todayRows.find(r=>r.kind==='unplanned');
  assert.ok(recordedRow&&unplannedRow,'there must be contrasting staff shifts');
  await page.locator('[data-operations-filter="needs-review"]').click();
  assert.equal(await page.locator('[data-operations-filter="needs-review"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#operations-status').inputValue(),'needs-review');
  assert.equal(await page.locator('#operations-list article').count(),2,'review filter covers differences and unplanned actual');
  await page.locator('[data-operations-filter="recorded"]').click();
  assert.equal(await page.locator('#operations-list article').count(),0,'recorded excludes differing actual shifts');
  await page.locator('[data-operations-filter="overnight"]').click();
  assert.equal(await page.locator('#operations-list article').count(),1,'overnight shortcut counts prior-day carry without repeating payroll');
  await page.locator('[data-operations-filter="all"]').click();
  assert.equal(await page.locator('#operations-list article').count(),3);
  assert.match(await page.locator('#operations-visible-count').innerText(),/عرض 3 من 3/);
  const findName=recordedRow.employeeId; // ID is distinct even if different staff share the same Arabic name prefix.
  await page.locator('#operations-search').fill(findName);
  const expected=await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getVisibleRows().length);
  assert.ok(expected>0&&expected<3,'staff name query narrows visible rows');
  assert.equal(await page.locator('#operations-list article').count(),expected);
  await page.locator('#operations-search').fill('موظف-غير-موجود-445');
  assert.equal(await page.locator('#operations-list article').count(),0);
  assert.equal(await page.locator('#operations-export').isDisabled(),true,'zero matching rows cannot export');
  assert.equal(await page.locator('#operations-print').isDisabled(),true,'zero matching rows cannot print');
  await page.locator('#operations-search').fill('');
  await page.locator('#operations-status').selectOption('overnight');
  assert.equal(await page.locator('[data-operations-filter="overnight"]').getAttribute('aria-pressed'),'true','native select synchronizes quick-filter chips');
  // A filtered export includes its visible overnight notice, but no paid
  // hours credited to today from a shift started yesterday.
  const [filteredCSV]=await Promise.all([page.waitForEvent('download',{timeout:16000}),page.locator('#operations-export').click()]);
  const filtered=fs.readFileSync(await filteredCSV.path(),'utf8');
  assert.match(filtered,/لا تُحسب ساعاتها مرة ثانية/);
  assert.equal(filtered.trim().split(/\r?\n/).length,2,'CSV has only a header and the visible carryover row');
  const csvRow=filtered.trim().split(/\r?\n/)[1];
  assert.match(csvRow,/,"","وردية بدأت/,'carryover hours are blank, not recounted');
  await page.locator('[data-operations-filter="needs-review"]').click();
  // Test browser print without opening an OS dialog. The print view contains
  // only the currently filtered list, with staff/date/selection disclosure.
  await page.evaluate(()=>{window.__dailyPrintCalled=0;window.print=()=>{window.__dailyPrintCalled++;};});
  await page.locator('#operations-print').click();
  assert.equal(await page.evaluate(()=>window.__dailyPrintCalled),1);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('rawaa-print-daily')),true);
  assert.match(await page.locator('#operations-print-heading').innerText(),/تقرير متابعة الدوام/);
  assert.match(await page.locator('#operations-print-heading').innerText(),/تحتاج مراجعة/);
  assert.equal(await page.locator('#operations-list article').count(),2,'only filtered rows will print');
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('#daily-operations').evaluate(el=>getComputedStyle(el).display),'block','print daily board is visible');
  assert.equal(await page.locator('#payslip').evaluate(el=>getComputedStyle(el).display),'none','print excludes employee payslip');
  assert.equal(await page.locator('#operations-print-heading').evaluate(el=>getComputedStyle(el).display),'block','print heading visible');
  assert.equal(await page.locator('#rawaa-easy-toolbar').evaluate(el=>getComputedStyle(el).display),'none','navigation hidden in printed daily report');
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.evaluate(()=>document.body.classList.contains('rawaa-print-daily')),false);
  // Date controls, filters, downloads and print do not modify payroll.
  await page.locator('#operations-status').selectOption('all');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.RAWAA_CLOUD_STORAGE._snapshot())),payrollBefore,'search/filter/print must not alter payroll');

  const [csv]=await Promise.all([page.waitForEvent('download',{timeout:16000}),page.locator('#operations-export').click()]);
  assert.match(csv.suggestedFilename(),/^RAWAA_Daily_Operations_2026-10-28\.csv$/);
  const content=fs.readFileSync(await csv.path(),'utf8');
  assert.ok(content.includes('وردية')||content.includes('تم تسجيل')||content.includes('الدوام'));
  assert.equal(content.trim().split(/\r?\n/).length,4,'CSV includes exactly the three visible rows in all-status mode');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.RAWAA_CLOUD_STORAGE._snapshot())),payrollBefore,'board and CSV must not touch cloud');
  await page.locator('#operations-prev').click();
  assert.equal(await page.locator('#operations-date').inputValue(),'2026-10-27');
  await page.locator('#operations-next').click();
  assert.equal(await page.locator('#operations-date').inputValue(),'2026-10-28');
  const mobileMetrics=await page.locator('#daily-operations').evaluate(el=>({
   width:el.getBoundingClientRect().width,viewport:document.documentElement.clientWidth,
   scrollWidth:document.documentElement.scrollWidth
  }));
  assert.ok(mobileMetrics.scrollWidth<=mobileMetrics.viewport+2,'no horizontal overflow on iPhone');

  await page.waitForFunction(()=>{
   const row=JSON.parse(window.localStorage.getItem('mock_daily_operations_row')||'null');
   if(!row||!row.payload.RAWAA_DEMO_ATTENDANCE_V12||!row.payload.RAWAA_STAFF_SHIFT_PLAN_V1)return false;
   try{return JSON.parse(row.payload.RAWAA_DEMO_ATTENDANCE_V12).length===3&&JSON.parse(row.payload.RAWAA_STAFF_SHIFT_PLAN_V1).length===2;}
   catch{return false;}
  },null,{timeout:20000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.RAWAA_DAILY_OPERATIONS_TEST?.getRows==='function'&&typeof window.RAWAA_EASY_UI_TEST?.getSection==='function',null,{timeout:20000});
  await page.locator('#operations-date').fill('2026-10-28');
  assert.equal(await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows().summary.recorded),1,'daily board and records survive cloud reload');
  assert.equal(await page.evaluate(()=>window.RAWAA_DAILY_OPERATIONS_TEST.getRows().summary.unplanned),1);
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.RAWAA_EASY_UI_TEST.goTo('daily-operations'));
  const desktopWidth=await page.locator('#operations-list').evaluate(el=>({
   columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,
   rect:el.getBoundingClientRect().toJSON()
  }));
  assert.ok(desktopWidth.columns>=2,'desktop uses multiple columns for shift cards');
  assert.deepEqual(errors,[],errors.join('; '));
  await context.close();
  console.log('PASS: daily operations on iPhone and desktop, night carryover, no double pay, review action, filters, CSV and safe persistence');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
