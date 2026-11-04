/* RAWAA Cloud 2.30 — independent, read-only monthly payroll reconciliation.
 * This module NEVER changes attendance, payroll, finance entries, storage, or login.
 * Comparison detects calculation drift; it does not certify wage-law compliance.
 */
(function(){
'use strict';
const A=window.RAWAA_ATTENDANCE_BRIDGE;
const F=window.RAWAA_FINANCE_TEST;
const S=window.RAWAA_STAFF;
if(!A||!F||!S)return;
const cents=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.011;
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const validMonth=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const timeMinutes=s=>{
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s||''))return NaN;
 return Number(s.slice(0,2))*60+Number(s.slice(3,5));
};
const bounds=r=>{
 const y=Number(String(r.date||'').slice(0,4)),m=Number(String(r.date||'').slice(5,7)),d=Number(String(r.date||'').slice(8,10));
 const t1=timeMinutes(r.start),t2=timeMinutes(r.end);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||!Number.isFinite(t1)||!Number.isFinite(t2))return [NaN,NaN];
 const midnight=Date.UTC(y,m-1,d),check=new Date(midnight);
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return [NaN,NaN];
 return [midnight+t1*60000,midnight+t2*60000+(r.nextDay===true?86400000:0)];
};
const note=(list,msg)=>{if(!list.includes(msg))list.push(msg);};
function audit(month,filter='all'){
 if(!validMonth(month))return {month,rows:[],issues:0,reviews:0,expectedGross:0,systemGross:0,invalidMonth:true};
 const staff=S.getAll(),people=staff.filter(p=>filter==='all'||p.id===filter);
 const byId=new Map(staff.map(p=>[p.id,p]));
 const calculated=A.getCalculated(),calculatedById=new Map(calculated.map(r=>[r.id,r]));
 const transactions=F.getTransactions();
 const candidates=A.getEntries().slice().sort((a,b)=>{
  const x=bounds(a)[0],y=bounds(b)[0];
  return (Number.isFinite(x)?x:0)-(Number.isFinite(y)?y:0)||String(a.id).localeCompare(String(b.id));
 });
 const byEmployee=new Map();
 const accrued=new Map(),rates=new Map(),flags=new Map(),reviews=new Map();
 for(const p of people){
  byEmployee.set(p.id,[]);
  accrued.set(p.id,{normal:0,extra:0,gross:0});
  rates.set(p.id,new Set());flags.set(p.id,[]);reviews.set(p.id,[]);
 }
 const used=new Map();
 for(const r of candidates){
  const [start,end]=bounds(r),duration=(end-start)/3600000,day=r.employeeId+'|'+r.date;
  const usedBefore=used.get(day)||0;
  if(Number.isFinite(duration)&&duration>0&&duration<=24)used.set(day,usedBefore+duration);
  if(!byEmployee.has(r.employeeId)||!String(r.date).startsWith(month))continue;
  const out=accrued.get(r.employeeId),person=byId.get(r.employeeId),problems=flags.get(r.employeeId),alerts=reviews.get(r.employeeId);
  if(!person||!(duration>0&&duration<=24)||!Number.isFinite(Number(r.rate))||Number(r.rate)<=0){
   note(problems,'سجل وردية غير صالح: '+String(r.date||'بدون تاريخ'));continue;
  }
  const basic=Math.max(0,Math.min(duration,8-usedBefore)),extra=duration-basic;
  const factor=S.currentFactor(person),wage=cents(basic*Number(r.rate)+extra*Number(r.rate)*factor);
  out.normal+=basic;out.extra+=extra;out.gross=cents(out.gross+wage);
  byEmployee.get(r.employeeId).push({raw:r,basic,extra,factor,wage});
  rates.get(r.employeeId).add(Number(r.rate));
  const actual=calculatedById.get(r.id);
  if(!actual||!near(actual.wage,wage)||!near(actual.normal,basic)||!near(actual.extra,extra))
   note(problems,'اختلاف حساب الوردية بتاريخ '+r.date+' (المتوقع '+fmt(wage)+' ₪)');
  if([1,1.5].includes(r.overtimeFactor)&&r.overtimeFactor!==factor)
   note(alerts,'يوجد معامل ساعة محفوظ سابقًا مختلف؛ راجع كشف الشهر قبل الصرف');
 }
 const rows=[];
 for(const p of people){
  const expected=accrued.get(p.id),app=F.sumMonthly(p.id,month),problems=flags.get(p.id),alerts=reviews.get(p.id);
  const tx=transactions.filter(t=>t.employeeId===p.id&&String(t.date).startsWith(month));
  const withdraw=cents(tx.filter(t=>t.type==='withdrawal').reduce((v,t)=>v+Number(t.amount||0),0));
  const paid=cents(tx.filter(t=>t.type==='payment').reduce((v,t)=>v+Number(t.amount||0),0));
  const remaining=cents(expected.gross-withdraw-paid);
  if(!near(expected.gross,app.gross)||!near(expected.normal,app.normal)||!near(expected.extra,app.extra))
   note(problems,'إجمالي الشهر في التطبيق لا يطابق الحساب المستقل');
  if(!near(withdraw,app.withdrawals)||!near(paid,app.paid)||!near(remaining,app.remaining))
   note(problems,'رصيد السحوبات أو الدفعات لا يطابق كشف الشهر');
  if(rates.get(p.id).size>1)note(alerts,'أكثر من سعر ساعة خلال الشهر');
  if(remaining<-.01)note(alerts,'دفعات وسحوبات تتجاوز المستحق');
  if(!byEmployee.get(p.id).length&&tx.length)note(alerts,'حركات مالية دون ورديات مسجلة');
  if(!byEmployee.get(p.id).length)note(alerts,'لا توجد ورديات مسجلة؛ لا يثبت ذلك الغياب');
  rows.push({id:p.id,name:p.name,shifts:byEmployee.get(p.id).length,
   expectedGross:cents(expected.gross),systemGross:cents(app.gross),
   difference:cents(expected.gross-app.gross),withdrawals:withdraw,paid,
   remaining,issues:problems,reviews:alerts,
   basic:expected.normal,extra:expected.extra,rateFactor:S.currentFactor(p)});
 }
 const chefCount=staff.filter(p=>S.currentFactor(p)===1.5).length;
 if(chefCount>1)for(const row of rows)note(row.reviews,'أكثر من موظف يستعمل معامل ×1.5؛ راجع تعيين الشيف');
 return {month,rows,issues:rows.reduce((n,r)=>n+r.issues.length,0),
  reviews:rows.reduce((n,r)=>n+r.reviews.length,0),
  expectedGross:cents(rows.reduce((n,r)=>n+r.expectedGross,0)),
  systemGross:cents(rows.reduce((n,r)=>n+r.systemGross,0)),
  invalidMonth:false};
}
window.RAWAA_PAYROLL_AUDIT={audit}; // Regression-test seam; no mutation methods.
const section=document.getElementById('payroll-review');
const monthInput=document.getElementById('review-month'),employeeInput=document.getElementById('review-employee');
if(!section||!monthInput||!employeeInput)return;
const panel=document.createElement('div');panel.id='rawaa-payroll-audit';panel.className='card';
panel.innerHTML=
 '<h3>تدقيق الرواتب المستقل · RAWAA 2.30</h3>'+
 '<p class="hint">فحص قراءة فقط: يعيد حساب أجر كل وردية من الوقت وسعر الساعة ويقارنه بالحساب الشهري والسحوبات والدفعات. لا يغيّر السجلات ولا يقفل الشهر ولا يعتمد الراتب.</p>'+
 '<div class="stats mini-stats" id="audit-summary" aria-live="polite"></div>'+
 '<p class="hint" id="audit-state" role="status" aria-live="polite"></p>'+
 '<div class="overflow"><table><thead><tr><th>الموظف</th><th>الورديات</th><th>أجر مستقل ₪</th><th>أجر النظام ₪</th><th>الفرق ₪</th><th>المتبقي ₪</th><th>المراجعة المطلوبة</th></tr></thead><tbody id="audit-rows"></tbody></table></div>'+
 '<div class="actions"><button type="button" class="outline" id="audit-export">تصدير نتيجة التدقيق CSV</button></div>'+
 '<p class="hint">ملف CSV غير مشفّر ويحتوي معلومات رواتب؛ احفظه في مكان آمن. سلامة الحساب لا تعني التوافق القانوني؛ الساعات الإضافية القانونية تستلزم معامل الأجر المعمول به قانونًا.</p>';
section.append(panel);
const $=id=>document.getElementById(id);
function show(){
 const result=audit(monthInput.value,employeeInput.value);
 const summary=$('audit-summary');summary.replaceChildren();
 for(const [title,value] of [['الموظفون',result.rows.length],['أخطاء حسابية',result.issues],['ملاحظات للمراجعة',result.reviews],['الأجر بعد التدقيق',fmt(result.expectedGross)+' ₪']]){
  const card=document.createElement('div');card.className='stat';
  const label=document.createElement('small'),strong=document.createElement('strong');
  label.textContent=title;strong.textContent=String(value);card.append(label,strong);summary.append(card);
 }
 const body=$('audit-rows');body.replaceChildren();
 for(const r of result.rows){
  const tr=document.createElement('tr');
  const issues=r.issues.concat(r.reviews);
  for(const value of [r.name,r.shifts,fmt(r.expectedGross),fmt(r.systemGross),fmt(r.difference),fmt(r.remaining),issues.join('؛ ')||'لا اختلاف حسابي ظاهر']){
   const cell=document.createElement('td');cell.textContent=String(value);tr.append(cell);
  }
  if(r.issues.length)tr.className='flag';
  body.append(tr);
 }
 const state=$('audit-state');
 state.textContent=result.invalidMonth?'اختر شهرًا صحيحًا لإجراء التدقيق.':
   result.issues?'توجد '+result.issues+' مشكلة حسابية تتطلب التصحيح قبل الصرف. لم يتم اعتماد أي راتب.':
   result.reviews?'تطابقت الحسابات، مع '+result.reviews+' ملاحظة تحتاج إلى مراجعة بشرية وقانونية قبل الصرف.':
   'تطابقت الحسابات المستقلة مع كشف الشهر؛ هذا فحص حسابي فقط وليس اعتمادًا نهائيًا للراتب.';
 return result;
}
function csvCell(value){
 const s=String(value??'');
 return '"'+(/^\s*[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';
}
$('audit-export').addEventListener('click',()=>{
 const report=show();
 if(report.invalidMonth||!report.rows.length)return;
 if(!confirm('سيُنزَّل كشف رواتب غير مشفّر لهذا الشهر. هل تريد متابعة التنزيل إلى جهازك؟'))return;
 const cells=[['الموظف','الشهر','عدد الورديات','المعامل','الأجر المستقل ₪','أجر التطبيق ₪','الفرق ₪','السحوبات ₪','الدفعات ₪','المتبقي ₪','اختلافات حسابية','ملاحظات مراجعة']];
 for(const r of report.rows)cells.push([r.name,report.month,r.shifts,r.rateFactor,r.expectedGross,r.systemGross,r.difference,r.withdrawals,r.paid,r.remaining,r.issues.join('؛ '),r.reviews.join('؛ ')]);
 const blob=new Blob(['\ufeff'+cells.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='RAWAA_Payroll_Audit_'+report.month+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
});
for(const id of ['review-month','review-employee'])$(id).addEventListener('change',show);
for(const event of ['rawaa:attendance-changed','rawaa:finance-changed','rawaa:staff-changed'])document.addEventListener(event,show);
show();
})();