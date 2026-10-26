(()=>{'use strict';
const KEY='RAWAA_DEMO_STAFF_V19', MAX=100;
const seeded=()=>[
{id:'001',name:'موظف تجريبي 01',role:'الخدمة',rate:18,phone:'',startDate:'',note:'',status:'active',avatar:'01',basic:160,overtime:16,withdrawal:200,paid:1500},
{id:'002',name:'موظف تجريبي 02',role:'المطبخ',rate:20,phone:'',startDate:'',note:'',status:'active',avatar:'02',basic:160,overtime:0,withdrawal:300,paid:2900},
{id:'003',name:'موظف تجريبي 03',role:'الاستقبال',rate:17,phone:'',startDate:'',note:'',status:'active',avatar:'03',basic:120,overtime:10,withdrawal:100,paid:1000}
];
const staff=seeded();let editId=null;
const normalizedName=value=>String(value??'').trim().replace(/\s+/g,' ');
const nameKey=value=>normalizedName(value).normalize('NFKC').toLowerCase();
const $=id=>document.getElementById(id);
const hasDate=d=>!d||(/^\d{4}-\d\d-\d\d$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
const clean=p=>({id:String(p.id),name:p.name.trim(),role:p.role.trim(),rate:Number(p.rate),phone:p.phone.trim(),startDate:p.startDate||'',note:p.note.trim(),status:p.status,avatar:p.avatar||'☾',basic:Number(p.basic)||0,overtime:Number(p.overtime)||0,withdrawal:Number(p.withdrawal)||0,paid:Number(p.paid)||0});
function validateRoster(list){
if(!Array.isArray(list)||list.length<1||list.length>MAX)return 'يجب أن تحتوي القائمة على موظف واحد على الأقل، بحد أقصى 100 موظف';
const ids=new Set();for(const p of list){
if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,70}$/.test(p.id)||ids.has(p.id))return 'معرف موظف غير صالح أو مكرر';
ids.add(p.id);
if(typeof p.name!=='string'||!p.name.trim()||p.name.length>65)return 'اسم الموظف غير صالح';
if(typeof p.role!=='string'||p.role.length>65)return 'القسم أو الوظيفة غير صالحة';
if(typeof p.rate!=='number'||!Number.isFinite(p.rate)||p.rate<=0||p.rate>10000)return 'أجر الساعة يجب أن يكون أكبر من صفر';
if(typeof p.phone!=='string'||p.phone.length>35)return 'رقم التواصل طويل';
if(typeof p.startDate!=='string'||!hasDate(p.startDate))return 'تاريخ المباشرة غير صالح';
if(typeof p.note!=='string'||p.note.length>200)return 'الملاحظات طويلة جدًا';
if(!['active','archived'].includes(p.status))return 'حالة الموظف غير معروفة';
if(typeof p.avatar!=='string'||p.avatar.length>6)return 'رمز الصورة غير صالح';
for(const k of ['basic','overtime','withdrawal','paid']){if(p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<0||p[k]>10000000))return 'قيمة تدريبية غير صالحة'}
}return null;
}
try{const raw=localStorage.getItem(KEY);if(raw){let list=JSON.parse(raw);if(Array.isArray(list)){
list=list.map(p=>({...p,phone:p.phone??'',startDate:p.startDate??'',note:p.note??'',status:p.status??'active',avatar:p.avatar??'☾'}));
if(!validateRoster(list))staff.splice(0,staff.length,...list.map(clean));
}}}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(staff));return true}catch(e){return false}}
function stateChange(){refreshSelectors();renderCards();document.dispatchEvent(new Event('rawaa:staff-changed'));}
function opt(p,includeRole=false){let o=document.createElement('option');o.value=p.id;o.textContent=p.name+(includeRole?' — '+p.role:'')+(p.status==='archived'?' (مؤرشف)':'');return o;}
const FILTERS=['dash-filter','att-filter','fin-filter','daily-filter','review-employee'];
function refreshSelectors(){
for(const id of [...FILTERS,'att-employee','fin-employee']){
const s=$(id);if(!s)continue;const previous=s.value;s.replaceChildren();
if(FILTERS.includes(id)){const all=document.createElement('option');all.value='all';all.textContent='جميع الموظفين';s.append(all);}
for(const p of staff){s.append(opt(p,id==='att-employee'));}
if([...s.options].some(x=>x.value===previous))s.value=previous;
}
const sel=$('selected-employee');if(sel){const old=sel.selectedIndex;sel.replaceChildren();for(let i=0;i<staff.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=staff[i].name;sel.append(o)}sel.selectedIndex=Math.min(Math.max(old,0),staff.length-1);}
}
function notice(text,isError=false){const x=$('staff-feedback');if(x){x.className=isError?'error':'result';x.textContent=text}}
function formClear(){editId=null;$('staff-form').reset();$('staff-status').value='active';$('staff-avatar').value='☾';$('staff-form-title').textContent='إضافة موظف تجريبي';$('staff-save').textContent='إضافة الموظف';$('staff-cancel').hidden=true;}
function formFill(id){
const p=staff.find(p=>p.id===id);if(!p)return;editId=id;
for(const [k,c] of [['name','name'],['role','role'],['rate','rate'],['phone','phone'],['startDate','startDate'],['note','note'],['status','status'],['avatar','avatar']])$('staff-'+k).value=p[c]??'';
$('staff-form-title').textContent='تعديل بيانات الموظف';$('staff-save').textContent='حفظ التعديلات';$('staff-cancel').hidden=false;notice('تعديل الموظف: '+p.name);
$('staff-form').scrollIntoView({behavior:'smooth',block:'center'});
}
function historyFor(id){const shifts=window.RAWAA_ATTENDANCE_BRIDGE?.getEntries?.()||[];const finance=window.RAWAA_FINANCE_TEST?.getTransactions?.()||[];return shifts.some(x=>x.employeeId===id)||finance.some(x=>x.employeeId===id)}
function renameEmployees(updates){
if(!Array.isArray(updates)||!updates.length)throw Error('حدد اسمًا واحدًا على الأقل لتعديله.');
const changes=new Map();
for(const item of updates){
 if(!item||typeof item.id!=='string'||!staff.some(p=>p.id===item.id)||changes.has(item.id)||typeof item.name!=='string')throw Error('اختيار موظف غير صالح أو مكرر.');
 const name=normalizedName(item.name);
 if(!name||name.length>65)throw Error('يجب أن يكون كل اسم من 1 إلى 65 حرفًا.');
 changes.set(item.id,name);
}
const proposed=staff.map(p=>({...p,name:changes.has(p.id)?changes.get(p.id):p.name}));
const seen=new Set();
for(const p of proposed){const key=nameKey(p.name);if(seen.has(key))throw Error('يوجد اسمان متطابقان في قائمة الموظفين: '+p.name);seen.add(key);}
const err=validateRoster(proposed);if(err)throw Error(err);
const changed=staff.filter(p=>changes.has(p.id)&&p.name!==changes.get(p.id)).length;
if(!changed)return 0;
const originals=new Map(staff.map(p=>[p.id,p.name]));
for(const p of staff)if(changes.has(p.id))p.name=changes.get(p.id);
if(!save()){for(const p of staff)p.name=originals.get(p.id);throw Error('تعذر حفظ الأسماء في متصفحك؛ لم نعتمد التغييرات.');}
stateChange();
return changed;
}
function showQuickRename(id,card){
const person=staff.find(p=>p.id===id);if(!person||!card)return;
const existing=card.querySelector('.staff-inline-rename');
if(existing){existing.querySelector('input').focus();return;}
const form=document.createElement('form');form.className='staff-inline-rename';
const label=document.createElement('label');label.textContent='الاسم الجديد';
const input=document.createElement('input');input.type='text';input.value=person.name;input.maxLength=65;input.required=true;input.autocomplete='off';input.setAttribute('aria-label','تغيير اسم '+person.name);
const actions=document.createElement('div');actions.className='staff-inline-actions';
const saveButton=document.createElement('button');saveButton.type='submit';saveButton.className='primary';saveButton.textContent='حفظ الاسم';
const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.className='outline';cancelButton.textContent='إلغاء';
cancelButton.addEventListener('click',()=>form.remove());
label.append(input);actions.append(saveButton,cancelButton);form.append(label,actions);card.append(form);
form.addEventListener('submit',e=>{e.preventDefault();try{
 const changed=renameEmployees([{id,name:input.value}]);if(!changed)form.remove();
 notice(changed?'تم تغيير الاسم إلى '+normalizedName(input.value)+' مع الحفاظ على جميع السجلات.':'الاسم لم يتغير.');
}catch(error){notice(error.message,true);input.focus();}});
input.focus();input.select();
}
function setupBulkRename(){
const host=$('staff-manager');if(!host)return;
const box=document.createElement('div');box.className='staff-bulk-rename';
const toggle=document.createElement('button');toggle.type='button';toggle.className='outline';toggle.id='staff-bulk-toggle';toggle.textContent='تعديل أسماء جميع الموظفين';toggle.setAttribute('aria-expanded','false');
const hint=document.createElement('p');hint.className='hint';hint.textContent='يشمل الموظفين الحاليين والمؤرشفين والجدد. الأسماء فقط تتغير، بينما تبقى سجلات الدوام والرواتب والسحوبات مرتبطة بالمعرّف نفسه.';
const form=document.createElement('form');form.id='staff-bulk-form';form.hidden=true;
const fields=document.createElement('div');fields.className='staff-bulk-fields';
const buttons=document.createElement('div');buttons.className='staff-manage-actions';
const submit=document.createElement('button');submit.className='primary';submit.type='submit';submit.textContent='حفظ الأسماء';
const cancel=document.createElement('button');cancel.className='outline';cancel.type='button';cancel.textContent='إلغاء';
cancel.addEventListener('click',()=>setOpen(false));
buttons.append(submit,cancel);form.append(fields,buttons);box.append(toggle,hint,form);host.append(box);
function fill(){
 const drafts=new Map([...fields.querySelectorAll('input[data-rename-id]')].map(e=>[e.dataset.renameId,e.value]));
 fields.replaceChildren();
 for(const p of staff){
  const label=document.createElement('label');label.className='staff-bulk-label';
  const caption=document.createElement('span');caption.textContent=p.name+(p.status==='archived'?' (مؤرشف)':'');
  const input=document.createElement('input');input.type='text';input.maxLength=65;input.required=true;input.autocomplete='off';input.dataset.renameId=p.id;input.value=drafts.has(p.id)?drafts.get(p.id):p.name;
  label.append(caption,input);fields.append(label);
 }
}
function setOpen(open){form.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'إخفاء تعديل الأسماء':'تعديل أسماء جميع الموظفين';if(open)fill();else fields.replaceChildren();}
toggle.addEventListener('click',()=>setOpen(form.hidden));
form.addEventListener('submit',e=>{e.preventDefault();try{
 const updates=[...fields.querySelectorAll('input[data-rename-id]')].map(e=>({id:e.dataset.renameId,name:e.value}));
 const changed=renameEmployees(updates);setOpen(false);
 notice(changed?'تم حفظ '+changed+' اسمًا بنجاح، مع بقاء السجلات محفوظة.':'لم تتغير أي أسماء.');
}catch(error){notice(error.message,true);}});
document.addEventListener('rawaa:staff-changed',()=>{if(!form.hidden)fill();});
}
function renderCards(){
const c=$('staff-manage-cards');if(!c)return;c.replaceChildren();for(const p of staff){
const card=document.createElement('article');card.className='staff-manage-card';
const avatar=document.createElement('div');avatar.className='staff-symbol';avatar.textContent=p.avatar;
const details=document.createElement('div');details.className='staff-details';
const name=document.createElement('strong');name.textContent=p.name;
const meta=document.createElement('small');meta.textContent=(p.role||'بدون قسم')+' · '+p.rate+' ₪/ساعة · '+(p.status==='archived'?'مؤرشف':'نشط');
details.append(name,meta);if(p.phone){const extra=document.createElement('small');extra.textContent='اتصال تجريبي: '+p.phone;details.append(extra)}
const rename=document.createElement('button');rename.type='button';rename.className='outline';rename.textContent='تغيير الاسم';rename.dataset.renameStaff=p.id;
const edit=document.createElement('button');edit.type='button';edit.className='outline';edit.textContent='تعديل';edit.dataset.editStaff=p.id;
const archive=document.createElement('button');archive.type='button';archive.className='outline';archive.textContent=p.status==='archived'?'إعادة تفعيل':'أرشفة';archive.dataset.toggleStaff=p.id;
const remove=document.createElement('button');remove.type='button';remove.className='outline';remove.textContent='حذف';remove.dataset.deleteStaff=p.id;
card.append(avatar,details,rename,edit,archive,remove);c.append(card);
}}
function replaceRoster(rows,{silent=false}={}){const err=validateRoster(rows);if(err)throw Error(err);staff.splice(0,staff.length,...rows.map(clean));save();if(!silent)stateChange();}
$('staff-form').addEventListener('submit',e=>{
e.preventDefault();const previous=staff.find(p=>p.id===editId);
const raw={id:editId||('demo-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)),name:$('staff-name').value,role:$('staff-role').value,rate:Number($('staff-rate').value),phone:$('staff-phone').value,startDate:$('staff-startDate').value,note:$('staff-note').value,status:$('staff-status').value,avatar:$('staff-avatar').value,basic:previous?.basic||0,overtime:previous?.overtime||0,withdrawal:previous?.withdrawal||0,paid:previous?.paid||0};
if($('staff-rate').value.trim()===''){notice('سعر الساعة مطلوب',true);return}
const p=clean(raw);const proposed=editId?staff.map(x=>x.id===editId?p:x):[...staff,p],err=validateRoster(proposed);
if(err){notice(err,true);return}if(staff.some(x=>x.id!==editId&&nameKey(x.name)===nameKey(p.name))){notice('اسم الموظف موجود مسبقًا',true);return}
const before=staff.map(x=>({...x}));
if(editId){const at=staff.findIndex(x=>x.id===editId);staff.splice(at,1,p)}else staff.push(p);
const wasEditing=Boolean(editId);if(!save()){staff.splice(0,staff.length,...before);notice('تعذر حفظ البيانات على هذا الجهاز؛ لم نعتمد التعديل.',true);return;}
formClear();stateChange();notice(wasEditing?'تم تعديل بيانات الموظف وحفظها على هذا الجهاز.':'تمت إضافة الموظف وحفظه على هذا الجهاز.')});
$('staff-cancel').onclick=formClear;
$('staff-manage-cards').addEventListener('click',e=>{
const b=e.target.closest('button');if(!b)return;
if(b.dataset.renameStaff){showQuickRename(b.dataset.renameStaff,b.closest('.staff-manage-card'));return}
if(b.dataset.editStaff){formFill(b.dataset.editStaff);return}
const p=staff.find(x=>x.id===(b.dataset.toggleStaff||b.dataset.deleteStaff));if(!p)return;
if(b.dataset.toggleStaff){p.status=p.status==='active'?'archived':'active';save();stateChange();notice('تم تغيير حالة '+p.name);return}
if(b.dataset.deleteStaff){
if(historyFor(p.id)){notice('لا يمكن حذف هذا الموظف لأنه مرتبط بسجلات حضور أو معاملات. استخدم الأرشفة لحماية التاريخ.',true);return}
if(staff.length===1){notice('لا يمكن حذف آخر موظف في المعاينة.',true);return}
if(!confirm('حذف الموظف التجريبي '+p.name+'؟'))return;
staff.splice(staff.indexOf(p),1);save();if(editId===p.id)formClear();stateChange();notice('تم حذف الموظف التجريبي');
}});
setupBulkRename();refreshSelectors();renderCards();
window.RAWAA_STAFF={getAll:()=>staff,getById:id=>staff.find(p=>p.id===id),export:()=>staff.map(p=>({...p})),validateRoster,replaceRoster,renameEmployees,seeded};
})();