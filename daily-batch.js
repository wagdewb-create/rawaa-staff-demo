/* RAWAA demo: bulk daily attendance — fake records only */
(()=>{'use strict';
const A=window.RAWAA_ATTENDANCE_BRIDGE,T=window.RAWAA_DEMO_TEST;
if(!A||!T)return;
const $=id=>document.getElementById(id),root=$('bulk-attendance');
if(!root)return;
let people=[];
const safe=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const validDay=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=new Date(d+'T00:00:00Z');return !isNaN(+t)&&t.toISOString().slice(0,10)===d};
const validTime=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
root.innerHTML='<h2>الإدخال الجماعي للحضور والانصراف</h2><p class="hint">اختر الموظفين الذين تريد تسجيلهم، وحدد لكل موظف وقتًا مختلفًا. الموظف غير المحدد لا يُعتبر غائبًا.</p>'+
'<div class="card"><label>تاريخ بدء الدوام<input id="bulk-day" type="date" ></label><div id="bulk-people"></div>'+
'<p class="hint">لا يُخصم أي وقت استراحة. تُنسب الوردية الليلية إلى تاريخ بدايتها، والإضافي يبدأ بعد مجموع 8 ساعات في اليوم.</p>'+
'<p class="hint" id="bulk-msg" role="status" aria-live="polite"></p><div class="actions">'+
'<button class="plain" id="bulk-review" type="button">مراجعة الساعات والأجر</button>'+
'<button class="plain" id="bulk-save" type="button">حفظ الورديات المحددة</button>'+
'<button class="plain" id="bulk-reset" type="button">إلغاء الاختيارات</button></div>'+
'<div id="bulk-preview" class="card" hidden></div></div>';
$('bulk-day').value=window.RAWAA_RESTAURANT_TODAY();
function renderPeople(){
const drafts=new Map(people.map(p=>[p.id,Object.fromEntries(['enabled','start','end','rate','note','next'].map(k=>{const input=field(k,p.id);return [k,k==='enabled'||k==='next'?input.checked:input.value]}))]));
const oldRates=new Map(people.map(p=>[p.id,p.rate]));
people=window.RAWAA_STAFF.getAll().filter(p=>p.status==='active').map(p=>({...p}));
$('bulk-people').innerHTML=people.map((p,i)=>'<fieldset style="border:1px solid var(--border);border-radius:12px;padding:10px;margin:12px 0"><legend style="font-weight:700">'+safe(p.name)+'</legend>'+
'<label><input type="checkbox" data-bulk-kind="enabled" data-emp="'+p.id+'" style="width:20px;vertical-align:middle;min-height:auto"> تسجيل دوام هذا الموظف</label>'+
'<div class="formgrid"><label>الحضور<input data-bulk-kind="start" data-emp="'+p.id+'" type="time" value="'+(i===0?'08:00':i===1?'16:00':'12:00')+'"></label>'+
'<label>الانصراف<input data-bulk-kind="end" data-emp="'+p.id+'" type="time" value="'+(i===0?'16:00':i===1?'00:00':'20:00')+'"></label>'+
'<label>سعر الساعة ₪<input data-bulk-kind="rate" data-emp="'+p.id+'" type="number" min="0.01" max="10000" step="0.01" value="'+p.rate+'"></label>'+
'<label>ملاحظة<input data-bulk-kind="note" data-emp="'+p.id+'" maxlength="120" placeholder="ملاحظة تجريبية"></label></div>'+
'<label><input type="checkbox" data-bulk-kind="next" data-emp="'+p.id+'" style="width:20px;vertical-align:middle;min-height:auto" '+(i===1?'checked':'')+'> الانصراف في اليوم التالي</label></fieldset>').join('');
for(const p of people){const draft=drafts.get(p.id);if(!draft)continue;for(const [k,v] of Object.entries(draft)){if(k==='rate'&&Number(v)===oldRates.get(p.id))continue;const input=field(k,p.id);if(k==='enabled'||k==='next')input.checked=v;else input.value=v;}}
$('bulk-save').disabled=!people.length;$('bulk-review').disabled=!people.length;
if(!people.length)$('bulk-people').textContent='لا يوجد موظفون نشطون. أضف موظفًا أو أعد تفعيله من قسم الموظفين.';
$('bulk-preview').hidden=true;
}

const field=(k,id)=>root.querySelector('[data-bulk-kind="'+k+'"][data-emp="'+id+'"]');
function message(txt,ok){const e=$('bulk-msg');e.textContent=txt;e.style.color=ok?'#17624a':'#ad302b'}
function build(){
const day=$('bulk-day').value;
if(!validDay(day))throw Error('أدخل تاريخًا صحيحًا.');
const chosen=people.filter(p=>field('enabled',p.id).checked);
if(!chosen.length)throw Error('حدد موظفًا واحدًا على الأقل.');
const rows=chosen.map(p=>{
const start=field('start',p.id).value,end=field('end',p.id).value,nextDay=field('next',p.id).checked;
const raw=field('rate',p.id).value,rate=Number(raw),note=field('note',p.id).value.trim();
if(!validTime(start)||!validTime(end))throw Error('وقت غير صحيح: '+p.name);
const m=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const span=m(end)-m(start)+(nextDay?1440:0);
if(span<=0||span>1440)throw Error('مدة غير صحيحة: '+p.name);
if(raw.trim()===''||!Number.isFinite(rate)||rate<=0||rate>10000)throw Error('سعر الساعة غير صحيح: '+p.name);
if(note.length>120)throw Error('الملاحظة طويلة جدًا: '+p.name);
return {id:'bulk-'+Date.now()+'-'+p.id+'-'+Math.random().toString(36).slice(2,10),employeeId:p.id,date:day,start,end,nextDay,rate,note};
});
const before=A.getEntries(),all=before.concat(rows),err=A.validateImportedBatch(all);
if(err)throw Error('تعارض في الورديات: '+err);
return {before,all,rows};
}
function review(){
try{const b=build(),selected=new Set(b.rows.map(r=>r.id));
const result=T.calc(b.all).filter(r=>selected.has(r.id));
$('bulk-preview').hidden=false;
$('bulk-preview').innerHTML='<strong>مراجعة '+result.length+' وردية</strong>'+result.map(r=>'<div class="moneyrow"><span>'+safe(people.find(p=>p.id===r.employeeId).name)+': '+fmt(r.duration)+' ساعة (أساسي '+fmt(r.normal)+'، إضافي '+fmt(r.extra)+')</span><strong>'+fmt(r.wage)+' ₪</strong></div>').join('');
message('تم التحقق من المجموعة، دون حفظها بعد.',true);
return b;
}catch(e){$('bulk-preview').hidden=true;message(e.message||'تعذرت مراجعة البيانات.',false);return null}
}
renderPeople();
document.addEventListener('rawaa:staff-changed',()=>{renderPeople();message('تم تحديث قائمة الموظفين. راجع الاختيارات وأسعار الساعة قبل الحفظ.',true)});
root.addEventListener('input',()=>{$('bulk-preview').hidden=true;message('تغيرت المدخلات؛ أعد مراجعتها قبل الحفظ.',true)});
$('bulk-review').onclick=review;
$('bulk-save').onclick=()=>{
const b=review();if(!b)return;
if(!confirm('حفظ '+b.rows.length+' وردية تدريبية محليًا؟'))return;
let previous;
try{
const k=A.storageKey;previous=localStorage.getItem(k);localStorage.setItem(k,JSON.stringify(b.all));
A.replaceImported(b.all);
people.forEach(p=>{field('enabled',p.id).checked=false});
$('bulk-preview').hidden=true;
message('تم حفظ '+b.rows.length+' وردية على هذا الجهاز فقط، دون مزامنة.',true);
}catch(e){
try{const k=A.storageKey;if(previous===null)localStorage.removeItem(k);else if(previous!==undefined)localStorage.setItem(k,previous)}catch(_){}
try{A.replaceImported(b.before)}catch(_){}
message('تعذر حفظ المجموعة؛ لم تُعتمد السجلات.',false);
}
};
$('bulk-reset').onclick=()=>{
people.forEach(p=>{field('enabled',p.id).checked=false});
$('bulk-preview').hidden=true;message('أُلغيت الاختيارات. لم يتغير أي سجل.',true);
};
})();