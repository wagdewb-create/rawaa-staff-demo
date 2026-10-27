/* RAWAA Cloud 2.17 — read-only daily operations view.
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
 const dayName=date=>new Intl.DateTimeFormat('ar-PS',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 const personName=(id,ids)=>ids.get(id)?.name||'موظف غير معروف';
 const getFilterId=()=>$('operations-employee').value||'all';
 const statusText={
  recorded:'تم تسجيل دوام',
  difference:'الساعات تحتاج مراجعة',
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
  const groups=new Map();
  for(const a of actual){
   const key=String(a.employeeId);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(a);
  }
  const used=new Set(),rows=[];
  planned.sort((a,b)=>a.start.localeCompare(b.start)||String(a.employeeId).localeCompare(String(b.employeeId)));
  // Match at most one actual record to each planned shift, prioritizing actual
  // temporal overlap. A same-day correction that moves entirely outside the
  // original planned time is still linkable if it is the sole available record.
  for(const plan of planned){
   const candidates=(groups.get(String(plan.employeeId))||[]).filter(x=>!used.has(x.id));
   let chosen=null,top=-Infinity;
   for(const record of candidates){
    const overlapMins=overlap(plan,record);
    const distance=Math.abs(timeRange(plan).start-timeRange(record).start)/60000;
    const score=(overlapMins>0?100000:0)+overlapMins*10-distance;
    if(score>top){chosen=record;top=score;}
   }
   if(chosen)used.add(chosen.id);
   const planHours=planner.interval(plan).minutes/60;
   const actualHours=chosen?Number(chosen.duration||0):null;
   const delta=chosen?(actualHours-planHours):null;
   rows.push({
    key:'plan-'+plan.id,kind:chosen?(Math.abs(delta)>0.5?'difference':'recorded'):'pending',
    employeeId:plan.employeeId,employee:personName(plan.employeeId,staffMap),
    plan,actual:chosen,plannedHours:planHours,actualHours,delta,
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
 function render(){
  choices();
  const list=$('operations-list'),stats=$('operations-stats'),header=$('operations-period');
  list.replaceChildren();stats.replaceChildren();
  const data=getRows();
  if(!data){header.textContent='اختر تاريخًا صحيحًا.';$('operations-export').disabled=true;return;}
  header.textContent=dayName(data.date)+' · '+data.date;
  $('operations-export').disabled=!data.rows.length||inEmptyAccount();
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
  const f=$('operations-status').value;
  const visible=data.rows.filter(x=>f==='all'||(f==='needs-review'?['pending','difference','unplanned'].includes(x.kind):x.kind===f));
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
   }
   if(row.carryover)details.append(elem('small','تُحسب هذه الوردية ضمن يوم بدايتها، ولا تُضاف ساعاتها مرتين.','operations-comparison'));
   if(row.kind==='pending')details.append(elem('small','بانتظار التسجيل أو المراجعة؛ ليست حالة غياب مؤكدة.','operations-comparison'));
   const footer=elem('div',undefined,'operations-actions');
   if(row.canReview){
    const b=elem('button','مراجعة الحضور','operations-review');
    b.type='button';b.dataset.planId=row.plan.id;b.dataset.action='review';
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
 function csvCell(value){
  const text=String(value??'');
  return '"'+(/^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';
 }
 function exportCsv(){
  const data=getRows();if(!data||inEmptyAccount())return;
  const all=data.rows.filter(row=>!row.carryover);
  const header=['اليوم','الموظف','حالة المراجعة','بداية الخطة','نهاية الخطة','بداية الدوام المسجل','نهاية الدوام المسجل','الساعات الفعلية'];
  const lines=[header,...all.map(r=>[data.date,r.employee,statusText[r.kind],r.plan?.start||'',r.plan?.end||'',
   r.actual?.start||'',r.actual?.end||'',r.actual?fmt(r.actualHours):''])];
  const payload='\ufeff'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([payload],{type:'text/csv;charset=utf-8'}));
  link.href=url;link.download='RAWAA_Daily_Operations_'+data.date+'.csv';document.body.append(link);
  link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
 }
 $('operations-date').value=dateToday();
 $('operations-prev').addEventListener('click',()=>{
  $('operations-date').value=addDate($('operations-date').value,-1);render();
 });
 $('operations-next').addEventListener('click',()=>{
  $('operations-date').value=addDate($('operations-date').value,1);render();
 });
 $('operations-today').addEventListener('click',()=>{
  $('operations-date').value=dateToday();render();
 });
 for(const id of ['operations-date','operations-employee','operations-status'])$(id).addEventListener('change',render);
 $('operations-list').addEventListener('click',e=>{
  const action=e.target.closest('button[data-action="review"]');
  if(action)review(action.dataset.planId);
 });
 $('operations-export').addEventListener('click',exportCsv);
 for(const evt of ['rawaa:staff-changed','rawaa:attendance-changed','rawaa:planner-changed']){
  document.addEventListener(evt,render);
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('operations-date').value===dateToday())render();});
 render();
 window.RAWAA_DAILY_OPERATIONS_TEST={getRows,render,overlap,statusText,exportCsv};
})();
