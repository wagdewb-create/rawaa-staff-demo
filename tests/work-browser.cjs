/* Browser smoke test. Run: node tests/work-browser.cjs (requires playwright + Chromium). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const candidate=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(candidate!==root&&!candidate.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const file=fs.readFileSync(candidate);
  res.writeHead(200,{'Content-Type':mime[path.extname(candidate)]||'application/octet-stream','Cache-Control':'no-store'});res.end(file);
 }catch(error){res.writeHead(404);res.end('Not found');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port,base='http://127.0.0.1:'+port;
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/work.html',{waitUntil:'load'});
  await page.locator('#work-login-overlay').waitFor({timeout:12000});
  assert.equal(await page.evaluate(()=>typeof window.RAWAA_STAFF),'undefined','employee application must not start before unlocking');
  const password='correct-horse-private-2026';
  await page.locator('#work-login-overlay input[type="password"]').nth(0).fill(password);
  await page.locator('#work-login-overlay input[type="password"]').nth(1).fill(password);
  await page.getByRole('button',{name:'تشفير مساحة العمل وفتحها'}).click();
  await page.locator('#staff-manage-cards .staff-manage-card').first().waitFor({timeout:30000});
  const rename=page.locator('#staff-manage-cards [data-rename-staff="001"]');
  await rename.click();
  await page.locator('.staff-inline-rename input').fill('موظف اختبار المشفر');
  await page.locator('.staff-inline-rename button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#work-control-bar span')?.textContent?.includes('تم حفظ البيانات مشفرة'),null,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.localStorage.getItem('RAWAA_DEMO_STAFF_V19')),null,'unencrypted browser localStorage must remain empty');
  const persisted=await page.evaluate(async()=>{
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('RAWAA_Work_Encrypted_v1');
      request.onsuccess=()=>{const tx=request.result.transaction('vaults','readonly');const get=tx.objectStore('vaults').get('main');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};
      request.onerror=()=>reject(request.error);
    });
  });
  assert.equal(persisted.format,'RAWAA_WORK_AES256_GCM_V1');
  assert.ok(!JSON.stringify(persisted).includes('موظف اختبار المشفر'),'plaintext name must not be stored in IndexedDB');
  await page.reload({waitUntil:'load'});
  await page.locator('#work-login-overlay').waitFor();
  assert.equal(await page.locator('#work-login-overlay input[type="password"]').count(),1,'existing workspace should ask for a password');
  await page.locator('#work-login-overlay input[type="password"]').fill(password);
  await page.getByRole('button',{name:'فتح السجلات'}).click();
  await page.getByText('موظف اختبار المشفر',{exact:true}).first().waitFor({timeout:30000});
  assert.deepEqual(errors,[], 'browser errors should be empty: '+errors.join('; '));
  console.log('PASS: work gate, first-time password, existing app startup, staff rename, AES-GCM at rest, reload unlock');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
