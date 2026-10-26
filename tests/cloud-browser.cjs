/* Test multi-device cloud bridge with a deterministic fake Neon client, then
   check live Neon SDK module loads. node tests/cloud-browser.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
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
    const getSession=()=>native.getItem('neon_mock_session')==='yes'?{data:{session:{id:'sess-1'},user:{id:'uuid-example-user-1',email:'tester@example.com'}},error:null}:{data:{session:null,user:null},error:null};
    window.__fakeCloudClient={
      auth:{
        getSession:async()=>getSession(),
        signUp:{email:async()=>{native.setItem('neon_mock_session','yes');return {data:{user:{id:'uuid-example-user-1'}}};}},
        signIn:{email:async()=>{native.setItem('neon_mock_session','yes');return {data:{user:{id:'uuid-example-user-1'}}};}},
        signOut:async()=>{native.removeItem('neon_mock_session');return {error:null}}
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
  assert.equal(await page.locator('#fin-backup').isHidden(),true,'legacy unencrypted backup must be unavailable in cloud workspace');
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
  await page.getByRole('button',{name:'فحص تحديثات الأجهزة'}).click();
  await page.locator('#cloud-sync-lock').waitFor({timeout:15000});
  assert.match(await page.locator('#cloud-sync-lock').innerText(),/تحديث|تغييرات/);
  assert.deepEqual(errors,[],errors.join('; '));assert.deepEqual(secondErrors,[],secondErrors.join('; '));
  console.log('PASS: account gate, cloud write/revision, synced name on second browser tab, no page errors (mock Neon)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
