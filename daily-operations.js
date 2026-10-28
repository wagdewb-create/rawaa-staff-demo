/* RAWAA Cloud 2.21 — daily operations with explicit actual-attendance review.
   Planned shifts remain proposals; only separately confirmed actual attendance affects pay. */
(()=>{
 'use strict';
 const host=document.getElementById('daily-operations');
 const planner=window.RAWAA_PLANNER_TEST,attendance=window.RAWAA_ATTENDANCE_BRIDGE,roster=window.RAWAA_STAFF;
 if(!host||!planner||!attendance||!roster)return;
 const $=id=>document.getElementById(id);
 const people=()=>roster.getAll();
 const dateToday=()=>window.RAWAA_RESTAURANT_TODAY();
 const fmt=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
 const safeDate=planner.validDate;
 const addDate=planner.addDate;
 const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
 const timeRange=shift=>{
  const base=Date.parse(shift.date+'T00:00:00Z');
  return {start:base+minutes(shift.start)*60000,
          end:base+(minutes(shift.end)+(shift.nextDay?1440:0))*60000};
 };
 const overlap=(a,b)=>{
  const x=timeRange(a),y=timeRange(b);
  return Math.max(0,Math.min(x.end,y.end)-Math.max(x.start,y.start))/60000;
 };
 // Compare clock times on the same civil-date timeline used by attendance,
 // including the next-day marker. This is a review aid, never a pay adjustment.
 function timingVariance(plan,actual){
  if(!plan||!actual)return null;
  const p=timeRange(plan),a=timeRange(actual);
  const arrival=(a.start-p.start)/60000,departure=(a.end-p.end)/60000;
  return {lateArrival:Math.max(0,arrival),earlyArrival:Math.max(0,-arrival),
   earlyDeparture:Math.max(0,-departure),lateDeparture:Math.max(0,departure)};
 }
 function timingText(timing){
  if(!timing)return '';
  const labels=[['lateArrival','حضور بعد الموعد'],['earlyArrival','حضور قبل الموعد'],
   ['earlyDeparture','انصراف قبل الموعد'],['lateDeparture','انصراف بعد الموعد']];
  const parts=labels.filter(([key])=>timing[key]>0).map(([key,label])=>label+' بـ '+fmt(timing[key])+' دقيقة');
  return parts.length?parts.join(' · '):'الحضور والانصراف مطابقان للخطة.';
 }
 const dayName=date=>new Intl.DateTimeFormat('ar-PS',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 const personName=(id,ids)=>ids.get(id)?.name||'موظف غير معروف';
 const getFilterId=()=>$('operations-employee').value||'all';
 const statusText={
  recorded:'تم تسجيل دوام',
  difference:'المواعيد أو الساعات تحتاج مراجعة',
  pending:'الخطة دون سجل حضور',
  unplanned:'دوام مسجل دون خطة',
  overnight:'استمرار وردية من أمس'
 };
 const inEmptyAccount=()=>!!window.RAWAA_CLOUD_WORKSPACE?.isNewEmptyWorkspace;
 function getRows(date=$('operations-date').value,filterEmployee=getFilterId()){
  if(!safeDate(date))return null;
  const staff=people(),staffMap=new Map(staff.map(p=>[p.id,p]));
  const allowed=id=>filterEmployee==='all'||filterEmployee===id;
  const plans=planner.getPlans();
  const planned=plans.filter(x=>x.date===date&&allowed(x.employeeId));
  const actual=attendance.getCalculated().filter(x=>x.date===date&&allowed(x.employeeId));
  const prior=addDate(date,-1);
  const spillPlans=plans.filter(x=>x.date===prior&&x.nextDay&&allowed(x.employeeId));
  const spillActual=attendance.getCalculated().filter(x=>x.date===prior&&x.nextDay&&allowed(x.employeeId));
  // Reserve overlapping pairs across the whole day before considering a
  // moved shift. An earlier unmatched plan must not consume a later plan's
  // attendance. Non-overlapping matches are suggestions only when unambiguous.
  const used=new Set(),matched=new Map(),rows=[],pairs=[];
  for(const plan of planned)for(const record of actual){
   if(plan.employeeId!==record.employeeId)continue;
   const overlapMins=overlap(plan,record);
   if(overlapMins>0)pairs.push({plan,record,overlapMins,
    distance:Math.abs(timeRange(plan).start-timeRange(record).start)});
  }
  pairs.sort((a,b)=>b.overlapMins-a.overlapMins||a.distance-b.distance||
   String(a.plan.id).localeCompare(String(b.plan.id))||String(a.record.id).localeCompare(String(b.record.id)));
  for(const pair of pairs){
   if(matched.has(pair.plan.id)||used.has(pair.record.id))continue;
   matched.set(pair.plan.id,pair.record);used.add(pair.record.id);
  }
  for(const plan of planned){
   if(matched.has(plan.id))continue;
   const remainingPlans=planned.filter(p=>p.employeeId===plan.employeeId&&!matched.has(p.id));
   const remainingActual=actual.filter(r=>r.employeeId===plan.employeeId&&!used.has(r.id));
   if(remainingPlans.length===1&&remainingActual.length===1){
    matched.set(plan.id,remainingActual[0]);used.add(remainingActual[0].id);
   }
  }
  planned.sort((a,b)=>a.start.localeCompare(b.start)||String(a.employeeId).localeCompare(String(b.employeeId)));
  for(const plan of planned){
   const chosen=matched.get(plan.id)||null;
   const planHours=planner.interval(plan).minutes/60;
   const actualHours=chosen?Number(chosen.duration||0):null;
   const delta=chosen?(actualHours-planHours):null;
   const timingChanged=chosen&&(plan.start!==chosen.start||plan.end!==chosen.end||!!plan.nextDay!==!!chosen.nextDay);
   rows.push({
    key:'plan-'+plan.id,kind:chosen?(timingChanged||Math.abs(delta)>0.5?'difference':'recorded'):'pending',
    employeeId:plan.employeeId,employee:personName(plan.employeeId,staffMap),
    plan,actual:chosen,plannedHours:planHours,actualHours,delta,timingChanged:!!timingChanged,timing:timingVariance(plan,chosen),
    date,carryover:false,canReview:!chosen&&staffMap.get(plan.employeeId)?.status==='active'&&!inEmptyAccount()
   });
  }
  for(const act of actual)if(!used.has(act.id)){
   rows.push({
    key:'actual-'+act.id,kind:'unplanned',employeeId:act.employeeId,
    employee:personName(act.employeeId,staffMap),plan:null,actual:act,
    date,carryover:false,plannedHours:null,actualHours:Number(act.duration||0),delta:null,canReview:false
   });
  }
  // Night shifts belong to the day they began. Show a distinct carryover
  // notice on the following day, without counting their hours a second time.
  const carryGroups=new Map();
  for(const record of spillActual){
   const id=String(record.employeeId);
   if(!carryGroups.has(id))carryGroups.set(id,[]);
   carryGroups.get(id).push(record);
  }
  const usedCarry=new Set();
  for(const p of spillPlans){
   const possible=(carryGroups.get(String(p.employeeId))||[]).filter(x=>!usedCarry.has(x.id));
   const match=possible.find(x=>overlap(x,p)>0)||null;
   if(match)usedCarry.add(match.id);
   rows.push({key:'carry-plan-'+p.id,kind:'overnight',employeeId:p.employeeId,
    employee:personName(p.employeeId,staffMap),plan:p,actual:match,date:prior,
    carryover:true,canReview:false});
  }
  for(const a of spillActual)if(!usedCarry.has(a.id)){
   rows.push({key:'carry-actual-'+a.id,kind:'overnight',employeeId:a.employeeId,
    employee:personName(a.employeeId,staffMap),plan:null,actual:a,date:prior,
    carryover:true,canReview:false});
  }
  const starts=rows.filter(x=>!x.carryover);
  const summary={
   planned:planned.length,recorded:starts.filter(x=>x.plan&&x.actual).length,
   pending:starts.filter(x=>x.kind==='pending').length,
   unplanned:starts.filter(x=>x.kind==='unplanned').length,
   differing:starts.filter(x=>x.kind==='difference').length,
   actualHours:actual.reduce((total,x)=>total+Number(x.duration||0),0),
   overnight:rows.filter(x=>x.carryover).length
  };
  return {date,rows,summary};
 }
 function elem(tag,text,className){
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=String(text);
  if(className)n.className=className;
  return n;
 }
 function option(value,text){const el=elem('option',text);el.value=value;return el;}
 function choices(){
  const box=$('operations-employee'),old=box.value||'all';
  box.replaceChildren(option('all','جميع الموظفين'));
  for(const p of people())box.append(option(p.id,p.name+(p.status==='archived'?' (مؤرشف)':'')));
  box.value=[...box.options].some(x=>x.value===old)?old:'all';
 }
 function shiftHours(row){
  if(!row)return '—';
  return row.start+'–'+row.end+(row.nextDay?' (+1 يوم)':'');
 }
 function searchable(text){
  return String(text||'').normalize('NFKC').replace(/[\u064b-\u065f]/g,'').toLocaleLowerCase('ar').trim();
 }
 function getVisibleRows(data=getRows()){
  if(!data)return [];
  const state=$('operations-status').value;
  const query=searchable($('operations-search').value);
  return data.rows.filter(row=>
   (state==='all'||(state==='late-arrival'?row.timing?.lateArrival>0:
    state==='early-departure'?row.timing?.earlyDeparture>0:
    state==='needs-review'?['pending','difference','unplanned'].includes(row.kind):row.kind===state))&&
   (!query||searchable(row.employee+' '+row.employeeId).includes(query))
  );
 }
 function refreshQuickFilters(){
  const current=$('operations-status').value;
  for(const button of document.querySelectorAll('[data-operations-filter]'))
   button.setAttribute('aria-pressed',String(button.dataset.operationsFilter===current));
 }
 function render(){
  choices();
  const list=$('operations-list'),stats=$('operations-stats'),header=$('operations-period');
  list.replaceChildren();stats.replaceChildren();
  const data=getRows();
  if(!data){header.textContent='اختر تاريخًا صحيحًا.';$('operations-export').disabled=true;$('operations-print').disabled=true;$('operations-visible-count').textContent='';refreshQuickFilters();return;}
  header.textContent=dayName(data.date)+' · '+data.date;
  const visible=getVisibleRows(data);
  $('operations-export').disabled=!visible.length||inEmptyAccount();
  $('operations-print').disabled=!visible.length||inEmptyAccount();
  $('operations-visible-count').textContent='عرض '+visible.length+' من '+data.rows.length+' وردية مطابقة للفلاتر. المؤشرات بالأعلى تشمل التاريخ والموظف المختار قبل البحث وتصفية الحالة.';
  refreshQuickFilters();
  $('operations-empty-account').hidden=!inEmptyAccount();
  const cells=[['الورديات المخططة',data.summary.planned],
   ['مرتبطة بسجل فعلي',data.summary.recorded],
   ['خطط دون سجل',data.summary.pending],
   ['دوام غير مخطط',data.summary.unplanned],
   ['ساعات مسجلة',fmt(data.summary.actualHours)],
   ['استمرار من أمس',data.summary.overnight]];
  for(const [key,value] of cells){
   const box=elem('div',undefined,'operations-stat');
   box.append(elem('small',key),elem('strong',value));stats.append(box);
  }
  // Filtering is view-only: it cannot add or update payroll or attendance records.
  if(!visible.length){
   list.append(elem('p','لا توجد ورديات مطابقة للفلاتر الحالية. عدم وجود سجل لا يعني الغياب.','operations-empty'));return;
  }
  for(const row of visible){
   const card=elem('article',undefined,'operations-card operations-'+row.kind);
   card.dataset.kind=row.kind;card.dataset.employeeId=row.employeeId;
   const head=elem('div',undefined,'operations-row-head');
   const person=elem('strong',row.employee),state=elem('span',statusText[row.kind],'operations-state');
   head.append(person,state);
   const details=elem('div',undefined,'operations-row-details');
   const label=row.carryover?'بداية أمس':'الخطة';
   const first=elem('div',undefined,'operations-time-line');
   first.append(elem('small',label),elem('span',shiftHours(row.plan)));
   const second=elem('div',undefined,'operations-time-line');
   second.append(elem('small','سجل الحضور'),elem('span',shiftHours(row.actual)));
   details.append(first,second);
   if(!row.carryover&&row.plan&&row.actual){
    const dif=elem('small',
     'المخطط '+fmt(row.plannedHours)+' ساعة، والمسجل '+fmt(row.actualHours)+
      ' ساعة، والفرق '+(row.delta>=0?'+':'')+fmt(row.delta)+' ساعة.',
     'operations-comparison');
    details.append(dif);
    details.append(elem('small',timingText(row.timing),'operations-comparison operations-timing'));
    if(row.timingChanged)details.append(elem('small','الفروق مقارنة بالخطة للمراجعة فقط؛ لا يترتب عليها خصم تلقائي.','operations-comparison'));
   }
   if(row.carryover)details.append(elem('small','تُحسب هذه الوردية ضمن يوم بدايتها، ولا تُضاف ساعاتها مرتين.','operations-comparison'));
   if(row.kind==='pending')details.append(elem('small','بانتظار التسجيل أو المراجعة؛ ليست حالة غياب مؤكدة.','operations-comparison'));
   const footer=elem('div',undefined,'operations-actions');
   if(row.canReview){
    const b=elem('button','مراجعة الحضور','operations-review');
    b.type='button';b.dataset.planId=row.plan.id;b.dataset.action='review';
    footer.append(b);
   }
   if(row.actual&&!inEmptyAccount()){
    const b=elem('button',row.carryover?'مراجعة سجل أمس':'مراجعة السجل الفعلي','operations-edit-actual');
    b.type='button';b.dataset.actualId=row.actual.id;b.dataset.action='edit-actual';
    b.setAttribute('aria-label','مراجعة سجل الحضور المحفوظ للموظف '+row.employee);
    footer.append(b);
   }
   if(!row.carryover&&!row.plan){
    const a=elem('a','فتح تسجيل الدوام');a.href='#attendance';footer.append(a);
   }
   card.append(head,details,footer);list.append(card);
  }
 }
 function review(planId){
  if(inEmptyAccount()){
   $('operations-message').textContent='أكّد حسابك واستعد بيانات الموظفين الأصلية قبل تسجيل الحضور.';
   return;
  }
  const plan=planner.getPlans().find(p=>p.id===planId);
  if(!plan){$('operations-message').textContent='لا توجد وردية مخططة بهذا المعرف. حدّث الصفحة.';return;}
  const result=attendance.prefillFromPlan({...plan});
  if(!result?.ok){$('operations-message').textContent=result?.error||'تعذرت مراجعة الوردية.';return;}
  $('operations-message').textContent='نُسخت الأوقات المقترحة إلى نموذج الحضور. راجع الأوقات الحقيقية والأجر، ثم أكّد الحفظ.';
 }
 function reviewActual(actualId){
  if(inEmptyAccount()){
   $('operations-message').textContent='استعد بيانات الموظفين الأصلية قبل مراجعة سجلات الدوام.';
   return;
  }
  const record=attendance.getEntries().find(x=>x.id===actualId);
  if(!record){$('operations-message').textContent='سجل الحضور لم يعد موجودًا. حدّث الصفحة قبل المراجعة.';return;}
  if(typeof attendance.reviewSavedShift!=='function'){
   $('operations-message').textContent='تعذر فتح سجل الحضور للمراجعة. حدّث الصفحة.';
   return;
  }
  const result=attendance.reviewSavedShift(record.id);
  if(!result?.ok){
   $('operations-message').textContent=result?.error||'تعذّر فتح سجل الحضور.';
   return;
  }
  $('operations-message').textContent='فُتح السجل المحفوظ للمراجعة فقط؛ لن يتغير الأجر أو السجل إلا بعد حفظ التعديل وتأكيد أثره على الرواتب.';
 }
 function csvCell(value){
  const text=String(value??'');
  return '"'+(/^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';
 }
 function exportCsv(){
  const data=getRows();if(!data||inEmptyAccount())return;
  const all=getVisibleRows(data);
  if(!all.length)return;
  const header=['يوم التقرير','الموظف','حالة المراجعة','بداية الخطة','نهاية الخطة','بداية الدوام المسجل','نهاية الدوام المسجل','الساعات الفعلية','ملاحظة','تاريخ بداية الوردية','تاريخ نهاية الخطة','تاريخ نهاية الدوام المسجل','حضور بعد الموعد (دقيقة)','حضور قبل الموعد (دقيقة)','انصراف قبل الموعد (دقيقة)','انصراف بعد الموعد (دقيقة)'];
  const lines=[header,...all.map(r=>[data.date,r.employee,statusText[r.kind],r.plan?.start||'',r.plan?.end||'',
   r.actual?.start||'',r.actual?.end||'',
   r.carryover?'':(r.actual?fmt(r.actualHours):''),
   r.carryover?'وردية بدأت '+r.date+'؛ لا تُحسب ساعاتها مرة ثانية':(r.kind==='pending'?'لا يعني غيابًا':(r.timingChanged?'فروق للمراجعة فقط؛ دون خصم تلقائي':'')),
   r.date,r.plan?addDate(r.plan.date,r.plan.nextDay?1:0):'',r.actual?addDate(r.actual.date,r.actual.nextDay?1:0):'',
   r.timing?.lateArrival??'',r.timing?.earlyArrival??'',r.timing?.earlyDeparture??'',r.timing?.lateDeparture??''])];
  const payload='\ufeff'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([payload],{type:'text/csv;charset=utf-8'}));
  link.href=url;link.download='RAWAA_Daily_Operations_'+data.date+'.csv';document.body.append(link);
  link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
 }
 $('operations-date').value=dateToday();
 $('operations-prev').addEventListener('click',()=>{
  $('operations-date').value=addDate(safeDate($('operations-date').value)?$('operations-date').value:dateToday(),-1);render();
 });
 $('operations-next').addEventListener('click',()=>{
  $('operations-date').value=addDate(safeDate($('operations-date').value)?$('operations-date').value:dateToday(),1);render();
 });
 $('operations-today').addEventListener('click',()=>{
  $('operations-date').value=dateToday();render();
 });
 for(const id of ['operations-date','operations-employee','operations-status'])$(id).addEventListener('change',render);
 $('operations-list').addEventListener('click',e=>{
  const action=e.target.closest('button[data-action]');
  if(!action)return;
  if(action.dataset.action==='review')review(action.dataset.planId);
  if(action.dataset.action==='edit-actual')reviewActual(action.dataset.actualId);
 });
 $('operations-export').addEventListener('click',exportCsv);
 $('operations-search').addEventListener('input',render);
 $('operations-clear-filters').addEventListener('click',()=>{
  $('operations-employee').value='all';$('operations-status').value='all';$('operations-search').value='';render();
 });
 for(const button of document.querySelectorAll('[data-operations-filter]')){
  button.addEventListener('click',()=>{
   $('operations-status').value=button.dataset.operationsFilter;
   render();
  });
 }
 const clearPrint=()=>document.body.classList.remove('rawaa-print-daily');
 window.addEventListener('afterprint',clearPrint);
 function printReport(){
  const data=getRows();
  if(!data||inEmptyAccount()||!getVisibleRows(data).length)return;
  const selected=$('operations-employee');
  const label=selected.options[selected.selectedIndex]?.textContent||'جميع الموظفين';
  const status=$('operations-status');
  const statusLabel=status.options[status.selectedIndex]?.textContent||'جميع الحالات';
  const searchText=$('operations-search').value.trim();
  const count=getVisibleRows(data).length;
  $('operations-print-heading').textContent=
   'رواء | تقرير متابعة الدوام\n'+dayName(data.date)+' · '+data.date+
   '\nالموظف: '+label+' | الحالة: '+statusLabel+
   (searchText?' | البحث: '+searchText:'')+
   '\nالورديات المعروضة: '+count+
   ' · الساعات من سجلات الحضور المعتمدة فقط. الوردية الممتدة من أمس لا يُحتسب أجرها مرتين.';
  document.body.classList.add('rawaa-print-daily');
  try{window.print();}catch(error){
   clearPrint();
   $('operations-message').textContent='تعذّر فتح نافذة الطباعة: '+String(error.message);
  }
 }
 $('operations-print').addEventListener('click',printReport);
 for(const evt of ['rawaa:staff-changed','rawaa:attendance-changed','rawaa:planner-changed']){
  document.addEventListener(evt,render);
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('operations-date').value===dateToday())render();});
 render();
 window.RAWAA_DAILY_OPERATIONS_TEST={getRows,getVisibleRows,render,overlap,statusText,exportCsv,printReport,reviewActual,timingVariance,timingText};
})();
