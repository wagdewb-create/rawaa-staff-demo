/* RAWAA shift planner v1 — planned times only, never payroll or attendance transactions.
   Loaded only after authenticated RAWAA Cloud bootstrap. */
(()=>{
 'use strict';
 const KEY='RAWAA_STAFF_SHIFT_PLAN_V1',MAX=2000;
 const host=document.getElementById('shift-planner');
 if(!host||!window.RAWAA_STAFF||!window.RAWAA_ATTENDANCE_BRIDGE)return;
 const roster=window.RAWAA_STAFF,attendance=window.RAWAA_ATTENDANCE_BRIDGE;
 const $=id=>document.getElementById(id);
 const getPeople=()=>roster.getAll();
 const fmt=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
 const validDate=s=>{
  if(typeof s!=='string'||!/^([12]\d{3})-(\d{2})-(\d{2})$/.test(s))return false;
  const ms=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===s;
 };
 const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
 const addDate=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 function interval(row){
  const start=Date.parse(row.date+'T00:00:00Z')+minute(row.start)*60000;
  const end=Date.parse(row.date+'T00:00:00Z')+(minute(row.end)+(row.nextDay?1440:0))*60000;
  return {start,end,minutes:(end-start)/60000};
 }
 function validateList(rows,people=getPeople()){
  if(!Array.isArray(rows)||rows.length>MAX)return 'عدد الخطط غير مقبول.';
  const persons=new Set(people.map(p=>p.id)),seen=new Set(),times=[];
  for(const r of rows){
   if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!/^plan-[a-z0-9-]{6,90}$/i.test(r.id)||seen.has(r.id))return 'معرف وردية مخططة غير صالح أو مكرر.';
   seen.add(r.id);
   if(!persons.has(r.employeeId))return 'أحد الموظفين المخطط لهم غير موجود في سجلات RAWAA.';
   if(!validDate(r.date)||!validTime(r.start)||!validTime(r.end)||typeof r.nextDay!=='boolean')return 'تاريخ أو توقيت خطة العمل غير صحيح.';
   if(typeof r.note!=='string'||r.note.length>120)return 'ملاحظة الخطة طويلة أو غير صالحة.';
   const span=interval(r);
   if(span.minutes<=0||span.minutes>1440)return 'مدة الوردية المخططة يجب أن تكون بين دقيقة و24 ساعة، مع تحديد اليوم التالي للوردية الليلية.';
   times.push({employeeId:r.employeeId,id:r.id,...span});
  }
  times.sort((a,b)=>a.employeeId.localeCompare(b.employeeId)||a.start-b.start);
  for(let i=1;i<times.length;i++){
   const previous=times[i-1],current=times[i];
   if(current.employeeId===previous.employeeId&&current.start<previous.end)return 'توجد ورديتان مخططتان متداخلتان للموظف نفسه، حتى عند عبور منتصف الليل.';
  }
  return null;
 }
 let plans=[],storageError='',editingId=null;
 try{
  const value=localStorage.getItem(KEY);
  if(value){
   const parsed=JSON.parse(value),error=validateList(parsed);
   if(error)throw Error(error);
   plans=parsed;
  }
 }catch(e){storageError='تعذر قراءة خطط الورديات المحفوظة: '+String(e.message)+'؛ تم منع التعديل حتى لا تُستبدل السجلات.';}
 const isLocked=()=>!!window.RAWAA_CLOUD_WORKSPACE?.isNewEmptyWorkspace;
 function msg(value,error=false){
  const node=$('planner-feedback');
  node.textContent=value;node.style.color=error?'#aa3026':'#165f48';
 }
 function option(v,label){const o=document.createElement('option');o.value=v;o.textContent=label;return o;}
 function syncSelect(id,onlyActive){
  const e=$(id),current=e.value;e.replaceChildren();
  if(id==='planner-filter')e.append(option('all','جميع الموظفين'));
  for(const p of getPeople())if(!onlyActive||p.status==='active')e.append(option(p.id,p.name+(p.status==='archived'?' (مؤرشف)':'')));
  if([...e.options].some(o=>o.value===current))e.value=current;
 }
 function chosen(){
  return [...getPeople()].filter(p=>$('planner-filter').value==='all'||p.id===$('planner-filter').value);
 }
 function reset(){
  editingId=null;
  $('planner-form').reset();
  $('planner-day').value=window.RAWAA_RESTAURANT_TODAY();
  $('planner-save').textContent='حفظ موعد الدوام المخطط';
  $('planner-cancel').hidden=true;
 }
 function summary(label,value){
  const div=document.createElement('div');div.className='stat';
  const small=document.createElement('small'),strong=document.createElement('strong');
  small.textContent=label;strong.textContent=String(value);div.append(small,strong);return div;
 }
 const rowKey=(employeeId,date)=>employeeId+'|'+date;
 const plannerRange=()=>{
  const start=$('planner-week-start').value;
  if(!validDate(start))return null;
  return {start,end:addDate(start,6)};
 };
 function report(){
  const week=plannerRange();if(!week)return null;
  const selected=chosen(),selectedIds=new Set(selected.map(p=>p.id));
  const list=plans.filter(r=>selectedIds.has(r.employeeId)&&r.date>=week.start&&r.date<=week.end);
  const actual=attendance.getCalculated().filter(r=>selectedIds.has(r.employeeId)&&r.date>=week.start&&r.date<=week.end);
  const map=new Map();
  const collect=(employeeId,date)=>{
   const key=rowKey(employeeId,date);
   if(!map.has(key))map.set(key,{employeeId,date,planned:[],actual:[]});
   return map.get(key);
  };
  for(const r of list)collect(r.employeeId,r.date).planned.push(r);
  for(const r of actual)collect(r.employeeId,r.date).actual.push(r);
  const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||String(a.employeeId).localeCompare(String(b.employeeId)));
  const stats={plans:list.length,plannedHours:0,actualShifts:actual.length,actualHours:0,plannedWithoutRecord:0,unplannedRecord:0,differing:0};
  for(const p of list)stats.plannedHours+=interval(p).minutes/60;
  for(const a of actual)stats.actualHours+=Number(a.duration||0);
  for(const entry of rows){
   const plannedHours=entry.planned.reduce((sum,r)=>sum+interval(r).minutes/60,0);
   const actualHours=entry.actual.reduce((sum,r)=>sum+Number(r.duration||0),0);
   entry.plannedHours=plannedHours;entry.actualHours=actualHours;
   if(entry.planned.length&&!entry.actual.length)stats.plannedWithoutRecord++;
   if(entry.actual.length&&!entry.planned.length)stats.unplannedRecord++;
   if(entry.actual.length&&entry.planned.length&&Math.abs(plannedHours-actualHours)>0.5)stats.differing++;
  }
  return {week,rows,stats};
 }
 function td(row,content){const cell=document.createElement('td');cell.textContent=String(content);row.append(cell);return cell;}
 function button(text,action,id){
  const btn=document.createElement('button');btn.type='button';btn.className='outline planner-small-btn';
  btn.textContent=text;btn.dataset.action=action;btn.dataset.id=id;return btn;
 }
 function render(){
  syncSelect('planner-employee',true);syncSelect('planner-filter',false);
  const save=$('planner-save'),exportButton=$('planner-export'),feedback=$('planner-readiness');
  const locked=isLocked()||!!storageError;
  save.disabled=locked;
  feedback.textContent=storageError|| (isLocked()
   ?'حسابك السحابي الجديد لم يستعد بيانات الموظفين بعد. أكّد Gmail واستعد النسخة المشفّرة أولًا، حتى لا تختلط الخطط ببيانات تجريبية.'
   :'مواعيد التخطيط مستقلة عن الحضور الفعلي. تسجيل وقت متوقع لا يزيد الراتب ولا يحتسب ساعات عمل.');
  const data=report(),body=$('planner-rows'),stats=$('planner-stats');
  body.replaceChildren();stats.replaceChildren();
  exportButton.disabled=!data||data.rows.length===0;
  if(!data){msg('اختر تاريخًا صحيحًا لبداية أسبوع التخطيط.',true);return;}
  for(const [label,value] of [
    ['الورديات المخططة',data.stats.plans],
    ['ساعات التخطيط',fmt(data.stats.plannedHours)],
    ['ورديات مسجلة فعلًا',data.stats.actualShifts],
    ['الساعات المسجلة',fmt(data.stats.actualHours)],
    ['خطط بلا سجل دوام',data.stats.plannedWithoutRecord],
    ['دوام بلا خطة',data.stats.unplannedRecord]
   ])stats.append(summary(label,value));
  if(!data.rows.length){const tr=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=7;cell.textContent='لا توجد خطط ولا سجلات دوام في الأيام السبعة المختارة.';tr.append(cell);body.append(tr);}
  const peopleById=new Map(getPeople().map(p=>[p.id,p]));
  for(const r of data.rows){
   const tr=document.createElement('tr');
   td(tr,r.date);td(tr,peopleById.get(r.employeeId)?.name||'موظف غير معروف');
   const schedule=document.createElement('td');
   if(!r.planned.length)schedule.textContent='غير مخطط';
   for(const shift of r.planned){
    const line=document.createElement('div');line.className='planner-shift';
    const period=document.createElement('span');period.textContent=shift.start+'–'+shift.end+(shift.nextDay?' (+1 يوم)':'')+(shift.note?' · '+shift.note:'');
    line.append(period);
    if(!locked)line.append(button('تعديل','edit',shift.id),button('حذف','delete',shift.id));
    schedule.append(line);
   }
   tr.append(schedule);
   td(tr,fmt(r.plannedHours));
   td(tr,r.actual.length?r.actual.map(a=>a.start+'–'+a.end+(a.nextDay?' (+1 يوم)':'')).join('، '):'لا يوجد سجل (لا يعني غيابًا)');
   td(tr,r.actual.length?fmt(r.actualHours):'—');
   const status=r.planned.length&&r.actual.length
     ?(Math.abs(r.plannedHours-r.actualHours)>0.5?'تفاوت في الساعات':'ضمن نصف ساعة')
     :(r.planned.length?'بانتظار تسجيل الدوام':'وردية دون خطة');
   td(tr,status);body.append(tr);
  }
  const attention=$('planner-attention');
  attention.hidden=!data.stats.differing;
  attention.textContent=data.stats.differing?'توجد '+data.stats.differing+' حالات تتجاوز فيها فروق الساعات نصف ساعة؛ راجع الورديات المسجلة قبل اعتماد الرواتب.':'';
 }
 function save(){
  if(isLocked())return msg('لا تحفظ جدولًا جديدًا قبل تأكيد Gmail واستعادة بيانات الموظفين الأصلية.',true);
  if(storageError)return msg(storageError,true);
  const id=$('planner-employee').value,date=$('planner-day').value,start=$('planner-start').value,end=$('planner-end').value;
  const nextDay=$('planner-next-day').checked,note=$('planner-note').value.trim();
  const person=getPeople().find(p=>p.id===id&&p.status==='active');
  if(!person)return msg('اختر موظفًا نشطًا قبل حفظ الوردية.',true);
  const record={id:editingId||('plan-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)),employeeId:id,date,start,end,nextDay,note};
  const updated=plans.filter(x=>x.id!==editingId).concat(record);
  const error=validateList(updated);
  if(error)return msg(error,true);
  try{
   const json=JSON.stringify(updated);
   localStorage.setItem(KEY,json);
   plans=updated;
   const week=plannerRange();if(!week||date<week.start||date>week.end)$('planner-week-start').value=date;
   reset();render();msg('✓ حُفظ موعد الدوام المخطط. انتظر ظهور تأكيد المزامنة السحابية؛ هذا ليس سجل حضور فعلي.');
  }catch(e){msg('فشل حفظ الخطة: '+String(e.message),true);}
 }
 function edit(id){
  const row=plans.find(r=>r.id===id);if(!row||isLocked())return;
  if(!getPeople().some(p=>p.id===row.employeeId&&p.status==='active'))return msg('الموظف مؤرشف؛ لا يمكن تعديل خطة قديمة له. يمكنك مراجعتها فقط.',true);
  editingId=id;
  $('planner-employee').value=row.employeeId;$('planner-day').value=row.date;
  $('planner-start').value=row.start;$('planner-end').value=row.end;
  $('planner-next-day').checked=row.nextDay;$('planner-note').value=row.note;
  $('planner-save').textContent='حفظ تعديل خطة الدوام';$('planner-cancel').hidden=false;
  $('planner-form').scrollIntoView({block:'nearest',behavior:'smooth'});
  msg('أنت تعدّل موعدًا مخططًا، لا سجل حضور. التعديل لن يغيّر الراتب.');
 }
 function remove(id){
  if(isLocked()||storageError)return;
  const found=plans.find(p=>p.id===id);if(!found)return;
  if(!confirm('حذف موعد الدوام المخطط فقط؟ سجلات الحضور الفعلية والرواتب لن تتغير.'))return;
  const updated=plans.filter(p=>p.id!==id);
  try{localStorage.setItem(KEY,JSON.stringify(updated));plans=updated;
   if(editingId===id)reset();render();msg('حُذف موعد التخطيط فقط. سجلات الرواتب والحضور لم تتغير.');
  }catch(e){msg('تعذر حذف الموعد: '+String(e.message),true);}
 }
 function csvValue(value){
  const str=String(value??'');
  return '"'+(/^[\s]*[=+\-@\t\r]/.test(str)?"'"+str:str).replace(/"/g,'""')+'"';
 }
 function exportCsv(){
  const data=report();if(!data||!data.rows.length)return;
  const people=new Map(getPeople().map(p=>[p.id,p]));
  const lines=[['التاريخ','الموظف','الدوام المخطط','ساعات مخططة','الدوام المسجل','الساعات الفعلية','الفرق','الحالة']];
  for(const row of data.rows){
   const planned=row.planned.map(r=>r.start+'-'+r.end+(r.nextDay?' (+1)':'')+(r.note?' - '+r.note:'')).join(' / ');
   const actual=row.actual.map(r=>r.start+'-'+r.end+(r.nextDay?' (+1)':'')).join(' / ');
   const recorded=row.actual.length>0,scheduled=row.planned.length>0;
   lines.push([row.date,people.get(row.employeeId)?.name||row.employeeId,
    planned,fmt(row.plannedHours),actual,recorded?fmt(row.actualHours):'',
    recorded&&scheduled?fmt(row.actualHours-row.plannedHours):'',
    scheduled?(recorded?'مقارنة سجل وخطة':'لا يوجد سجل بعد'):'دوام غير مخطط']);
  }
  const text='\ufeff'+lines.map(row=>row.map(csvValue).join(',')).join('\r\n');
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='RAWAA_Shift_Plan_'+data.week.start+'.csv';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
 }
 $('planner-form').addEventListener('submit',e=>{e.preventDefault();save();});
 $('planner-cancel').addEventListener('click',()=>{reset();msg('أُلغيت مسودة التعديل.');});
 $('planner-rows').addEventListener('click',e=>{
  const target=e.target.closest('button[data-action]');if(!target)return;
  if(target.dataset.action==='edit')edit(target.dataset.id);
  if(target.dataset.action==='delete')remove(target.dataset.id);
 });
 $('planner-week-start').addEventListener('change',render);
 $('planner-filter').addEventListener('change',render);
 $('planner-export').addEventListener('click',exportCsv);
 document.addEventListener('rawaa:staff-changed',()=>{
  const validIds=new Set(getPeople().map(p=>p.id));
  if(editingId&&!validIds.has(plans.find(x=>x.id===editingId)?.employeeId))reset();
  render();
 });
 document.addEventListener('rawaa:attendance-changed',render);
 $('planner-week-start').value=window.RAWAA_RESTAURANT_TODAY();
 reset();render();
 if(storageError)msg(storageError,true);
 window.RAWAA_PLANNER_TEST={validateList,report,getPlans:()=>plans.map(r=>({...r})),interval,validDate,addDate,render};
})();
