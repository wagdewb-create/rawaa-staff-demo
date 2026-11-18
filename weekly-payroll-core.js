/* RAWAA weekly payroll: pure reconciliation and archival planning, no automatic writes. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.RAWAA_WEEKLY_PAYROLL_CORE=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
 function day(s){
  if(typeof s!=='string'||!/^\d{4}-\d\d-\d\d$/.test(s))return null;
  const n=Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10));
  if(new Date(n).toISOString().slice(0,10)!==s)return null;
  return n;
 }
 function add(s,days){
  const n=day(s);
  if(n===null||!Number.isInteger(days)||Math.abs(days)>365000)throw Error('تاريخ الأسبوع غير صالح.');
  return new Date(n+days*86400000).toISOString().slice(0,10);
 }
 function readState(raw,defaultStart){
  if(!raw)return {version:1,nextStart:defaultStart,weeks:[]};
  let s;
  try{s=JSON.parse(raw);}catch(_){throw Error('أرشيف الإقفال الأسبوعي تالف؛ لم تُعدّل البيانات.');}
  if(!s||s.version!==1||day(s.nextStart)===null||!Array.isArray(s.weeks)||s.weeks.length>520)
   throw Error('تنسيق أرشيف الإقفال غير صالح؛ لم تُعدّل البيانات.');
  const starts=new Set();
  for(const w of s.weeks){
   if(!w||day(w.start)===null||w.end!==add(w.start,6)||starts.has(w.start)||
     !Array.isArray(w.attendance)||!Array.isArray(w.transactions)||!Array.isArray(w.rows))
    throw Error('وجدنا أسبوعًا غير صالح في أرشيف الرواتب.');
   starts.add(w.start);
  }
  if(s.weeks.length&&s.nextStart!==add(s.weeks[s.weeks.length-1].end,1))
   throw Error('التسلسل الأسبوعي غير متصل؛ أوقفنا الإقفال لحماية الأرشيف.');
  return s;
 }
 function inspect(args){
  const {start,staff,attendance,calculated,transactions}=args||{};
  if(day(start)===null||!Array.isArray(staff)||!Array.isArray(attendance)||
    !Array.isArray(calculated)||!Array.isArray(transactions))
   throw Error('لا يمكن قراءة بيانات الدوام والرواتب بأمان.');
  const end=add(start,6),known=new Map(staff.map(s=>[s.id,s]));
  if(known.size!==staff.length||!staff.length)throw Error('قائمة الموظفين غير صالحة.');
  const before=v=>typeof v.date!=='string'||day(v.date)===null||v.date<start;
  if(attendance.some(before)||transactions.some(before))
   throw Error('توجد سجلات أقدم من بداية الأسبوع المفتوح. راجعها قبل أي تصفير.');
  const thisAttendance=attendance.filter(r=>r.date<=end);
  const thisTransactions=transactions.filter(t=>t.date<=end);
  const laterAttendance=attendance.filter(r=>r.date>end);
  const laterTransactions=transactions.filter(t=>t.date>end);
  if([...thisAttendance,...thisTransactions].some(x=>!known.has(x.employeeId)))
   throw Error('توجد سجلات لموظف لم يعد موجودًا؛ لا يمكن إخفاؤها.');
  const calculatedMap=new Map(calculated.map(r=>[r.id,r]));
  const rows=staff.map(s=>({id:s.id,name:s.name,shifts:0,gross:0,withdrawals:0,paid:0,remaining:0}));
  const byId=new Map(rows.map(r=>[r.id,r]));
  for(const entry of thisAttendance){
   const r=calculatedMap.get(entry.id);
   if(!r||r.date!==entry.date||r.employeeId!==entry.employeeId||!Number.isFinite(r.wage)||r.wage<0)
    throw Error('تعذر مطابقة وردية محفوظة مع حساب أجرها؛ لم تُحذف أي بيانات.');
   const target=byId.get(entry.employeeId);target.shifts++;target.gross+=r.wage;
  }
  for(const t of thisTransactions){
   if(!['withdrawal','payment'].includes(t.type)||!Number.isFinite(t.amount)||t.amount<=0)
    throw Error('توجد حركة مالية غير صالحة؛ راجعها قبل الإقفال.');
   const target=byId.get(t.employeeId);
   target[t.type==='withdrawal'?'withdrawals':'paid']+=t.amount;
  }
  let totalGross=0,totalWithdrawals=0,totalPaid=0,totalDue=0;
  for(const r of rows){
   r.gross=money(r.gross);r.withdrawals=money(r.withdrawals);r.paid=money(r.paid);
   r.remaining=money(r.gross-r.withdrawals-r.paid);
   totalGross+=r.gross;totalWithdrawals+=r.withdrawals;totalPaid+=r.paid;
   totalDue+=Math.max(0,r.remaining);
  }
  return {start,end,rows,attendance:thisAttendance,transactions:thisTransactions,
   laterAttendance,laterTransactions,
   totals:{gross:money(totalGross),withdrawals:money(totalWithdrawals),paid:money(totalPaid),due:money(totalDue)},
   overpaid:rows.filter(r=>r.remaining<-.009).map(r=>r.name)};
 }
 function plan(args){
  const {state,today,paidOn,confirmed,actor}=args;
  const p=inspect({...args,start:state.nextStart});
  if(day(today)===null||today<=p.end)throw Error('لم تكتمل الأيام السبعة بعد؛ لا يمكن إقفال الأسبوع مبكرًا.');
  if(day(paidOn)===null||paidOn<state.nextStart||paidOn>today)
   throw Error('تاريخ الدفع يجب أن يكون بين بداية الأسبوع واليوم الحالي.');
  if(!confirmed)throw Error('يجب تأكيد دفع جميع المستحقات قبل التصفير.');
  if(p.overpaid.length)throw Error('هناك مبالغ مدفوعة أكثر من المستحق: '+p.overpaid.join('، ')+'. راجعها قبل الإقفال.');
  if(state.weeks.length>=520)throw Error('أرشيف الأسابيع ممتلئ؛ يلزم تصديره قبل الإقفال.');
  const payments=p.rows.filter(r=>r.remaining>.009).map((r,i)=>({
   id:'fin-wclose-'+p.start.replace(/-/g,'')+'-'+i+'-'+Math.random().toString(36).slice(2,9),
   employeeId:r.id,type:'payment',date:paidOn,amount:r.remaining,
   note:'تسوية أسبوع '+p.start+' إلى '+p.end+' بعد تأكيد المدير'
  }));
  const ids=new Set([...args.transactions.map(t=>t.id),...payments.map(t=>t.id)]);
  if(ids.size!==args.transactions.length+payments.length)throw Error('معرف دفعة متكرر.');
  const record={start:p.start,end:p.end,paidOn,closedAt:new Date().toISOString(),
   actor:String(actor||'مدير رواء').slice(0,110),rows:p.rows.map(r=>({...r,paidAtClose:r.remaining})),
   totals:p.totals,staff:JSON.parse(JSON.stringify(args.staff)),
   attendance:JSON.parse(JSON.stringify(p.attendance)),
   transactions:JSON.parse(JSON.stringify([...p.transactions,...payments]))
  };
  const next={version:1,nextStart:add(p.end,1),weeks:[...state.weeks,record]};
  return {next,record,remainingAttendance:p.laterAttendance,remainingTransactions:p.laterTransactions,payments};
 }
 return {money,day,add,readState,inspect,plan};
});
