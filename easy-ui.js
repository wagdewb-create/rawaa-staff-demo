/* RAWAA Cloud 2.15: responsive desktop sidebar and iPhone simple navigation.
 * Pure presentation: no Neon writes, local payroll mutations or auth changes. */
(()=>{
 'use strict';
 const main=document.querySelector('main');
 const nav=document.querySelector('nav[aria-label="أقسام رواء"]');
 if(!main||!nav||document.getElementById('rawaa-easy-toolbar'))return;
 const sections=[...main.querySelectorAll(':scope > section[id]')];
 const ids=new Set(sections.map(section=>section.id));
 const links=[...nav.querySelectorAll('a[href^="#"]')].filter(a=>ids.has(a.hash.slice(1)));
 const sessionKey='rawaa_ui_display_mode_v215';
 const $=id=>document.getElementById(id);
 const make=(tag,text,className)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
 };
 const meta=[
  ['dashboard','الرئيسية','⌂','ملخص سريع عن المطعم'],
  ['employees','الموظفون','♙','الأسماء والساعة والحالة'],
  ['attendance','تسجيل الدوام','◷','الحضور والانصراف'],
  ['bulk-attendance','الدوام الجماعي','▦','تسجيل أكثر من موظف'],
  ['shift-planner','تخطيط الورديات','▤','جدول أسبوعي مرن'],
  ['daily-operations','متابعة دوام اليوم','◷','حالات ورديات اليوم للمراجعة'],
  ['monthly-ledger','الحساب الشهري','₪','الراتب والسحوبات'],
  ['payroll-review','مراجعة الرواتب','✓','مراجعة قبل الصرف'],
  ['payslip','قسيمة الراتب','▧','كشف لكل موظف'],
  ['daily-report','تقرير اليوم','◴','ورديات وتكاليف اليوم'],
  ['annual-report','التقرير السنوي','▣','ملخص السنة'],
  ['attendance-log','سجل الحضور','≡','كل ورديات الموظفين'],
  ['payments','الدفعات','₪','المبالغ المدفوعة'],
  ['payroll','الأجور','◈','الرواتب من الدوام'],
  ['weekly-report','التقرير الأسبوعي','▤','مراجعة الدوام'],
  ['calculator','الحاسبة','÷','حساب الراتب']
 ];
 const names=new Map(meta.map(x=>[x[0],x[1]]));
 const safeSection=()=> {
  let target='';
  try{target=decodeURIComponent(location.hash.slice(1));}catch(_){}
  return ids.has(target)?target:'dashboard';
 };
 let view='easy';
 try{if(sessionStorage.getItem(sessionKey)==='full')view='full';}catch(_){}
 let selected=safeSection(),sheetOpen=false,lastFocus=null;
 const toolbar=make('div',undefined,'rawaa-easy-toolbar');toolbar.id='rawaa-easy-toolbar';
 const crumb=make('div',undefined,'rawaa-easy-crumb');
 const eyebrow=make('small','RAWAA · لوحة إدارة المطعم');
 const title=make('strong','الرئيسية');title.id='rawaa-easy-current-title';
 crumb.append(eyebrow,title);
 const actions=make('div',undefined,'rawaa-easy-toolbar-actions');
 const full=make('button','عرض كل الأقسام','rawaa-easy-switch');
 full.type='button';full.id='rawaa-view-toggle';full.setAttribute('aria-pressed','true');
 actions.append(full);toolbar.append(crumb,actions);
 main.insertBefore(toolbar,main.firstChild);
 const dashboard=make('section',undefined,'rawaa-easy-home');
 dashboard.id='rawaa-easy-home';dashboard.setAttribute('aria-label','الاختصارات');
 const intro=make('div',undefined,'rawaa-easy-hero');
 const head=make('h2','كل ما تحتاجه لإدارة رواء');
 const hint=make('p','اختر القسم مباشرة. جميع التغييرات تحفظ داخل حساب RAWAA نفسه، سواء فتحت البرنامج من الآيفون أو الحاسوب.');
 intro.append(head,hint);
 const overview=make('div',undefined,'rawaa-easy-overview');overview.id='rawaa-easy-overview';
 const shortcuts=make('div',undefined,'rawaa-easy-shortcuts');
 shortcuts.id='rawaa-easy-shortcuts';
 const quickIds=['daily-operations','employees','attendance','shift-planner','monthly-ledger','bulk-attendance','payroll-review','payslip','daily-report'];
 for(const id of quickIds){
  const row=meta.find(x=>x[0]===id),a=make('a',undefined,'rawaa-easy-shortcut');
  a.href='#'+id;a.dataset.easyTarget=id;
  const icon=make('span',row[2],'rawaa-easy-shortcut-icon');
  icon.setAttribute('aria-hidden','true');
  const content=make('span',undefined,'rawaa-easy-shortcut-copy');
  content.append(make('strong',row[1]),make('small',row[3]));
  a.append(icon,content);shortcuts.append(a);
 }
 dashboard.append(intro,overview,make('h3','الأقسام الأساسية'),shortcuts);
 main.insertBefore(dashboard,toolbar.nextSibling);
 // The desktop sidebar reuses the original navigation links.
 const searchWrapper=make('label',undefined,'rawaa-easy-nav-search');
 searchWrapper.append(make('span','البحث عن قسم'));
 const search=make('input');search.type='search';search.id='rawaa-easy-nav-search';search.placeholder='مثل: الرواتب أو الدوام';search.autocomplete='off';
 searchWrapper.append(search);nav.insertBefore(searchWrapper,nav.firstChild);
 const bottom=make('div',undefined,'rawaa-easy-mobile-tabs');bottom.id='rawaa-mobile-tabs';
 bottom.setAttribute('aria-label','التنقل السريع');
 const bottomItems=[['dashboard','الرئيسية','⌂'],['daily-operations','اليوم','◷'],['employees','الموظفون','♙'],['monthly-ledger','الرواتب','₪']];
 for(const [id,label,symbol] of bottomItems){
  const a=make('a',undefined,'rawaa-easy-tab');a.href='#'+id;a.dataset.easyTarget=id;
  a.append(make('span',symbol),make('small',label));bottom.append(a);
 }
 const more=make('button',undefined,'rawaa-easy-tab');more.type='button';more.id='rawaa-mobile-more';
 more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','rawaa-easy-more-dialog');
 more.append(make('span','☷'),make('small','المزيد'));bottom.append(more);
 document.body.append(bottom);
 const backdrop=make('div',undefined,'rawaa-easy-backdrop');backdrop.id='rawaa-easy-backdrop';backdrop.hidden=true;
 const sheet=make('div',undefined,'rawaa-easy-sheet');sheet.id='rawaa-easy-more-dialog';
 sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
 sheet.setAttribute('aria-label','كل أقسام RAWAA');sheet.hidden=true;
 const header=make('div',undefined,'rawaa-easy-sheet-header');
 header.append(make('strong','كل أقسام البرنامج'));
 const close=make('button','إغلاق ×','rawaa-easy-close');close.type='button';close.id='rawaa-easy-close';
 header.append(close);sheet.append(header);
 const pickerSearch=make('input');pickerSearch.type='search';pickerSearch.id='rawaa-easy-picker-search';
 pickerSearch.placeholder='ابحث عن القسم';pickerSearch.setAttribute('aria-label','بحث في الأقسام');
 sheet.append(pickerSearch);
 const pickerLinks=make('div',undefined,'rawaa-easy-picker-links');
 pickerLinks.id='rawaa-easy-picker-links';
 const orderedIds=meta.map(x=>x[0]).filter(id=>ids.has(id));
 for(const id of orderedIds){
  const a=make('a',names.get(id),'rawaa-easy-picker-item');
  a.href='#'+id;a.dataset.easyTarget=id;pickerLinks.append(a);
 }
 sheet.append(pickerLinks);document.body.append(backdrop,sheet);
 function metric(name,value){
  const cell=make('div',undefined,'rawaa-easy-metric');
  cell.append(make('small',name),make('strong',value));return cell;
 }
 function format(value){return Number(value||0).toLocaleString('ar-PS',{maximumFractionDigits:2});}
 function refreshOverview(){
  overview.replaceChildren();
  if(window.RAWAA_CLOUD_WORKSPACE?.isNewEmptyWorkspace){
   const info=make('p','الحساب الحالي جديد ولم تُستعد بيانات الموظفين بعد. أكّد البريد واستعد النسخة المشفّرة قبل بدء العمل.','rawaa-easy-empty');
   overview.append(info);return;
  }
  const staff=window.RAWAA_STAFF?.getAll?.()||[];
  const current=window.RAWAA_RESTAURANT_TODAY?.()||new Date().toISOString().slice(0,10);
  const month=current.slice(0,7);
  const attendance=window.RAWAA_ATTENDANCE_BRIDGE?.getCalculated?.()||[];
  const entries=attendance.filter(row=>row.date===current);
  const salary=window.RAWAA_FINANCE_TEST?.sumMonthly;
  let total=0;
  if(typeof salary==='function'){
   for(const person of staff){
    const value=salary(person.id,month);
    total+=Number(value?.remaining||0);
   }
  }
  overview.append(
   metric('موظفون نشطون',format(staff.filter(x=>x.status==='active').length)),
   metric('ورديات اليوم المسجلة',format(entries.length)),
   metric('ساعات اليوم المسجلة',format(entries.reduce((a,x)=>a+Number(x.duration||0),0))),
   metric('متبقي الرواتب هذا الشهر',format(total)+' ₪')
  );
  const note=make('p','المؤشرات مأخوذة من السجلات الموجودة في الحساب المفتوح؛ عدم تسجيل دوام لا يعني الغياب.','rawaa-easy-data-note');
  overview.append(note);
 }
 function setActive(){
  for(const section of sections)section.classList.toggle('rawaa-section-active',section.id===selected);
  for(const a of [...links,...bottom.querySelectorAll('a'),...pickerLinks.querySelectorAll('a')]){
   const active=a.getAttribute('href')==='#'+selected;
   a.classList.toggle('rawaa-easy-selected',active);
   if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  }
  title.textContent=names.get(selected)||sections.find(x=>x.id===selected)?.querySelector('h2')?.textContent||'الرئيسية';
  dashboard.hidden=view!=='easy'||selected!=='dashboard';
  if(view==='easy'&&selected==='dashboard')refreshOverview();
 }
 function setMode(next,persist=true){
  view=next==='full'?'full':'easy';
  document.body.classList.toggle('rawaa-easy-view',view==='easy');
  document.body.classList.toggle('rawaa-all-view',view==='full');
  full.textContent=view==='easy'?'عرض كل الأقسام':'العودة للعرض المبسط';
  full.setAttribute('aria-pressed',String(view==='easy'));
  if(persist)try{sessionStorage.setItem(sessionKey,view);}catch(_){}
  closeSheet();setActive();
  if(view==='easy')window.scrollTo(0,0);
 }
 function selectSection(id){
  if(!ids.has(id))return;
  selected=id;closeSheet();setActive();
  if(view==='easy')window.scrollTo(0,0);
 }
 function goto(id){
  if(!ids.has(id))return;
  if(location.hash!=='#'+id)location.hash=id;
  selectSection(id);
 }
 function closeSheet(){
  if(!sheetOpen)return;
  sheetOpen=false;sheet.hidden=true;backdrop.hidden=true;more.setAttribute('aria-expanded','false');
  document.body.classList.remove('rawaa-easy-sheet-open');
  if(lastFocus?.isConnected)lastFocus.focus();lastFocus=null;
 }
 function openSheet(){
  if(view!=='easy'||sheetOpen)return;
  sheetOpen=true;lastFocus=document.activeElement;pickerSearch.value='';
  for(const link of pickerLinks.children)link.hidden=false;
  sheet.hidden=false;backdrop.hidden=false;more.setAttribute('aria-expanded','true');
  document.body.classList.add('rawaa-easy-sheet-open');
  pickerSearch.focus();
 }
 search.addEventListener('input',()=>{
  const q=search.value.trim().toLocaleLowerCase('ar');
  for(const link of links)link.hidden=!!q&&!link.textContent.toLocaleLowerCase('ar').includes(q);
 });
 pickerSearch.addEventListener('input',()=>{
  const q=pickerSearch.value.trim().toLocaleLowerCase('ar');
  for(const link of pickerLinks.children)link.hidden=!!q&&!link.textContent.toLocaleLowerCase('ar').includes(q);
 });
 full.addEventListener('click',()=>setMode(view==='easy'?'full':'easy'));
 more.addEventListener('click',openSheet);
 close.addEventListener('click',closeSheet);
 backdrop.addEventListener('click',closeSheet);
 document.addEventListener('keydown',event=>{
  if(!sheetOpen)return;
  if(event.key==='Escape'){event.preventDefault();closeSheet();}
  if(event.key==='Tab'){
   const focusables=[pickerSearch,...pickerLinks.querySelectorAll('a:not([hidden])'),close];
   const i=focusables.indexOf(document.activeElement);
   if(event.shiftKey&&i===0){event.preventDefault();close.focus();}
   else if(!event.shiftKey&&i===focusables.length-1){event.preventDefault();pickerSearch.focus();}
  }
 });
 function handleInternalLink(event){
  const a=event.target.closest('a[href^="#"]');
  if(!a||!a.hash)return;
  const id=a.hash.slice(1);if(!ids.has(id))return;
  if(view==='easy'){
   event.preventDefault();goto(id);
  }else closeSheet();
 }
 document.addEventListener('click',handleInternalLink);
 window.addEventListener('hashchange',()=>{if(view==='easy')selectSection(safeSection());});
 for(const event of ['rawaa:staff-changed','rawaa:attendance-changed','rawaa:finance-changed']){
  document.addEventListener(event,()=>{if(view==='easy'&&selected==='dashboard')refreshOverview();});
 }
 setMode(view,false);
 window.RAWAA_EASY_UI_TEST={getMode:()=>view,getSection:()=>selected,goTo:goto,setMode,refreshOverview};
})();
