const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.RAWAA_TEST_URL||'http://127.0.0.1:8765');
await page.evaluate(()=>{
const row=(id,date,start,end,nextDay,rate)=>({id,employeeId:'001',date,start,end,nextDay,rate,note:''});
window.RAWAA_ATTENDANCE_BRIDGE.replaceImported([
row('a','2026-10-20','08:00','12:00',false,20),row('b','2026-10-20','13:00','19:00',false,22),row('c','2026-10-31','20:00','06:00',true,20)]);
document.getElementById('payslip-month').value='2026-10';document.getElementById('payslip-employee').value='001';window.RAWAA_PAYSLIP_TEST.render();});
const result=await page.evaluate(()=>window.RAWAA_PAYSLIP_TEST.data());assert.equal(result.sums.normal,16);assert.equal(result.sums.extra,4);assert.equal(result.basePay,328);assert.equal(result.overtimePay,126);assert.equal(result.sums.gross,454);assert.deepEqual(result.rates,[20,22]);
assert.equal(await page.locator('#payslip-print').isEnabled(),true);
await page.locator('#payslip-month').fill('');await page.locator('#payslip-month').dispatchEvent('change');assert.equal(await page.locator('#payslip-document').isVisible(),false);assert.equal(await page.locator('#payslip-print').isEnabled(),false);
await page.locator('#payslip-month').fill('2026-11');await page.locator('#payslip-month').dispatchEvent('change');assert.equal(await page.evaluate(()=>window.RAWAA_PAYSLIP_TEST.data().sums.gross),0);
await page.locator('#payslip-month').fill('2026-10');await page.locator('#payslip-month').dispatchEvent('change');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.emulateMedia({media:'print'});assert.equal(await page.locator('#payslip .tablewrap').first().evaluate(el=>getComputedStyle(el).overflow),'visible');
await page.emulateMedia({media:'screen'});
await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.evaluate(()=>navigator.serviceWorker.ready);await page.context().setOffline(true);await page.reload();assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.staff-manage-grid')).display),'grid');assert.equal(await page.evaluate(()=>typeof window.RAWAA_PAYSLIP_TEST.render),'function');
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: split shifts, changing rates, midnight/month boundary, invalid and empty periods, mobile width, print layout, offline CSS and startup');})().catch(e=>{console.error(e);process.exit(1)});
