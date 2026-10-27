/* Test multi-device cloud bridge with a deterministic fake Neon client, then
   check live Neon SDK module loads. node tests/cloud-browser.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!file.startsWith(root+path.sep))throw Error('unsafe');
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(fs.readFileSync(file));
}catch(_){res.writeHead(404);res.end('Missing');}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),base='http://127.0.0.1:'+server.address().port;
  await context.addInitScript(()=>{
    const native=window.localStorage;
    const getRow=()=>JSON.parse(native.getItem('neon_mock_row')||'null');
    const setRow=v=>native.setItem('neon_mock_row',JSON.stringify(v));
    const getSession=()=>native.getItem('neon_mock_session')==='yes'?{data:{session:{id:'sess-1'},user:{id:'uuid-example-user-1',email:'tester@example.com',emailVerified:native.getItem('neon_mock_email_verified')==='yes'}},error:null}:{data:{session:null,user:null},error:null};
    window.__fakeCloudClient={
      auth:{
        getSession:async()=>getSession(),
        signUp:{email:async()=>{native.setItem('neon_mock_session','yes');return {data:{user:{id:'uuid-example-user-1'}}};}},
        signIn:{email:async()=>{native.setItem('neon_mock_session','yes');return {data:{user:{id:'uuid-example-user-1'}}};}},
        signOut:async()=>{native.removeItem('neon_mock_session');return {error:null}},
        emailOtp:{
          sendVerificationOtp:async({email,type})=>{
            if(email!=='tester@example.com'||type!=='email-verification')return {error:{message:'Invalid request'}};
            native.setItem('neon_mock_email_otp_sent','yes');return {data:{success:true},error:null};
          },
          verifyEmail:async({email,otp})=>{
            if(email==='tester@example.com'&&otp==='123456'&&native.getItem('neon_mock_email_otp_sent')==='yes'){
              native.setItem('neon_mock_email_verified','yes');return {data:{success:true},error:null};
            }
            return {error:{message:'Invalid OTP'}};
          }
        }
      },
      from:()=>({
        select:()=>({eq:()=>({maybeSingle:async()=>({data:getRow(),error:null})})}),
        insert:values=>({select:()=>({single:async()=>{let row=getRow();if(row)return {data:null,error:{message:'duplicate'}};row={...values};setRow(row);return {data:row,error:null}}})}),
        update:values=>{
          const filters={};
          const query={eq:(k,v)=>{filters[k]=v;return query;},select:()=>query,maybeSingle:async()=>{
            const old=getRow();if(!old||old.owner_id!==filters.owner_id||old.revision!==filters.revision)return {data:null,error:null};
            const next={...old,...values};setRow(next);return {data:next,error:null};}};
          return query;
        }
      })
    };
  });
  await context.route('https://esm.sh/**',route=>route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:'export const createClient = ()=>window.__fakeCloudClient;'}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/cloud.html',{waitUntil:'domcontentloaded'});
  await page.locator('#cloud-login input[type="email"]').waitFor({timeout:15000});
  assert.equal(await page.evaluate(()=>typeof window.RAWAA_STAFF),'undefined','not available until login');
  await page.locator('#cloud-login input[type="email"]').fill('tester@example.com');
  await page.locator('#cloud-login input[type="password"]').fill('testing-password-123');
  page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('RAWAA-backup-passphrase-2026'):dialog.accept());
  await page.getByRole('button',{name:'إنشاء حساب لأول مرة'}).click();
  await page.locator('#staff-manage-cards .staff-manage-card').first().waitFor({timeout:16000});
  assert.equal(await page.getByRole('button',{name:'استعادة نسخة احتياطية'}).count(),1,'restore action available');
  // Even when the original transfer was opened in a different Safari tab,
  // a new and empty manager workspace must show its setup checklist.
  assert.equal(await page.locator('#cloud-manager-setup').count(),1,'empty workspace shows onboarding guidance. Browser errors: '+JSON.stringify(errors)+'; lock: '+(await page.locator('#cloud-sync-lock').allInnerTexts()).join('; '));
  assert.match(await page.locator('#cloud-manager-setup').innerText(),/مساحة عمل فارغة|بيانات الموظفين/);
  assert.equal(await page.locator('#cloud-manager-setup-restore').isDisabled(),true,'no employee import before email verification');
  assert.equal(await page.locator('#fin-backup').isHidden(),true,'legacy unencrypted backup must be unavailable in cloud workspace');
  // Manager transfer cannot proceed without an encrypted backup and owner acknowledgment.
  await page.locator('#cloud-manager-change-button').click();
  await page.locator('#cloud-manager-new-email').fill('newmanager@gmail.com');
  assert.equal(await page.locator('#cloud-manager-proceed').isDisabled(),true,'transfer must require a saved encrypted backup');
  assert.equal(await page.locator('#cloud-manager-file-saved').isDisabled(),true,'no checkbox acknowledgment before creating backup');
  await page.locator('#cloud-manager-export').click();
  await page.waitForFunction(()=>document.getElementById('cloud-manager-message')?.textContent?.includes('تم تجهيز النسخة'),null,{timeout:16000});
  assert.equal(await page.locator('#cloud-manager-file-saved').isEnabled(),true,'checkbox unlocks after backup export');
  assert.equal(await page.locator('#cloud-manager-file-saved').isChecked(),false,'no implied confirmation of saved backup');
  assert.equal(await page.locator('#cloud-manager-proceed').isDisabled(),true,'transfer must also require user confirmation');
  await page.locator('#cloud-manager-file-saved').check();
  assert.equal(await page.locator('#cloud-manager-proceed').isEnabled(),true,'transfer ready after encrypted export and user confirmation');
  await page.locator('#cloud-manager-new-email').fill('anothermanager@gmail.com');
  assert.equal(await page.locator('#cloud-manager-file-saved').isDisabled(),true,'changing target must require a new encrypted backup');
  assert.equal(await page.locator('#cloud-manager-file-saved').isChecked(),false);
  assert.equal(await page.locator('#cloud-manager-proceed').isDisabled(),true);
  await page.locator('#cloud-manager-transfer').getByRole('button',{name:'إلغاء'}).click();
  await page.locator('#cloud-security-account-button').click();
  await page.locator('#cloud-email-verified-status').waitFor();
  assert.match(await page.locator('#cloud-email-verified-status').innerText(),/لم يتم تأكيد/);
  await page.locator('#cloud-send-email-otp').click();
  await page.waitForFunction(()=>window.localStorage.getItem('neon_mock_email_otp_sent')==='yes');
  await page.locator('#cloud-verify-email-form input').fill('123456');
  await page.locator('#cloud-verify-email-form button').click();
  await page.locator('#cloud-email-verified-status').getByText('✓ تم تأكيد Gmail بنجاح.').waitFor();
  assert.equal(await page.evaluate(()=>window.localStorage.getItem('neon_mock_email_verified')),'yes');
  assert.equal(await page.locator('#cloud-manager-setup-restore').isEnabled(),true,'successful OTP unlocks guided import without reload');
  await page.locator('#cloud-account-security').getByRole('button',{name:'إغلاق'}).click();
  await page.locator('#staff-manage-cards [data-rename-staff="001"]').click();
  await page.locator('.staff-inline-rename input').fill('مشرف السحابة');
  await page.locator('.staff-inline-rename button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#cloud-control-bar span')?.textContent?.includes('متزامن'),null,{timeout:14000});
  const first=await page.evaluate(()=>JSON.parse(window.localStorage.getItem('neon_mock_row')));
  assert.equal(first.revision,1);assert.equal(JSON.parse(first.payload.RAWAA_DEMO_STAFF_V19)[0].name,'مشرف السحابة');
  const [backupDownload]=await Promise.all([
    page.waitForEvent('download',{timeout:15000}),
    page.getByRole('button',{name:'تنزيل نسخة احتياطية مشفّرة'}).click()
  ]);
  const backup=JSON.parse(fs.readFileSync(await backupDownload.path(),'utf8'));
  assert.equal(backup.format,'RAWAA_ENCRYPTED_BACKUP_V1');
  assert.equal(backup.vault.format,'RAWAA_WORK_AES256_GCM_V1');
  assert.ok(!JSON.stringify(backup).includes('مشرف السحابة'),'backup must not expose employee name in plaintext');
  const second=await context.newPage();const secondErrors=[];second.on('pageerror',e=>secondErrors.push(e.message));
  await second.goto(base+'/cloud.html',{waitUntil:'domcontentloaded'});
  await second.locator('#staff-manage-cards .staff-manage-card strong').filter({hasText:'مشرف السحابة'}).first().waitFor({timeout:15000});
  assert.equal(await second.locator('#cloud-login').count(),0,'same account loads on second device');
  await second.locator('#staff-manage-cards [data-rename-staff="001"]').click();
  await second.locator('.staff-inline-rename input').fill('مشرف النسخة الثانية');
  await second.locator('.staff-inline-rename button[type="submit"]').click();
  await second.waitForFunction(()=>JSON.parse(window.localStorage.getItem('neon_mock_row'))?.revision===2,null,{timeout:12000});
  // If there are NO unsubmitted form drafts, the old device must load
  // the newer revision automatically instead of showing a blocking popup.
  await page.getByRole('button',{name:'فحص تحديثات الأجهزة'}).click();
  await page.locator('#staff-manage-cards .staff-manage-card strong').filter({hasText:'مشرف النسخة الثانية'}).first().waitFor({timeout:16000});
  assert.equal(await page.locator('#cloud-sync-lock').count(),0,'clean device must not show a blocking conflict modal');
  // A genuinely unsubmitted form draft should remain intact and be protected.
  await page.locator('#staff-manage-cards [data-rename-staff="001"]').click();
  await page.locator('.staff-inline-rename input').fill('مسودة غير محفوظة على الهاتف');
  await second.locator('#staff-manage-cards [data-rename-staff="001"]').click();
  await second.locator('.staff-inline-rename input').fill('تحديث من الجهاز الثاني');
  await second.locator('.staff-inline-rename button[type="submit"]').click();
  await second.waitForFunction(()=>JSON.parse(window.localStorage.getItem('neon_mock_row'))?.revision===3,null,{timeout:12000});
  await page.getByRole('button',{name:'فحص تحديثات الأجهزة'}).click();
  await page.locator('#cloud-sync-lock').waitFor({timeout:15000});
  assert.match(await page.locator('#cloud-sync-lock').innerText(),/نسخة طوارئ|مسودة/);
  assert.equal(await page.locator('.staff-inline-rename input').inputValue(),'مسودة غير محفوظة على الهاتف','unfinished draft must not disappear');
  assert.equal(await page.locator('#cloud-sync-lock button').filter({hasText:'إعادة المحاولة'}).isHidden(),true,'retry must not suggest merging conflicting writes');

  // A successful handover must be based on the exact encrypted backup:
  // accidental changes after export cannot be silently carried forward.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#staff-manage-cards .staff-manage-card').first().waitFor({timeout:15000});
  await page.locator('#cloud-manager-change-button').click();
  await page.locator('#cloud-manager-new-email').fill('next-owner@gmail.com');
  const [transferDownload]=await Promise.all([
   page.waitForEvent('download',{timeout:16000}),
   page.locator('#cloud-manager-export').click()
  ]);
  assert.ok(transferDownload.suggestedFilename().endsWith('.json'),'transfer exports JSON');
  await page.locator('#cloud-manager-file-saved').check();
  assert.equal(await page.locator('#cloud-manager-proceed').isEnabled(),true,'handover enabled only with fresh encrypted export');
  await page.evaluate(()=>window.RAWAA_CLOUD_STORAGE.setItem('RAWAA_TRANSFER_TEST','changed after export'));
  await page.locator('#cloud-manager-proceed').click();
  assert.match(await page.locator('#cloud-manager-message').innerText(),/تغيّرت البيانات|نسخة مشفّرة|بيانات/);
  assert.equal(await page.locator('#cloud-login').count(),0,'stale transfer must never log the owner out');
  await page.locator('#cloud-manager-transfer').getByRole('button',{name:'إلغاء'}).click();
  await page.waitForFunction(()=>document.querySelector('#cloud-control-bar span')?.textContent?.includes('متزامن'),null,{timeout:16000});

  // Prove that a wrong transfer file is refused and that a matching
  // encrypted file is verified by reading back the server's new revision.
  const vault=backup.vault,ciphertext=Buffer.from(vault.ciphertext,'base64');
  const key=crypto.pbkdf2Sync('RAWAA-backup-passphrase-2026',Buffer.from(vault.salt,'base64'),310000,32,'sha256');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(vault.iv,'base64'));
  decipher.setAuthTag(ciphertext.subarray(-16));
  const decoded=JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString('utf8'));
  const normalized=JSON.stringify(Object.keys(decoded.entries).sort().map(k=>[k,decoded.entries[k]]));
  const correctFingerprint=crypto.createHash('sha256').update(normalized).digest('hex');
  const rowBeforeRestore=JSON.parse(await page.evaluate(()=>window.localStorage.getItem('neon_mock_row')));

  await page.evaluate(()=>sessionStorage.setItem('rawaa_manager_transfer_expected',JSON.stringify({
    email:'tester@example.com',fingerprint:'0'.repeat(64),sourceRevision:1
  })));
  const upload=page.locator('#cloud-control-bar input[type="file"]');
  await upload.setInputFiles(await backupDownload.path());
  await page.waitForFunction(()=>document.querySelector('#cloud-control-bar span')?.textContent?.includes('لا يطابق'),null,{timeout:16000});
  assert.equal(JSON.parse(await page.evaluate(()=>window.localStorage.getItem('neon_mock_row'))).revision,rowBeforeRestore.revision,'wrong backup must never replace cloud');
  await page.evaluate(hash=>sessionStorage.setItem('rawaa_manager_transfer_expected',JSON.stringify({
    email:'tester@example.com',fingerprint:hash,sourceRevision:1
  })),correctFingerprint);
  await upload.setInputFiles(await backupDownload.path());
  await page.locator('#cloud-transfer-verified').waitFor({timeout:18000});
  const restored=JSON.parse(await page.evaluate(()=>window.localStorage.getItem('neon_mock_row')));
  assert.equal(restored.revision,rowBeforeRestore.revision+1,'successful transfer advances server version');
  assert.deepEqual(restored.payload,decoded.entries,'new manager cloud data must exactly match encrypted export');
  assert.match(await page.locator('#cloud-transfer-verified').innerText(),/المدير القديم|سحب صلاحيات|إمكانية الدخول/);

  // Plan future shifts without creating attendance or payroll transactions.
  await page.locator('#planner-save').waitFor({timeout:16000});
  const beforePlan=await page.evaluate(()=>({
   attendance:window.RAWAA_CLOUD_STORAGE.getItem('RAWAA_DEMO_ATTENDANCE_V12'),
   payments:window.RAWAA_CLOUD_STORAGE.getItem('RAWAA_DEMO_LEDGER_V13')
  }));
  assert.equal(await page.evaluate(()=>window.RAWAA_PLANNER_TEST.getPlans().length),0,'no automatic plan seeding');
  await page.locator('#planner-day').fill('2026-10-27');
  await page.locator('#planner-start').fill('20:00');
  await page.locator('#planner-end').fill('06:00');
  await page.locator('#planner-next-day').check();
  await page.locator('#planner-save').click();
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===1);
  assert.equal(await page.evaluate(()=>window.RAWAA_PLANNER_TEST.interval(window.RAWAA_PLANNER_TEST.getPlans()[0]).minutes),600);
  await page.locator('#planner-day').fill('2026-10-28');
  await page.locator('#planner-start').fill('05:00');
  await page.locator('#planner-end').fill('08:00');
  await page.locator('#planner-save').click();
  assert.match(await page.locator('#planner-feedback').innerText(),/متداخلتان/);
  assert.equal(await page.evaluate(()=>window.RAWAA_PLANNER_TEST.getPlans().length),1);
  await page.locator('#planner-start').fill('07:00');
  await page.locator('#planner-end').fill('11:00');
  await page.locator('#planner-save').click();
  await page.waitForFunction(()=>window.RAWAA_PLANNER_TEST.getPlans().length===2);
  await page.locator('#planner-week-start').fill('2026-10-27');
  const planned=await page.evaluate(()=>window.RAWAA_PLANNER_TEST.report().stats);
  assert.equal(planned.plans,2);assert.equal(planned.plannedHours,14);
  assert.equal(planned.plannedWithoutRecord,2);
  const afterPlan=await page.evaluate(()=>({
   attendance:window.RAWAA_CLOUD_STORAGE.getItem('RAWAA_DEMO_ATTENDANCE_V12'),
   payments:window.RAWAA_CLOUD_STORAGE.getItem('RAWAA_DEMO_LEDGER_V13')
  }));
  assert.deepEqual(afterPlan,beforePlan,'planning must not alter payroll or attendance');
  const [planCSV]=await Promise.all([page.waitForEvent('download',{timeout:14000}),page.locator('#planner-export').click()]);
  assert.match(planCSV.suggestedFilename(),/RAWAA_Shift_Plan_2026-10-27/);
  await page.waitForFunction(expected=>JSON.parse(window.localStorage.getItem('neon_mock_row'))?.revision>expected,rowBeforeRestore.revision+1,{timeout:18000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.RAWAA_PLANNER_TEST?.getPlans==='function',null,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.RAWAA_PLANNER_TEST.getPlans().length),2,'plans must survive cloud reload');

  // Reproduce the user's iPhone-sized view: no giant checkbox or horizontal overflow.
  const phone=await browser.newContext({viewport:{width:375,height:667},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await phone.addInitScript(()=>{
    const native=window.localStorage;
    native.setItem('neon_mock_session','yes');
    if(!native.getItem('neon_mock_row'))native.setItem('neon_mock_row',JSON.stringify({owner_id:'uuid-example-user-1',revision:1,payload:{}}));
    window.__fakeCloudClient={
      auth:{getSession:async()=>({data:{session:{id:'sess-iphone'},user:{id:'uuid-example-user-1',email:'tester@example.com',emailVerified:false}},error:null})},
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:JSON.parse(native.getItem('neon_mock_row')),error:null})})})})
    };
  });
  await phone.route('https://esm.sh/**',route=>route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:'export const createClient = ()=>window.__fakeCloudClient;'}));
  const phonePage=await phone.newPage();
  await phonePage.goto(base+'/cloud.html',{waitUntil:'domcontentloaded'});
  await phonePage.locator('#cloud-manager-change-button').click();
  const metrics=await phonePage.evaluate(()=>{
    const overlay=document.getElementById('cloud-manager-transfer'),dialog=overlay.querySelector('.rawaa-cloud-dialog'),check=overlay.querySelector('#cloud-manager-file-saved');
    return {width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
      box:dialog.getBoundingClientRect().width,checkbox:check.getBoundingClientRect().width,
      isDisabled:check.disabled,overflow:overlay.scrollWidth>overlay.clientWidth+1};
  });
  assert.equal(metrics.isDisabled,true);
  assert.ok(metrics.checkbox>=18&&metrics.checkbox<=30,'checkbox stays normal size on iPhone: '+JSON.stringify(metrics));
  assert.ok(metrics.box<=metrics.width,'dialog fits viewport: '+JSON.stringify(metrics));
  assert.equal(metrics.overflow,false,'overlay has no horizontal overflow');
  await phone.close();

  // The secure gateway closed first-party signups. A pending handover
  // must show the existing Gmail login, never a misleading create-account button.
  const secureContext=await browser.newContext();
  await secureContext.addInitScript(()=>{
    window.RAWAA_FIRST_PARTY_AUTH=true;
    sessionStorage.setItem('rawaa_manager_transfer_target','asdfqweml09@gmail.com');
    window.__fakeCloudClient={
      auth:{getSession:async()=>({data:{user:null,session:null},error:null})}
    };
  });
  await secureContext.route('https://esm.sh/**',route=>route.fulfill({
    status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
    body:'export const createClient = ()=>window.__fakeCloudClient;'
  }));
  const securePage=await secureContext.newPage();
  await securePage.goto(base+'/cloud.html',{waitUntil:'domcontentloaded'});
  await securePage.locator('#cloud-login').waitFor({timeout:16000});
  assert.equal(await securePage.locator('#cloud-login button').filter({hasText:'إنشاء حساب لأول مرة'}).isHidden(),true,'no signup on secure gateway');
  assert.equal(await securePage.locator('#cloud-login input[type="email"]').inputValue(),'asdfqweml09@gmail.com');
  assert.equal(await securePage.locator('#cloud-login input[type="email"]').getAttribute('readonly'),'','new manager target is prefilled');
  assert.match(await securePage.locator('#cloud-login').innerText(),/تم تسجيل حساب Gmail الجديد|سجّل الدخول/);
  await securePage.locator('#cloud-login-switch-account').click();
  assert.equal(await securePage.locator('#cloud-login input[type="email"]').inputValue(),'');
  assert.equal(await securePage.locator('#cloud-login input[type="email"]').getAttribute('readonly'),null);
  assert.equal(await securePage.evaluate(()=>sessionStorage.getItem('rawaa_manager_transfer_target')),null,'switching account clears only tab-local pending address');
  await secureContext.close();

  assert.deepEqual(errors,[],errors.join('; '));assert.deepEqual(secondErrors,[],secondErrors.join('; '));
  console.log('PASS: account, OTP, safe multi-device cloud, encrypted backup, stale transfer protection, mismatch refusal and verified read-back');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
