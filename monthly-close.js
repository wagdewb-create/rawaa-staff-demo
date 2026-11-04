/* RAWAA 2.31 — approved monthly payroll snapshots and human review log.
 * Existing shift, staff, and finance records remain untouched.
 * This is NOT database-enforced immutability, payroll disbursement, or legal approval.
 */
(()=>{
'use strict';
const KEY='RAWAA_MONTHLY_CLOSINGS_V1',MAX_LENGTH=1200000;
const A=window.RAWAA_ATTENDANCE_BRIDGE,F=window.RAWAA_FINANCE_TEST,S=window.RAWAA_STAFF,P=window.RAWAA_PAYROLL_AUDIT;
if(!A||!F||!S||!P)return;
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const monthOK=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const copy=x=>JSON.parse(JSON.stringify(x));
const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const orderRows=arr=>arr.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const maxMonth=()=>typeof window.RAWAA_RESTAURANT_TODAY==='function'?window.RAWAA_RESTAURANT_TODAY().slice(0,7):new Date().toISOString().slice(0,7); // Palestine-local calendar when available.
function read(){
 const raw=localStorage.getItem(KEY);
 if(!raw)return {format:1,months:{},events:[]};
 if(raw.length>MAX_LENGTH)throw Error('سجل إقفال الرواتب كبير جدًا؛ لا تضف بيانات قبل أخذ نسخة احتياطية.');
 let obj;try{obj=JSON.parse(raw);}catch(_){throw Error('سجل إقفال الرواتب غير قابل للقراءة. لا يمكن استبداله.');}
 if(!obj||obj.format!==1||!obj.months||typeof obj.months!=='object'||Array.isArray(obj.months)||!Array.isArray(obj.events))
  throw Error('تنسيق سجل الإقفالات غير صالح. لا يمكن استبداله.');
 if(Object.keys(obj.months).length>120||obj.events.length>3000)throw Error('سجل الإقفالات تجاوز الحد الآمن.');
 for(const [month,r] of Object.entries(obj.months)){
  if(!monthOK(month)||!r||!['closed','open'].includes(r.status)||!Array.isArray(r.snapshots)||r.snapshots.length>30)throw Error('وجدنا سجل إقفال شهر غير صالح.');
 }
 return obj;
}
function save(state){
 const raw=JSON.stringify(state);
 if(raw.length>MAX_LENGTH)throw Error('حجم سجل الإقفالات كبير. احتفظ بنسخة مشفّرة واطلب توسيع مساحة التخزين.');
 localStorage.setItem(KEY,raw); // Cloud/Work storage facade handles sync and encrypted vault.
}
const actor=()=>String(window.RAWAA_CLOUD_WORKSPACE?.actorEmail||'حساب المدير الحالي').slice(0,110);
const getTimestamp=()=>new Date().toISOString();
const activeRows=(month)=>{
 const attendance=A.getEntries().filter(r=>String(r.date||'').slice(0,7)===month);
 const ledger=F.getTransactions().filter(t=>String(t.date||'').slice(0,7)===month);
 const ids=new Set([...attendance.map(x=>x.employeeId),...ledger.map(x=>x.employeeId)]);
 const staff=S.getAll().filter(p=>ids.has(p.id)).map(p=>({
  id:p.id,name:p.name,role:p.role,rate:p.rate,factor:S.currentFactor(p),status:p.status
 }));
 const shiftCols=['id','employeeId','date','start','end','nextDay','rate','overtimeFactor','note'];
 const txCols=['id','employeeId','date','type','amount','note'];
 const select=(x,cols)=>Object.fromEntries(cols.map(k=>[k,x[k]??null]));
 return {
  attendance:orderRows(attendance.map(r=>select(r,shiftCols))),
  ledger:orderRows(ledger.map(r=>select(r,txCols))),
  staff:orderRows(staff)
 };
};
async function fingerprint(data){
 if(!crypto?.subtle)throw Error('تدقيق إقفال الشهر يحتاج متصفحًا يدعم التشفير الآمن.');
 const raw=JSON.stringify(data);
 const result=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 return Array.from(result,x=>x.toString(16).padStart(2,'0')).join('');
}
async function current(month){
 if(!monthOK(month))throw Error('اختر شهرًا صحيحًا.');
 const audit=P.audit(month,'all');
 if(audit.invalidMonth)throw Error('شهر غير صالح.');
 const source=activeRows(month);
 const known=new Set(S.getAll().map(p=>p.id));
 if(source.attendance.some(r=>!known.has(r.employeeId))||source.ledger.some(t=>!known.has(t.employeeId)))
  throw Error('يوجد سجل موظف غير معروف في هذا الشهر؛ راجع أصل البيانات قبل الإقفال.');
 const set=new Set([...source.attendance.map(x=>x.employeeId),...source.ledger.map(x=>x.employeeId)]);
 const rows=audit.rows.filter(r=>set.has(r.id)).map(r=>({
  id:r.id,name:r.name,shifts:r.shifts,
  basic:money(r.basic),extra:money(r.extra),factor:r.rateFactor,
  gross:money(r.expectedGross),withdrawals:money(r.withdrawals),
  paid:money(r.paid),remaining:money(r.remaining)
 })).sort((a,b)=>a.id.localeCompare(b.id));
 const summary={
  employees:rows.length,
  shifts:rows.reduce((v,r)=>v+r.shifts,0),
  gross:money(rows.reduce((v,r)=>v+r.gross,0)),
  withdrawals:money(rows.reduce((v,r)=>v+r.withdrawals,0)),
  paid:money(rows.reduce((v,r)=>v+r.paid,0)),
  remaining:money(rows.reduce((v,r)=>v+r.remaining,0))
 };
 return {audit,rows,summary,fingerprint:await fingerprint({source,rows})};
}
async function inspect(month){
 if(!monthOK(month))throw Error('شهر غير صالح.');
 const all=read(),record=all.months[month]||null,latest=record?.snapshots?.at(-1)||null;
 const live=await current(month);
 const diff=latest?money(live.summary.gross-latest.summary.gross):0;
 return {
  month,status:record?.status||'open',versions:record?.snapshots?.length||0,
  latest:latest?copy(latest):null,live,
  hasChanges:!!latest&&live.fingerprint!==latest.fingerprint,
  grossDifference:diff,events:copy(all.events.filter(e=>e.month===month).slice(-20))
 };
}
async function close(month,approval,reason=''){
 if(!monthOK(month)||month>maxMonth())throw Error('لا يمكن إقفال شهر مستقبلي أو شهر غير صالح.');
 if(approval!==true)throw Error('يجب مراجعة الشهر والموافقة الصريحة على تسجيل الإقفال.');
 const memo=String(reason||'مراجعة حسابية قبل الصرف').trim().slice(0,200);
 const live=await current(month);
 if(live.audit.issues>0)throw Error('يوجد اختلاف حسابي. أصلحه قبل إقفال الشهر.');
 if(!live.summary.shifts&&live.summary.paid===0&&live.summary.withdrawals===0)throw Error('لا توجد ورديات أو حركات مالية؛ لا حاجة لإقفال شهر فارغ.');
 const state=read(),existing=state.months[month];
 if(existing?.status==='closed')throw Error('هذا الشهر مغلق بالفعل. يجب إعادة فتحه بسبب موثق قبل إنشاء نسخة جديدة.');
 if(Object.keys(state.months).length>=120&&!existing)throw Error('تم الوصول للحد الأقصى للأشهر؛ لا يمكن إنشاء إقفال جديد.');
 const versions=existing?.snapshots||[];
 if(versions.length>=30)throw Error('تم الوصول لحد نسخ الإقفال لهذا الشهر.');
 const next=versions.length+1;
 const snapshot={version:next,closedAt:getTimestamp(),actor:actor(),reason:memo,
  fingerprint:live.fingerprint,summary:live.summary,rows:live.rows,
  reviewCount:live.audit.reviews};
 state.months[month]={status:'closed',snapshots:[...versions,snapshot]};
 state.events.push({type:'close',month,at:snapshot.closedAt,actor:snapshot.actor,version:next,reason:memo});
 if(state.events.length>3000)throw Error('سجل العمليات وصل إلى حدّه؛ لم يُحذف السجل القديم.');
 save(state);
 return copy(snapshot);
}
function reopen(month,reason,approved){
 if(!monthOK(month))throw Error('شهر غير صالح.');
 if(approved!==true)throw Error('إعادة فتح الشهر تحتاج إلى موافقة صريحة.');
 const memo=String(reason||'').trim();
 if(memo.length<8||memo.length>200)throw Error('أدخل سببًا واضحًا لإعادة الفتح (8 أحرف على الأقل).');
 const state=read(),old=state.months[month];
 if(!old||old.status!=='closed')throw Error('الشهر ليس في حالة إقفال.');
 state.months[month]={...old,status:'open'};
 state.events.push({type:'reopen',month,at:getTimestamp(),actor:actor(),
  version:old.snapshots.length,reason:memo});
 if(state.events.length>3000)throw Error('سجل العمليات وصل إلى حدّه؛ لم يُحذف السجل القديم.');
 save(state);
 return true;
}
window.RAWAA_MONTH_CLOSE={inspect,close,reopen,read:()=>copy(read())};
const section=document.getElementById('payroll-review'),monthEl=document.getElementById('review-month');
if(!section||!monthEl)return;
const card=document.createElement('div');card.id='rawaa-monthly-close';card.className='card';
card.innerHTML=
 '<h3>إقفال حسابي للشهر · RAWAA 2.31</h3>'+
 '<p class="hint">احتفظ بنسخة مرجعية ثابتة من الرواتب عند المراجعة. إعادة فتح الشهر لا تحذف أي نسخة قديمة. التعديلات اللاحقة على الحضور أو السحوبات تظهر كاختلاف عن الإقفال، ولا تغيّر النسخة المعتمدة. هذا ليس قفلًا مفروضًا من قاعدة البيانات.</p>'+
 '<p class="warning">تنبيه: قبل الاعتماد راجع استحقاقات العمل الإضافي القانونية والدفعات المسددة. الإقفال الحسابي لا يعني تسديد الراتب أو التنازل عن الحقوق. حمّل نسخة احتياطية مشفّرة من «إدارة الحساب» واحتفظ بكلمة مرورها.</p>'+
 '<div id="monthly-close-status" role="status" aria-live="polite" class="result"></div>'+
 '<div id="monthly-close-overview" class="stats mini-stats"></div>'+
 '<h4>مقارنة أجر كل موظف مع آخر كشف معتمد</h4>'+
 '<div class="overflow"><table><thead><tr><th>الموظف</th><th>الأجر الحالي ₪</th><th>الأجر المعتمد ₪</th><th>الفرق ₪</th></tr></thead><tbody id="monthly-close-people"></tbody></table></div>'+
 '<p class="hint" id="monthly-close-drift"></p>'+
 '<label>ملاحظة الإقفال / رقم المراجعة<input id="monthly-close-note" type="text" maxlength="200" placeholder="مثال: تمت مراجعة كشف الشهر"/></label>'+
 '<div class="actions"><button type="button" id="monthly-close-confirm" class="primary">اعتماد إقفال الشهر</button>'+
 '<button type="button" id="monthly-close-reopen" class="outline" hidden>إعادة فتح مع توثيق السبب</button></div>'+
 '<h4>سجل الإجراءات لهذا الشهر</h4><div class="overflow"><table><thead><tr><th>التاريخ</th><th>الإجراء</th><th>الإصدار</th><th>السبب</th></tr></thead><tbody id="monthly-close-events"></tbody></table></div>'+
 '<p class="hint">يُحفظ القرار ضمن مساحة العمل السحابية الحالية؛ انتظر رسالة «محفوظ ومتزامن» قبل إغلاق الصفحة. النسخ المحفوظة هنا للمراجعة الإدارية وليست سجل تدقيق غير قابل للتعديل على مستوى الخادم.</p>';
section.append(card);
const $=id=>document.getElementById(id);
let rendering=0;
async function render(){
 const token=++rendering,month=monthEl.value;
 const status=$('monthly-close-status'),overview=$('monthly-close-overview'),drift=$('monthly-close-drift');
 overview.replaceChildren();$('monthly-close-people').replaceChildren();$('monthly-close-events').replaceChildren();
 if(!monthOK(month)){status.textContent='اختر شهرًا صالحًا.';$('monthly-close-confirm').disabled=true;$('monthly-close-reopen').hidden=true;return;}
 try{
  const state=await inspect(month);if(token!==rendering)return;
  const locked=state.status==='closed';
  $('monthly-close-confirm').hidden=locked;$('monthly-close-confirm').disabled=state.live.audit.issues>0||month>maxMonth();
  $('monthly-close-reopen').hidden=!locked;
  status.textContent=locked?'مغلق حسابيًا · النسخة المرجعية رقم '+state.versions:
   state.versions?'مفتوح للمراجعة؛ توجد '+state.versions+' نسخ سابقة محفوظة':'مفتوح؛ لم يتم إقفال هذا الشهر بعد.';
  for(const [label,val]of [
   ['الأجور الحالية',fmt(state.live.summary.gross)+' ₪'],
   ['الأجور المعتمدة',state.latest?fmt(state.latest.summary.gross)+' ₪':'—'],
   ['الفارق',state.latest?fmt(state.grossDifference)+' ₪':'—'],
   ['ملاحظات حسابية',String(state.live.audit.issues)]
  ]){
   const box=document.createElement('div');box.className='stat';
   const small=document.createElement('small'),strong=document.createElement('strong');
   small.textContent=label;strong.textContent=val;box.append(small,strong);overview.append(box);
  }
  const savedPeople=new Map((state.latest?.rows||[]).map(p=>[p.id,p]));
  const currentPeople=new Map(state.live.rows.map(p=>[p.id,p]));
  for(const id of new Set([...currentPeople.keys(),...savedPeople.keys()])){
   const now=currentPeople.get(id),before=savedPeople.get(id),tr=document.createElement('tr');
   const difference=money((now?.gross||0)-(before?.gross||0));
   for(const v of [now?.name||before?.name||id,now?fmt(now.gross):'—',before?fmt(before.gross):'—',before?fmt(difference):'—']){
    const td=document.createElement('td');td.textContent=v;tr.append(td);
   }
   if(before&&difference!==0)tr.className='flag';
   $('monthly-close-people').append(tr);
  }
  drift.textContent=state.latest&&state.hasChanges?
   'تنبيه: تغيّرت بيانات أو سياسة الحساب بعد النسخة المرجعية. افحص الفرق واحتفظ بالإقفال القديم؛ افتح الشهر بسبب موثق قبل اعتماد نسخة جديدة.':
   state.latest?'لا يوجد تغير في بصمة بيانات الشهر مقارنةً بآخر إقفال.':'لا يوجد إقفال سابق للمقارنة.';
  if(state.live.audit.issues)drift.textContent+=' توجد اختلافات حسابية يجب تصحيحها قبل أي إقفال.';
  if(!state.events.length){
   const td=document.createElement('td'),tr=document.createElement('tr');td.colSpan=4;td.textContent='لا توجد إجراءات إقفال مسجلة.';tr.append(td);$('monthly-close-events').append(tr);
  }
  for(const e of state.events.slice().reverse()){
   const tr=document.createElement('tr');
   for(const value of [e.at,e.type==='close'?'إقفال':'إعادة فتح',e.version,e.reason]){
    const td=document.createElement('td');td.textContent=String(value);tr.append(td);
   }$('monthly-close-events').append(tr);
  }
 }catch(e){status.textContent='تعذّر قراءة سجل الإقفال: '+String(e.message);$('monthly-close-confirm').disabled=true;$('monthly-close-reopen').hidden=true;}
}
$('monthly-close-confirm').addEventListener('click',async()=>{
 const month=monthEl.value,reason=$('monthly-close-note').value.trim();
 const button=$('monthly-close-confirm');button.disabled=true;
 try{
  const s=await inspect(month);
  if(s.live.audit.issues)throw Error('فحص الحساب يُظهر فروقات. أصلحها قبل الإقفال.');
  const message='تأكيد حفظ كشف '+month+' كنسخة مرجعية رقم '+(s.versions+1)+'؟\n'+
   'الأجور '+fmt(s.live.summary.gross)+' ₪ · السحوبات '+fmt(s.live.summary.withdrawals)+' ₪ · الدفعات '+fmt(s.live.summary.paid)+' ₪.\n'+
   (s.live.audit.reviews?'توجد '+s.live.audit.reviews+' ملاحظات مراجعة بشرية قبل الصرف.\n':'')+
   'لن يُعدّل الإقفال سجلات الحضور، ولا يعني دفع الرواتب أو التحقق من قانونية الأجور. هل تمت المراجعة؟';
  if(!confirm(message))return;
  await close(month,true,reason);
  $('monthly-close-note').value='';
  await render();
  $('monthly-close-status').textContent+=' · سجّلنا الإقفال على هذا الجهاز؛ تأكد من ظهور «محفوظ ومتزامن» قبل الإغلاق.';
 }catch(e){$('monthly-close-status').textContent='لم يُحفظ الإقفال: '+String(e.message);}
 finally{button.disabled=false;}
});
$('monthly-close-reopen').addEventListener('click',async()=>{
 const month=monthEl.value;
 const reason=prompt('اكتب سبب إعادة فتح شهر '+month+' (8 أحرف على الأقل). سيظل الكشف السابق محفوظًا للمراجعة:');
 if(reason===null)return;
 if(!confirm('تأكيد إعادة فتح '+month+'؟ لن تُحذف النسخ المرجعية السابقة.'))return;
 try{reopen(month,reason,true);await render();$('monthly-close-status').textContent+=' · تأكد من مزامنة القرار قبل تغيير أي بيانات.';}
 catch(e){$('monthly-close-status').textContent='تعذرت إعادة الفتح: '+String(e.message);}
});
monthEl.addEventListener('change',render);
for(const event of ['rawaa:attendance-changed','rawaa:finance-changed','rawaa:staff-changed'])
 document.addEventListener(event,render);
render();
})();