/* RAWAA 2.31 tests: month-end snapshots, drift, audit trail, safe restart. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('monthly-close.js','utf8');
const store=new Map();
let mutations=[];
const localStorage={
 getItem:k=>store.has(k)?store.get(k):null,
 setItem(k,v){mutations.push(k);store.set(k,v);}
};
const shifts=[
 {id:'adel-2026',employeeId:'adel',date:'2026-11-04',start:'17:00',end:'02:00',nextDay:true,rate:10,overtimeFactor:1.5,note:''},
 {id:'chef-2026',employeeId:'chef',date:'2026-11-04',start:'17:00',end:'02:00',nextDay:true,rate:10,overtimeFactor:1.5,note:''}
];
const tx=[{id:'withdraw',employeeId:'adel',date:'2026-11-05',type:'withdrawal',amount:20,note:'test'}];
const staff=[
 {id:'adel',name:'عادل',role:'سيرفس',rate:10,status:'active'},
 {id:'chef',name:'وجدي',role:'الشيف الرئيسي',rate:10,status:'active',headChef:true}
];
let artificialMismatch=false;
const currentFactor=p=>p.headChef?1.5:1;
function audit(month){
 const rows=staff.map(p=>{
  const own=shifts.filter(x=>x.employeeId===p.id&&x.date.startsWith(month));
  let hours=own.length?9:0;
  const gross=own.reduce((n,r)=>n+80+10*currentFactor(p),0);
  const withdrawn=tx.filter(x=>x.employeeId===p.id&&x.type==='withdrawal'&&x.date.startsWith(month)).reduce((n,r)=>n+r.amount,0);
  const paid=tx.filter(x=>x.employeeId===p.id&&x.type==='payment'&&x.date.startsWith(month)).reduce((n,r)=>n+r.amount,0);
  return {id:p.id,name:p.name,shifts:own.length,basic:own.length*8,extra:own.length,gross,expectedGross:gross,systemGross:gross,withdrawals:withdrawn,paid,remaining:gross-withdrawn-paid,rateFactor:currentFactor(p),issues:[],reviews:[]};
 });
 return {invalidMonth:false,rows,issues:artificialMismatch?1:0,reviews:0,
  expectedGross:rows.reduce((n,r)=>n+r.expectedGross,0)};
}
const context={window:{
 RAWAA_ATTENDANCE_BRIDGE:{getEntries:()=>shifts},
 RAWAA_FINANCE_TEST:{getTransactions:()=>tx},
 RAWAA_STAFF:{getAll:()=>staff,currentFactor},
 RAWAA_PAYROLL_AUDIT:{audit},
 RAWAA_CLOUD_WORKSPACE:{actorEmail:'manager@example.com'},
 RAWAA_RESTAURANT_TODAY:()=> '2026-11-05'
 },localStorage,document:{getElementById:()=>null},crypto:webcrypto,TextEncoder,Date,console};
vm.createContext(context);vm.runInContext(source,context);
const manager=context.window.RAWAA_MONTH_CLOSE;
(async()=>{
 assert.ok(manager);
 let view=await manager.inspect('2026-11');assert.equal(view.status,'open');assert.equal(view.latest,null);
 await assert.rejects(manager.close('2026-11',false),/الموافقة الصريحة/);
 assert.throws(()=>manager.reopen('2026-11','مراجعة لاحقة ضرورية',true),/ليس في حالة إقفال/);
 let created=await manager.close('2026-11',true,'مراجعة قبل الصرف');
 assert.equal(created.version,1);assert.equal(created.summary.gross,185);assert.equal(created.summary.remaining,165);
 assert.equal(created.actor,'manager@example.com');assert.equal(created.rows.length,2);
 assert.equal(created.rows.find(x=>x.name==='عادل').gross,90);
 assert.equal(created.rows.find(x=>x.name==='وجدي').gross,95);
 assert.deepEqual(mutations,['RAWAA_MONTHLY_CLOSINGS_V1'],'only monthly-close key is ever mutated');
 view=await manager.inspect('2026-11');assert.equal(view.status,'closed');assert.equal(view.hasChanges,false);
 await assert.rejects(manager.close('2026-11',true),/مغلق بالفعل/);
 // A corrected shift/time or added payment must not change the approved snapshot.
 shifts[0].start='18:00';
 view=await manager.inspect('2026-11');assert.equal(view.hasChanges,true);
 assert.equal(view.latest.summary.gross,185);
 assert.equal(view.versions,1);
 assert.throws(()=>manager.reopen('2026-11','قصير',true),/8 أحرف/);
 assert.equal(manager.reopen('2026-11','تصحيح ساعات عادل ومراجعتها',true),true);
 const newVersion=await manager.close('2026-11',true,'اعتماد جديد بعد التصحيح');
 assert.equal(newVersion.version,2);
 const history=manager.read();assert.equal(history.months['2026-11'].snapshots.length,2);
 assert.equal(history.months['2026-11'].snapshots[0].summary.gross,185);
 assert.equal(history.events.map(x=>x.type).join(','),'close,reopen,close');
 assert.equal(history.events[1].reason,'تصحيح ساعات عادل ومراجعتها');
 // A formula discrepancy must block closing even after reopening.
 manager.reopen('2026-11','مراجعة الخطأ الحسابي',true);
 artificialMismatch=true;
 await assert.rejects(manager.close('2026-11',true),/اختلاف حسابي/);
 assert.equal(manager.read().events.filter(e=>e.type==='close').length,2);
 // Malformed storage cannot be silently replaced.
 const original=store.get('RAWAA_MONTHLY_CLOSINGS_V1');
 store.set('RAWAA_MONTHLY_CLOSINGS_V1','{invalid');
 assert.throws(()=>manager.read(),/غير قابل للقراءة/);
 store.set('RAWAA_MONTHLY_CLOSINGS_V1',original);
 assert.equal(manager.read().months['2026-11'].snapshots.length,2);
 console.log('PASS: RAWAA 2.31 approval, fixed snapshots, audit trail, mismatch lock, reopen/reclose, old records untouched and corrupt-storage safety');
})().catch(e=>{console.error(e);process.exitCode=1});