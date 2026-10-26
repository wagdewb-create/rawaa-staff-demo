const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});
  const network=[];
  page.on('requestfailed',req=>network.push(req.url()+' '+(req.failure()?.errorText||'')));
  await page.goto('https://rawaa-staff-demo.onrender.com/cloud.html?probe=live-sdk-20261026',{waitUntil:'domcontentloaded',timeout:45000});
  const shown=await Promise.race([
   page.locator('#cloud-login').waitFor({state:'visible',timeout:30000}).then(()=> 'login'),
   page.locator('.rawaa-cloud-dialog').getByText('تعذر فتح السحابة',{exact:true}).waitFor({state:'visible',timeout:30000}).then(()=> 'error')
  ]);
  if(shown!=='login'){
   const message=await page.locator('.rawaa-cloud-overlay .rawaa-cloud-dialog').last().innerText();
   throw Error('Real Neon SDK did not initialize login: '+message+' NETWORK '+network.join('; ').slice(0,750));
  }
  if(!await page.locator('#cloud-login input[type="email"]').isVisible())throw Error('Email login missing');
  console.log('PASS: public Render URL loads live Neon SDK and shows account login screen');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});