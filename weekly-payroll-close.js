/* RAWAA weekly payroll close: manual after seven completed days, with auditable history. */
(()=>{
 'use strict';
 const C=window.RAWAA_WEEKLY_PAYROLL_CORE;
 const A=window.RAWAA_ATTENDANCE_BRIDGE,F=window.RAWAA_FINANCE_TEST,S=window.RAWAA_STAFF;
 const host=document.getElementById('monthly-ledger');
 if(!C||!A||!F||!S||!host||!window.RAWAA_CLOUD_WORKSPACE)return;
 const KEY='RAWAA_WEEKLY_PAYROLL_CLOSES_V1';
 const ATT='RAWAA_DEMO_ATTENDANCE_V12',FIN='RAWAA_DEMO_LEDGER_V13';
 const $=id=>document.getElementById(id);
 const fmt=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const today=()=>window.RAWAA_RESTAURANT_TODAY();
 const make=(tag,txt)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=String(txt);return e;};
 function anchor(){
  const raw=localStorage.getItem('RAWAA_PAYROLL_RESET_ARCHIVE_20261118_V1');
  if(raw)try{
   const old=JSON.parse(raw),d=String(old.archived_at||'').slice(0,10);
   if(C.day(d)!==null)return d;
  }catch(_){}
  const dates=[...A.getEntries(),...F.getTransactions()].map(x=>x.date).filter(x=>C.day(x)!==null);
  return dates.length?dates.sort()[0]:today();
 }
 function state(){return C.readState(localStorage.getItem(KEY),anchor());}
 function current(s){
  return C.inspect({start:s.nextStart,staff:S.getAll(),attendance:A.getEntries(),
    calculated:A.getCalculated(),transactions:F.getTransactions()});
 }
 const card=make('div');card.className='card';card.id='rawaa-weekly-payroll-close';
 card.innerHTML=
  '<h3>إقفال رواتب الموظفين كل 7 أيام</h3>'+
  '<p class="hint">راجع أجور الأسبوع والسحوبات والدفعات، ثم أكد دفع المتبقي لإقفال الأيام السبعة. لا يتم أي تصفير تلقائي. يتم حفظ كشف الأسبوع والورديات والحركات في أرشيف الحساب السحابي؛ تبقى أسماء الموظفين وأسعار ساعاتهم دون تغيير.</p>'+
  '<div id="weekly-close-period" class="result" role="status"></div>'+
  '<div id="weekly-close-totals" class="stats mini-stats"></div>'+
  '<div class="overflow"><table><thead><tr><th>الموظف</th><th>الورديات</th><th>الأجر ₪</th><th>السحوبات ₪</th><th>الدفعات ₪</th><th>المتبقي ₪</th></tr></thead><tbody id="weekly-close-rows"></tbody></table></div>'+
  '<div id="weekly-close-error" class="warning" role="alert" hidden></div>'+
  '<div class="formgrid"><label>تاريخ دفع الرواتب<input id="weekly-close-paid-on" type="date" required></label></div>'+
  '<label class="rawaa-confirm-line"><input id="weekly-close-paid-check" type="checkbox"> أؤكد أنني دفعت بالفعل كامل المبالغ المتبقية للموظفين المبينة أعلاه، أو أنها صفر أصلًا.</label>'+
  '<div class="actions"><button type="button" id="weekly-close-action" class="primary" disabled>تأكيد الدفع وإقفال الأسبوع</button>'+
  '<button type="button" id="weekly-close-refresh" class="outline" hidden>تحديث الحسابات بعد الحفظ</button></div>'+
  '<p class="hint" id="weekly-close-message" role="status" aria-live="polite">لن تُحذف أي سجلات إلا بعد تأكيدك، وستظل محفوظة في أرشيف الأسابيع.</p>'+
  '<details id="weekly-close-history"><summary>سجل الأسابيع المقفلة</summary><div id="weekly-close-history-content"></div></details>';
 const heading=host.querySelector('h2');if(heading)heading.after(card);else host.prepend(card);
 $('weekly-close-paid-on').value=today();$('weekly-close-paid-on').max=today();
 let pending=false,invalid=false;
 function stats(container,items){
  container.replaceChildren();
  for(const [label,value] of items){const div=make('div');div.className='stat';const small=make('small',label),strong=make('strong',value);div.append(small,strong);container.append(div);}
 }
 function addCells(row,values){for(const value of values)row.append(make('td',value));}
 function history(s){
  const box=$('weekly-close-history-content');box.replaceChildren();
  if(!s.weeks.length){box.append(make('p','لا توجد أسابيع مقفلة بعد.'));return;}
  for(const w of [...s.weeks].reverse()){
   const d=make('details');d.className='card';
   const summary=make('summary','الأسبوع '+w.start+' إلى '+w.end+' · '+fmt(w.totals.gross)+' ₪ إجمالي أجور · إقفال '+w.paidOn);
   const info=make('p','سجلات محفوظة: '+w.attendance.length+' وردية و'+w.transactions.length+' حركة مالية. تم الاعتماد بواسطة '+w.actor+'.');
   const wrap=make('div');wrap.className='overflow';const table=make('table'),head=make('thead'),headRow=make('tr');
   addCells(headRow,['الموظف','الأجر ₪','السحوبات ₪','المدفوع السابق ₪','دفعة الإقفال ₪']);
   head.append(headRow);const body=make('tbody');
   for(const r of w.rows){const tr=make('tr');addCells(tr,[r.name,fmt(r.gross),fmt(r.withdrawals),fmt(r.paid),fmt(r.paidAtClose)]);body.append(tr);}
   table.append(head,body);wrap.append(table);d.append(summary,info,wrap);box.append(d);
  }
 }
 function render(){
  if(pending)return;
  const btn=$('weekly-close-action'),error=$('weekly-close-error');
  error.hidden=true;invalid=false;btn.disabled=true;
  try{
   const s=state(),p=current(s),first=C.add(p.start,7),eligible=today()>=first;
   $('weekly-close-period').textContent='الأسبوع الجاري: '+p.start+' — '+p.end+
    ' (7 أيام). '+(eligible?'✓ اكتملت الأيام السبعة. يمكنك الإقفال بعد التأكد من الدفع.':
    'موعد الإقفال ابتداءً من '+first+'.');
   stats($('weekly-close-totals'),[['الأجر الإجمالي',fmt(p.totals.gross)+' ₪'],
    ['السحوبات',fmt(p.totals.withdrawals)+' ₪'],['دفعات مسجلة',fmt(p.totals.paid)+' ₪'],
    ['المتبقي للدفع',fmt(p.totals.due)+' ₪']]);
   const tbody=$('weekly-close-rows');tbody.replaceChildren();
   for(const r of p.rows){const tr=make('tr');addCells(tr,[r.name,r.shifts,fmt(r.gross),fmt(r.withdrawals),fmt(r.paid),fmt(r.remaining)]);tbody.append(tr);}
   if(p.overpaid.length){error.hidden=false;error.textContent='يجب مراجعة دفعات تتجاوز الأجور قبل الإقفال: '+p.overpaid.join('، ');}
   const date=$('weekly-close-paid-on').value;
   btn.disabled=!eligible||!!p.overpaid.length||!$('weekly-close-paid-check').checked||
    C.day(date)===null||date<p.start||date>today();
   history(s);
  }catch(e){invalid=true;error.hidden=false;error.textContent=e.message;btn.disabled=true;}
 }
 $('weekly-close-paid-check').addEventListener('change',render);
 $('weekly-close-paid-on').addEventListener('change',render);
 for(const event of ['rawaa:attendance-changed','rawaa:finance-changed','rawaa:staff-changed'])
  document.addEventListener(event,render);
 $('weekly-close-refresh').addEventListener('click',()=>location.reload());
 function observeSync(){
  const bar=$('cloud-control-bar'),message=$('weekly-close-message');
  if(!bar){message.textContent='تم التغيير في مساحة العمل. حدّث الصفحة فقط بعد التأكد من حالة المزامنة السحابية.';return;}
  let done=false;
  const check=()=>{
   const text=bar.textContent||'';
   if(/محفوظ ومتزامن/.test(text)){done=true;observer.disconnect();message.textContent='✓ تم حفظ إقفال الأسبوع ومزامنته مع السحابة. اضغط «تحديث الحسابات بعد الحفظ» لبدء الأسبوع الجديد.';$('weekly-close-refresh').hidden=false;}
   else if(/توقفت مزامنة|تعارض تحديث|لم يتم اعتماد/.test(text)){observer.disconnect();message.textContent='لم نتمكن من تأكيد المزامنة. لا تعِد الإقفال؛ استخدم خيار الطوارئ في تنبيه السحابة.';}
  };
  const observer=new MutationObserver(check);observer.observe(bar,{subtree:true,childList:true,characterData:true});
  check();
 }
 $('weekly-close-action').addEventListener('click',()=>{
  if(pending||invalid)return;
  const message=$('weekly-close-message');
  const button=$('weekly-close-action');button.disabled=true;
  try{
   const s=state(),fresh={state:s,today:today(),paidOn:$('weekly-close-paid-on').value,
    confirmed:$('weekly-close-paid-check').checked,actor:window.RAWAA_CLOUD_WORKSPACE.actorEmail,
    staff:S.getAll(),attendance:A.getEntries(),calculated:A.getCalculated(),transactions:F.getTransactions()};
   const preview=C.inspect({...fresh,start:s.nextStart});
   if(!confirm('تأكيد استلام ودفع جميع الرواتب؟\nالفترة: '+preview.start+' إلى '+preview.end+
    '\nالمبلغ المتبقي الذي سيُسجل كمدفوع: '+fmt(preview.totals.due)+' ₪'+
    '\nسيُحفظ أرشيف كامل، وتبدأ الفترة الجديدة بعد هذا الأسبوع. لا يمكنك التراجع إلا باستعادة سجل محفوظ.')){render();return;}
   const result=C.plan(fresh);
   const old={archive:localStorage.getItem(KEY),attendance:localStorage.getItem(ATT),finance:localStorage.getItem(FIN)};
   const next={archive:JSON.stringify(result.next),attendance:JSON.stringify(result.remainingAttendance),
    finance:JSON.stringify(result.remainingTransactions)};
   const snapshot=localStorage._snapshot?.()||{};
   const proposed={...snapshot,[KEY]:next.archive,[ATT]:next.attendance,[FIN]:next.finance};
   if(next.archive.length>2900000||JSON.stringify(proposed).length>3400000)
    throw Error('الأرشيف كبير ويقترب من حد التخزين السحابي. نزّل نسخة مشفرة قبل طلب توسيع السعة.');
   try{
    localStorage.setItem(KEY,next.archive);
    localStorage.setItem(ATT,next.attendance);
    localStorage.setItem(FIN,next.finance);
   }catch(e){
    for(const [k,v]of [[KEY,old.archive],[ATT,old.attendance],[FIN,old.finance]]){
     try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(_){}
    }
    throw Error('فشل حفظ الإقفال؛ حاول مراجعة اتصال المتصفح.');
   }
   pending=true;
   message.textContent='تم تجهيز الإقفال في حسابك؛ جارٍ حفظ الأرشيف والتصفير على السحابة، لا تغلق الصفحة.';
   observeSync();
  }catch(e){message.textContent='لم يتم الإقفال: '+e.message;render();}
 });
 render();
})();
