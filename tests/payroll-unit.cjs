const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script);
const functions=['minutes','dateMs','rowBounds','calcMinutes','enrich','sumMonthly'].map(name=>html.split('\n').find(l=>l.startsWith('function '+name+'('))).join('\n');
const row=(id,date,start,end,nextDay,rate)=>({id,employeeId:'001',date,start,end,nextDay,rate,note:''});
const records=[row('a','2026-10-20','08:00','12:00',false,20),row('b','2026-10-20','13:00','19:00',false,22),row('c','2026-10-31','20:00','06:00',true,20)];
class Element{constructor(){this.value='';this.children=[];this.hidden=false;this.events={};}append(...v){this.children.push(...v)}replaceChildren(...v){this.children=v}addEventListener(n,f){this.events[n]=f}set textContent(v){this.text=v}get textContent(){return this.text}get options(){return this.children}}
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
el('payslip-month').value='2026-10';el('payslip-employee').value='001';
const context={console,document:{getElementById:el,createElement:()=>new Element(),addEventListener(){}},window:{},records,transactions:[{employeeId:'001',date:'2026-10-22',type:'withdrawal',amount:50},{employeeId:'001',date:'2026-10-23',type:'payment',amount:100}]};
vm.createContext(context);vm.runInContext(functions+`;bridge={getCalculated:()=>enrich(records)};window.RAWAA_ATTENDANCE_BRIDGE=bridge;window.RAWAA_FINANCE_TEST={getTransactions:()=>transactions,sumMonthly};window.RAWAA_STAFF={getAll:()=>[{id:'001',name:'Test'}]};`,context);
const last=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];vm.runInContext(last,context);
let data=context.window.RAWAA_PAYSLIP_TEST.data();assert.equal(data.sums.normal,16);assert.equal(data.sums.extra,4);assert.equal(data.basePay,328);assert.equal(data.overtimePay,126);assert.equal(data.sums.gross,454);assert.equal(data.sums.remaining,304);
el('payslip-month').value='';context.window.RAWAA_PAYSLIP_TEST.render();assert.equal(el('payslip-document').hidden,true);assert.equal(el('payslip-print').disabled,true);
el('payslip-month').value='2026-11';context.window.RAWAA_PAYSLIP_TEST.render();assert.equal(context.window.RAWAA_PAYSLIP_TEST.data().sums.gross,0);assert.equal(el('payslip-document').hidden,false);
el('payslip-month').value='2026-10';context.window.RAWAA_PAYSLIP_TEST.render();assert.equal(context.window.RAWAA_PAYSLIP_TEST.data().sums.gross,454);
assert.ok(fs.readFileSync('service-worker.js','utf8').includes("'./staff.css'"));
console.log('PASS: script syntax, split-day overtime, historical rates, overnight month allocation, withdrawals/payments, invalid month clearing, empty month and recovery, offline CSS manifest');
