(()=>{'use strict';
const $=id=>document.getElementById(id),bridge=window.RAWAA_ATTENDANCE_BRIDGE;
const people=()=>window.RAWAA_STAFF?.getAll?.()||[{id:'001',name:'موظف تجريبي 01'},{id:'002',name:'موظف تجريبي 02'},{id:'003',name:'موظف تجريبي 03'}];
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
function validDay(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const y=+s.slice(0,4),m=+s.slice(5,7),d=+s.slice(8,10);const u=new Date(Date.UTC(y,m-1,d));return u.getUTCFullYear()===y&&u.getUTCMonth()+1===m&&u.getUTCDate()===d;}
function endOfWeek(s){if(!validDay(s))return null;const t=Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10));return new Date(t+6*86400000).toISOString().slice(0,10);}
function report(start,employee='all'){
 const end=endOfWeek(start);if(!end)return null;
 const all=bridge.getCalculated().filter(r=>r.date>=start&&r.date<=end);
 const members=people().filter(p=>employee==='all'||p.id===employee);
 const rows=members.map(p=>{const shifts=all.filter(s=>s.employeeId===p.id);
 const sum=key=>Math.round(shifts.reduce((v,s)=>v+Number(s[key]||0),0)*100)/100;
 return {id:p.id,name:p.name,days:new Set(shifts.map(s=>s.date)).size,shifts:shifts.length,hours:sum('duration'),base:sum('normal'),extra:sum('extra'),wage:sum('wage')};});
 return {start,end,rows};}
function cell(tr,value){const td=document.createElement('td');td.textContent=String(value);tr.append(td)}
function syncStaffFilter(){const select=$('weekly-filter'),current=select.value;select.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='جميع الموظفين';select.append(all);for(const p of people()){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option);}if([...select.options].some(o=>o.value===current))select.value=current;}
function render(){syncStaffFilter();const start=$('weekly-start').value,emp=$('weekly-filter').value,r=report(start,emp);
 const body=$('weekly-rows'),summary=$('weekly-stats');body.replaceChildren();summary.replaceChildren();
 if(!r){$('weekly-range').textContent='اختر تاريخ بداية صحيحًا.';return}
 $('weekly-range').textContent='من '+r.start+' إلى '+r.end+' (7 أيام)';
 for(const row of r.rows){const tr=document.createElement('tr');for(const v of [row.name,row.days||'لا يوجد سجل',row.shifts,fmt(row.hours),fmt(row.base),fmt(row.extra),fmt(row.wage)])cell(tr,v);body.append(tr)}
 const totals=r.rows.reduce((acc,x)=>({hours:acc.hours+x.hours,base:acc.base+x.base,extra:acc.extra+x.extra,wage:acc.wage+x.wage,shifts:acc.shifts+x.shifts}),{hours:0,base:0,extra:0,wage:0,shifts:0});
 for(const [name,value] of [['عدد الورديات',totals.shifts],['الساعات الفعلية',fmt(totals.hours)],['الإضافي',fmt(totals.extra)],['الأجور',fmt(totals.wage)+' ₪']]){
 const box=document.createElement('div');box.className='stat';const a=document.createElement('small'),b=document.createElement('strong');a.textContent=name;b.textContent=String(value);box.append(a,b);summary.append(box)}
 return r;}
function csvCell(v){const s=String(v??'');return '"'+(/^[\s]*[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"'}
function exportCsv(){const r=report($('weekly-start').value,$('weekly-filter').value);if(!r)return;
 const rows=[['الموظف','من','إلى','أيام مسجلة','الورديات','إجمالي ساعات','ساعات أساسية','ساعات إضافية','الأجر ₪'],...r.rows.map(x=>[x.name,r.start,r.end,x.days,x.shifts,fmt(x.hours),fmt(x.base),fmt(x.extra),fmt(x.wage)])];
 const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RAWAA_Week_'+r.start+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('weekly-start').addEventListener('change',render);$('weekly-filter').addEventListener('change',render);
$('weekly-export').addEventListener('click',exportCsv);document.addEventListener('rawaa:attendance-changed',render);document.addEventListener('rawaa:staff-changed',render);
render();window.RAWAA_WEEKLY_TEST={report,render,validDay,endOfWeek};
})();