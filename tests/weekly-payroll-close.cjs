'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const c=require('../weekly-payroll-core.js');
const people=[
 {id:'a',name:'عادل',rate:13,status:'active'},
 {id:'b',name:'وجدي',rate:17,status:'active'}
];
const shifts=[
 {id:'s1',employeeId:'a',date:'2026-11-18',start:'09:00',end:'17:00',nextDay:false,rate:13},
 {id:'s2',employeeId:'b',date:'2026-11-24',start:'09:00',end:'19:00',nextDay:false,rate:17},
 {id:'s3',employeeId:'a',date:'2026-11-25',start:'09:00',end:'17:00',nextDay:false,rate:13}
];
const calc=shifts.map(s=>({...s,wage:s.id==='s1'?104:s.id==='s2'?187:104}));
const tx=[
 {id:'t1',employeeId:'a',type:'withdrawal',date:'2026-11-19',amount:20,note:''},
 {id:'t2',employeeId:'b',type:'payment',date:'2026-11-21',amount:37,note:''},
 {id:'t3',employeeId:'a',type:'withdrawal',date:'2026-11-25',amount:10,note:''}
];
const initial=c.readState(null,'2026-11-18');
const args={state:initial,staff:people,attendance:shifts,calculated:calc,transactions:tx,
 actor:'مدير رواء',today:'2026-11-25',paidOn:'2026-11-25',confirmed:true};
const preview=c.inspect({...args,start:initial.nextStart});
assert.equal(preview.end,'2026-11-24');
assert.equal(preview.rows.find(r=>r.id==='a').remaining,84);
assert.equal(preview.rows.find(r=>r.id==='b').remaining,150);
assert.equal(preview.totals.due,234);
assert.equal(preview.attendance.length,2);
assert.equal(preview.laterAttendance.length,1);
assert.equal(preview.laterTransactions.length,1);
assert.throws(()=>c.plan({...args,today:'2026-11-24'}),/لم تكتمل/);
assert.throws(()=>c.plan({...args,confirmed:false}),/تأكيد/);
assert.throws(()=>c.plan({...args,paidOn:'2026-11-26'}),/تاريخ الدفع/);
const built=c.plan(args);
assert.equal(built.payments.length,2);
assert.equal(built.payments.reduce((t,p)=>t+p.amount,0),234);
assert.equal(built.next.nextStart,'2026-11-25');
assert.equal(built.remainingAttendance[0].id,'s3');
assert.equal(built.remainingTransactions[0].id,'t3');
assert.equal(built.record.attendance.length,2);
assert.equal(built.record.transactions.length,4);
assert.equal(built.record.rows[0].paidAtClose,84);
assert.equal(built.record.rows[1].paidAtClose,150);
assert.equal(c.readState(JSON.stringify(built.next),'2026-11-18').weeks.length,1);
const nextPeriod=c.inspect({start:built.next.nextStart,staff:people,attendance:built.remainingAttendance,
 calculated:calc,transactions:built.remainingTransactions});
assert.equal(nextPeriod.totals.due,94);
const negative=[...tx,{id:'t4',employeeId:'b',date:'2026-11-22',type:'payment',amount:1000,note:''}];
assert.deepEqual(c.inspect({...args,start:initial.nextStart,transactions:negative}).overpaid,['وجدي']);
assert.throws(()=>c.plan({...args,transactions:negative}),/أكثر من المستحق/);
assert.throws(()=>c.inspect({...args,start:'2026-11-19'}),/أقدم/);
assert.throws(()=>c.readState('{','2026-11-18'),/تالف/);
assert.equal(c.add('2026-12-29',6),'2027-01-04');
assert.ok(fs.readFileSync('cloud.html','utf8').includes('weekly-payroll-close.js?v=233'));
assert.ok(fs.readFileSync('server.js','utf8').includes('weekly-payroll-close.js'));
assert.ok(fs.readFileSync('service-worker.js','utf8').includes('weekly-payroll-close.js?v=233'));
console.log('Weekly payroll close: 7-day boundaries, payments, archive, retained future shifts, and guards passed.');
