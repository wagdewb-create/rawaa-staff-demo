/* RAWAA 2.30 independent read-only payroll audit unit tests. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('payroll-audit.js','utf8');
const rows=[
 {id:'adel',employeeId:'adel-service',date:'2026-11-04',start:'17:00',end:'02:00',nextDay:true,rate:10,overtimeFactor:1.5},
 {id:'wagdi',employeeId:'chef-wagdi',date:'2026-11-04',start:'17:00',end:'02:00',nextDay:true,rate:10,overtimeFactor:1.5}
];
const people=[
 {id:'adel-service',name:'عادل',role:'سيرفس',rate:10,overtimeFactor:1},
 {id:'chef-wagdi',name:'وجدي',role:'الشيف الرئيسي',rate:10,headChef:true,overtimeFactor:1.5}
];
let computed=[
 {...rows[0],duration:9,normal:8,extra:1,extraFactor:1,wage:90},
 {...rows[1],duration:9,normal:8,extra:1,extraFactor:1.5,wage:95}
];
const transactions=[{id:'withdraw',employeeId:'adel-service',type:'withdrawal',date:'2026-11-05',amount:20}];
function sumMonthly(id,month){
 const shifts=computed.filter(x=>x.employeeId===id&&x.date.startsWith(month));
 const tx=transactions.filter(x=>x.employeeId===id&&x.date.startsWith(month));
 const gross=shifts.reduce((sum,r)=>sum+r.wage,0);
 const withdrawals=tx.filter(x=>x.type==='withdrawal').reduce((sum,r)=>sum+r.amount,0);
 const paid=tx.filter(x=>x.type==='payment').reduce((sum,r)=>sum+r.amount,0);
 return {normal:shifts.reduce((n,r)=>n+r.normal,0),extra:shifts.reduce((n,r)=>n+r.extra,0),gross,withdrawals,paid,remaining:gross-withdrawals-paid};
}
const ctx={
  window:{
    RAWAA_ATTENDANCE_BRIDGE:{getEntries:()=>rows.map(x=>({...x})),getCalculated:()=>computed.map(x=>({...x}))},
    RAWAA_FINANCE_TEST:{sumMonthly,getTransactions:()=>transactions.map(x=>({...x}))},
    RAWAA_STAFF:{getAll:()=>people.map(x=>({...x})),currentFactor:p=>p.headChef?1.5:1}
  },
  document:{getElementById:()=>null}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
const audit=ctx.window.RAWAA_PAYROLL_AUDIT.audit;
assert.equal(typeof audit,'function');
let result=audit('2026-11','all');
assert.equal(result.invalidMonth,false);
assert.equal(result.expectedGross,185);
assert.equal(result.systemGross,185);
assert.equal(result.issues,0);
assert.equal(result.rows.find(x=>x.name==='عادل').expectedGross,90);
assert.equal(result.rows.find(x=>x.name==='وجدي').expectedGross,95);
assert.equal(result.rows.find(x=>x.name==='عادل').remaining,70);
assert.ok(result.reviews>0,'historic multiplier mismatch is surfaced for review');
assert.deepEqual(rows.map(x=>x.rate),[10,10],'audit never mutates source records');
computed=[{...computed[0],wage:95},computed[1]];
result=audit('2026-11','all');
assert.equal(result.expectedGross,185);
assert.equal(result.systemGross,190);
assert.equal(result.rows.find(x=>x.name==='عادل').difference,-5);
assert.ok(result.issues>=2,'shift and monthly mismatch both detected');
result=audit('2026-11','chef-wagdi');
assert.equal(result.rows.length,1);
assert.equal(result.rows[0].expectedGross,95);
assert.equal(audit('2026-13').invalidMonth,true);
console.log('PASS: independent payroll math, 9-hour night shift, Wagdi exception, stale factor, overpayment, mismatch detection, read-only audit and filtering');