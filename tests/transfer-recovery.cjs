/* Regression for iPhone Safari download succeeded, then cloud fetch failed.
   No real credentials, employee data, or network access are used. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8'};
const server=http.createServer((req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    const file=path.resolve(root,'.'+url.pathname);
    if(!file.startsWith(root+path.sep))throw Error('unsafe');
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
    res.end(fs.readFileSync(file));
  }catch(_){res.writeHead(404);res.end('not found');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:375,height:812},deviceScaleFactor:3});
  const base='http://127.0.0.1:'+server.address().port;
  await context.addInitScript(()=>{
    const data=window.localStorage;
    const read=()=>JSON.parse(data.getItem('mock_cloud_row')||'null');
    if(!read())data.setItem('mock_cloud_row',JSON.stringify({owner_id:'test-user-id',revision:5,payload:{}}));
    window.__fakeCloudClient={
     auth:{getSession:async()=>({data:{user:{id:'test-user-id',email:'oldmanager@example.com',emailVerified:false},session:{id:'test-session'}},error:null}),signOut:async()=>({error:null})},
     from:()=>({
      select:()=>({eq:()=>({maybeSingle:async()=>{
       const left=Number(data.getItem('mock_reads_before_failure')||0);
       if(left){
        data.setItem('mock_reads_before_failure',String(left-1));
        if(left===1)throw new TypeError('Load failed');
       }
       return {data:read(),error:null};
      }})}),
      insert:values=>({select:()=>({single:async()=>({data:values,error:null})})})
     })
    };
  });
  await context.route('https://esm.sh/**',route=>route.fulfill({
   status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},
   body:'export const createClient = ()=>window.__fakeCloudClient;'
  }));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.type()==='prompt'?d.accept('safe-backup-passphrase-2026'):d.accept());
  await page.goto(base+'/cloud.html',{waitUntil:'domcontentloaded'});
  await page.locator('#cloud-manager-change-button').waitFor({timeout:16000});
  await page.locator('#cloud-manager-change-button').click();
  await page.locator('#cloud-manager-new-email').fill('newmanager@gmail.com');
  await page.evaluate(()=>window.localStorage.setItem('mock_reads_before_failure','2'));
  const [file]=await Promise.all([
   page.waitForEvent('download',{timeout:16000}),
   page.locator('#cloud-manager-export').click()
  ]);
  assert.match(file.suggestedFilename(),/^RAWAA_Manager_Transfer_.*\.json$/);
  const saved=JSON.parse(fs.readFileSync(await file.path(),'utf8'));
  assert.equal(saved.format,'RAWAA_ENCRYPTED_BACKUP_V1');
  assert.equal(saved.vault.format,'RAWAA_WORK_AES256_GCM_V1');
  await page.waitForFunction(()=>document.getElementById('cloud-manager-message')?.textContent?.includes('Load failed'),null,{timeout:16000});
  const message=await page.locator('#cloud-manager-message').innerText();
  assert.match(message,/لم تُحذف|تعذّر اعتمادها/);
  assert.doesNotMatch(message,/تعذّر إنشاء النسخة/);
  assert.equal(await page.locator('#cloud-manager-file-saved').isEnabled(),true);
  assert.equal(await page.locator('#cloud-manager-proceed').isDisabled(),true);
  assert.equal(await page.locator('#cloud-manager-retry-cloud').isVisible(),true);
  await page.locator('#cloud-manager-retry-cloud').click();
  await page.waitForFunction(()=>document.getElementById('cloud-manager-message')?.textContent?.includes('تم التحقق من النسخة'),null,{timeout:16000});
  assert.equal(await page.locator('#cloud-manager-file-saved').isChecked(),false);
  await page.locator('#cloud-manager-file-saved').check();
  assert.equal(await page.locator('#cloud-manager-proceed').isEnabled(),true);
  // No second encrypted export is required after reloading the modal.
  await page.locator('#cloud-manager-transfer').getByRole('button',{name:'إلغاء'}).click();
  await page.locator('#cloud-manager-change-button').click();
  await page.locator('#cloud-manager-new-email').fill('newmanager@gmail.com');
  await page.locator('#cloud-manager-existing-input').setInputFiles(await file.path());
  await page.waitForFunction(()=>document.getElementById('cloud-manager-message')?.textContent?.includes('تم التحقق من النسخة'),null,{timeout:18000});
  await page.locator('#cloud-manager-file-saved').check();
  assert.equal(await page.locator('#cloud-manager-proceed').isEnabled(),true);
  await page.locator('#cloud-manager-new-email').fill('different@gmail.com');
  assert.equal(await page.locator('#cloud-manager-proceed').isDisabled(),true);
  assert.equal(await page.locator('#cloud-manager-file-saved').isDisabled(),true);
  assert.equal(await page.locator('#cloud-manager-file-saved').isChecked(),false);
  const metrics=await page.evaluate(()=>{
   const el=document.querySelector('#cloud-manager-transfer');
   const box=el.querySelector('.rawaa-cloud-dialog');
   return {width:el.clientWidth,scroll:el.scrollWidth,box:box.getBoundingClientRect().width};
  });
  assert.ok(metrics.scroll<=metrics.width+1,'No iPhone horizontal overflow: '+JSON.stringify(metrics));
  assert.ok(metrics.box<=metrics.width,'Dialog fits iPhone: '+JSON.stringify(metrics));
  assert.deepEqual(errors,[]);
  console.log('PASS: Safari encrypted transfer succeeds locally after fetch error, retries and reuses existing file safely');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
