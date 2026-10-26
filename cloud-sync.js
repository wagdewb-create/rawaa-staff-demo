/* RAWAA Cloud 2.0: online single-owner workspace, authenticated via Neon Auth.
   An explicit global lexical storage facade preserves legacy attendance/finance logic.
   Never expose database passwords or privileged API tokens in browser code. */
const localStorage=(()=>{
 const memory=new Map();let onChange=()=>{};
 return {
  get length(){return memory.size;},
  key(i){return [...memory.keys()][i]??null;},
  getItem(key){key=String(key);return memory.has(key)?memory.get(key):null;},
  setItem(key,v){memory.set(String(key),String(v));onChange();},
  removeItem(key){memory.delete(String(key));onChange();},
  clear(){memory.clear();onChange();},
  _load(src){memory.clear();for(const [k,v] of Object.entries(src||{}))if(typeof v==='string')memory.set(k,v);},
  _snapshot(){return Object.fromEntries(memory);},
  _observe(fn){onChange=fn;}
 };
})();
window.RAWAA_CLOUD_STORAGE=localStorage;
(()=>{
 'use strict';
 const SDK='https://esm.sh/@neondatabase/neon-js@0.9.0-beta?bundle';
 const AUTH='https://ep-red-wave-b9ap8bfz.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
 const DATA='https://ep-red-wave-b9ap8bfz.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1';
 const TABLE='rawaa_cloud_workspace_v1';
 const SELECT='owner_id,revision,payload,updated_at';
 let client=null,user=null,rev=0,queue=Promise.resolve(),localRev=0,storedRev=0,stopped=false,pulling=false,editingStarted=false;
 let syncTimer=null,pollTimer=null,status=null,head=null;let loggedIn=false;
 let lastActivity=Date.now(),hasUnsubmittedForm=false;const RELOAD_IDLE_MS=45000;
 const $=id=>document.getElementById(id);
 const safe=message=>String(message||'فشل الاتصال');
 function statusMsg(m,error=false){if(status){status.textContent=m;status.style.color=error?'#a72820':'#165d42';}}
 function item(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 function warn(text,block=false){
  statusMsg(text,true);
  if(!block)return;
  stopped=true;
  if($('cloud-sync-lock'))return;
  const overlay=item('div',undefined,'rawaa-cloud-overlay');overlay.id='cloud-sync-lock';
  const box=item('div',undefined,'rawaa-cloud-dialog');
  box.append(item('h2','توقفت مزامنة RAWAA'),item('p',text));
  const save=item('button','تنزيل نسخة طوارئ من التعديلات غير المرسلة');
  save.type='button';save.onclick=()=>download('RAWAA_Unsent_Changes_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'rawaa-cloud-emergency-v1',entries:localStorage._snapshot()},null,2));
  const retry=item('button','إعادة المحاولة');retry.type='button';retry.onclick=async()=>{overlay.remove();stopped=false;try{await checkServerVersion();schedule();}catch(e){warn('تعذر استئناف الحفظ: '+safe(e.message),true);}};
  const reload=item('button','تحميل أحدث نسخة من السحابة');reload.type='button';reload.onclick=()=>{
   if(confirm('قد تضيع المدخلات غير المحفوظة. صدّر نسخة طوارئ أولًا. متابعة؟'))location.reload();
  };
  box.append(item('p','ملف الطوارئ JSON غير مشفّر. احفظه في مكان خاص واحذفه بعد التأكد من استعادة البيانات.'));box.append(save,retry,reload);
  overlay.append(box);document.body.append(overlay);
 }
 function download(filename,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 function check(data){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>35)throw Error('تنسيق سجلات غير مقبول.');
  for(const [k,v] of Object.entries(data)){if(typeof k!=='string'||k.length>100||typeof v!=='string'||v.length>3000000)throw Error('سجلات كبيرة أو غير متوقعة.');}
  const out=JSON.stringify(data);if(out.length>3500000)throw Error('حجم البيانات يتجاوز حد التخزين السحابي.');return data;
 }
 function resultOrThrow(result){if(result.error)throw Error(result.error.message||'تعذر التواصل مع الخدمة');return result.data;}
 async function getRow(){
  const result=await client.from(TABLE).select(SELECT).eq('owner_id',user.id).maybeSingle();
  return resultOrThrow(result);
 }
 async function initialRow(){
  let row=await getRow();
  if(!row){
   const created=await client.from(TABLE).insert({owner_id:user.id,revision:0,payload:{}}).select(SELECT).single();
   if(created.error){row=await getRow();if(!row)throw Error(created.error.message);}else row=created.data;
  }
  return row;
 }
 async function checkServerVersion(){
  if(!user||pulling)return;
  const row=await getRow();if(!row)throw Error('سجل حسابك غير موجود.');
  if(Number(row.revision)!==rev)throw Error('تغيّرت بيانات السحابة من جهاز آخر. لا تحفظ فوقها؛ نزّل نسخة طوارئ أو افتح آخر تحديث.');
 }
 function schedule(){
  if(!loggedIn||stopped)return;
  localRev++;editingStarted=true;statusMsg('جارٍ رفع آخر التغييرات إلى السحابة...');
  clearTimeout(syncTimer);syncTimer=setTimeout(()=>{flush();},250);
 }
 function flush(){
  if(!loggedIn||stopped)return queue;
  queue=queue.then(async()=>{
   if(stopped||storedRev===localRev)return;
   const desired=localRev,payload=check(localStorage._snapshot());
   const result=await client.from(TABLE).update({payload,revision:rev+1,updated_at:new Date().toISOString()})
     .eq('owner_id',user.id).eq('revision',rev).select('revision').maybeSingle();
   if(result.error)throw Error(result.error.message);
   if(!result.data){throw Error('تعارض تحديث: جهاز آخر حفظ بيانات جديدة قبل هذه العملية.');}
   rev=Number(result.data.revision);storedRev=desired;
   statusMsg(storedRev===localRev?'✓ محفوظ ومتزامن مع جميع أجهزتك':'تُحفظ تغييرات إضافية...');
   if(storedRev!==localRev){setTimeout(flush,0);}
  }).catch(err=>{warn('لم يتم اعتماد بعض التغييرات على السحابة: '+safe(err.message),true);});
  return queue;
 }
 async function poll(){
  if(!loggedIn||stopped||pulling||localRev!==storedRev)return;
  pulling=true;
  try{const row=await getRow();if(row&&Number(row.revision)!==rev){
   const active=document.activeElement;
   const fieldActive=!!(active&&active.matches&&active.matches('input, textarea, select, [contenteditable="true"]'));
   const idle=!hasUnsubmittedForm&&!fieldActive&&(Date.now()-lastActivity>RELOAD_IDLE_MS||document.visibilityState==='hidden');
   if(idle){stopped=true;statusMsg('وصل تحديث من جهاز آخر؛ يجري فتح أحدث السجلات.');location.reload();return;}
   stopped=true;
   warn('وصل تحديث من جهاز آخر (نسخة '+Number(row.revision)+'). لن تُستبدل مسودتك؛ صدّر نسخة طوارئ إن لزم، ثم اختر تحميل أحدث نسخة من السحابة.',true);
  }}catch(e){statusMsg('تتعذر مراجعة تغييرات الأجهزة الأخرى حاليًا؛ تحقق من الشبكة.',true);}finally{pulling=false;}
 }
 async function loadExistingScripts(){
  const deferred=[...document.querySelectorAll('script[data-rawaa-deferred]')];
  for(const node of deferred){
    const script=document.createElement('script'),src=node.getAttribute('src');
    if(src){
     await new Promise((resolve,reject)=>{script.async=false;script.onload=resolve;script.onerror=()=>reject(Error('فشل تحميل '+src));script.src=src;document.body.append(script);});
    }else{script.textContent=node.textContent;document.body.append(script);}
  }
 }
 async function importOldVault(){
  if(!confirm('سيتم قراءة سجلات وضع العمل المشفّر السابق من هذا الجهاز فقط. لن تتغير بيانات السحابة إلا بعد موافقتك. متابعة؟'))return;
  try{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('RAWAA_Work_Encrypted_v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   if(!db.objectStoreNames.contains('vaults'))throw Error('لم يتم العثور على خزنة العمل السابقة.');
   const vault=await new Promise((resolve,reject)=>{const r=db.transaction('vaults','readonly').objectStore('vaults').get('main');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   db.close();if(!vault||vault.format!=='RAWAA_WORK_AES256_GCM_V1')throw Error('لا توجد خزنة مشفرة صالحة على هذا الجهاز.');
   if(localRev!==storedRev||rev!==0)throw Error('السجل السحابي يحتوي تعديلات؛ لن نستبدلها تلقائيًا. استخدم نسخة احتياطية قبل الدمج.');
   const password=prompt('كلمة مرور مساحة العمل المحلية المشفرة السابقة:');if(password===null)return;
   const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const encoder=new TextEncoder();
   const raw=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
   const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(vault.salt),iterations:310000,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['decrypt']);
   let plaintext;try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(vault.iv)},key,decode(vault.ciphertext));}catch(_){throw Error('كلمة مرور الخزنة القديمة غير صحيحة.');}
   const file=JSON.parse(new TextDecoder().decode(plaintext));
   if(file.kind!=='rawaa-work-data-v1')throw Error('نوع النسخة المحلية غير معروف.');
   const entries=check(file.entries);
   if(!confirm('وجدنا '+Object.keys(entries).length+' مجموعات سجلات. هل تريد رفعها إلى حسابك السحابي؟ هذه العملية لا يمكن التراجع عنها إلا من النسخة الأصلية.'))return;
   // Apply through optimistic concurrency so another device's changes cannot be overwritten.
   const result=await client.from(TABLE).update({payload:entries,revision:1,updated_at:new Date().toISOString()})
     .eq('owner_id',user.id).eq('revision',0).select('revision').maybeSingle();
   if(result.error||!result.data)throw Error(result.error?.message||'تغيّر حسابك السحابي؛ تم إيقاف النقل حمايةً للبيانات.');
   location.reload();
  }catch(e){warn('فشل نقل الخزنة السابقة: '+safe(e.message));}
 }
 function cloudBar(){
  const bar=item('div',undefined,'rawaa-cloud-bar');bar.id='cloud-control-bar';
  const h=item('strong','RAWAA | السحابة');status=item('span','✓ تم تحميل الحساب');
  const userInfo=item('small',user.email||'الحساب الحالي');
  const actions=item('div',undefined,'rawaa-cloud-actions');
  const backup=item('button','تنزيل نسخة احتياطية');backup.onclick=async()=>{
   if(localRev!==storedRev){await flush();if(stopped)return;}
   download('RAWAA_Cloud_Backup_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'rawaa-cloud-backup-v1',createdAt:new Date().toISOString(),data:localStorage._snapshot()},null,2));
   statusMsg('تم تجهيز النسخة. تحذير: ملف JSON غير مشفّر!');
  };
  const restore=item('button','استعادة نسخة احتياطية');restore.type='button';
  const restoreInput=item('input');restoreInput.type='file';restoreInput.accept='.json,application/json';restoreInput.hidden=true;
  restore.onclick=()=>restoreInput.click();
  restoreInput.onchange=async()=>{
   const file=restoreInput.files?.[0];restoreInput.value='';if(!file)return;
   try{
    if(file.size>4500000)throw Error('الملف أكبر من الحد المسموح.');
    const parsed=JSON.parse(await file.text());
    if(parsed.format!=='rawaa-cloud-backup-v1')throw Error('ملف النسخة الاحتياطية غير مدعوم.');
    const data=check(parsed.data);
    if(localRev!==storedRev)throw Error('هناك تغييرات غير محفوظة. انتظر تأكيد المزامنة أولاً.');
    if(!confirm('استعادة هذه النسخة ستستبدل جميع موظفيك ودوامهم وسحوباتهم الموجودة حاليًا في السحابة. نزّل نسخة من البيانات الحالية قبل المتابعة. هل أنت متأكد؟'))return;
    await queue;if(stopped)throw Error('توقفت المزامنة.');
    await checkServerVersion();
    const result=await client.from(TABLE).update({payload:data,revision:rev+1,updated_at:new Date().toISOString()})
     .eq('owner_id',user.id).eq('revision',rev).select('revision').maybeSingle();
    if(result.error||!result.data)throw Error(result.error?.message||'جهاز آخر عدّل السجلات. أُلغيت الاستعادة.');
    location.reload();
   }catch(e){warn('تعذرت الاستعادة: '+safe(e.message));}
  };
  const importOld=item('button','نقل بيانات الجهاز السابق');importOld.onclick=importOldVault;
  const refresh=item('button','فحص تحديثات الأجهزة');refresh.onclick=poll;
  const signOut=item('button','تسجيل الخروج');signOut.onclick=async()=>{
   if(localRev!==storedRev){await flush();if(stopped)return;}
   await client.auth.signOut();location.reload();
  };
  actions.append(backup,restore,restoreInput,importOld,refresh,signOut);bar.append(h,userInfo,status,actions);
  const main=document.querySelector('main');if(main)document.body.insertBefore(bar,main);else document.body.prepend(bar);
 }
 function style(){
  const s=item('style');s.textContent='.rawaa-cloud-overlay{position:fixed;inset:0;z-index:999999;background:#082e28;display:grid;place-items:center;overflow:auto;padding:16px;direction:rtl}.rawaa-cloud-dialog{background:#fff;color:#103b30;max-width:470px;width:100%;box-sizing:border-box;padding:24px;border-radius:17px;box-shadow:0 18px 70px #0004}.rawaa-cloud-dialog h2{margin:0 0 10px}.rawaa-cloud-dialog input{display:block;width:100%;box-sizing:border-box;min-height:45px;margin:6px 0 13px;padding:8px;border-radius:8px;border:1px solid #aec9b7;font:inherit}.rawaa-cloud-dialog label{display:block;font-weight:650;font-size:13px}.rawaa-cloud-dialog button{min-height:44px;margin:5px 5px 5px 0;padding:8px 14px;border-radius:9px;color:#fff;background:#103e34;border:0;font:inherit;font-weight:bold;cursor:pointer}.rawaa-cloud-dialog button[disabled]{opacity:.55}.rawaa-cloud-dialog p{font-size:13px;color:#65776d}.rawaa-cloud-bar{max-width:1050px;margin:12px auto;padding:12px 15px;background:#eaf4ef;border:1px solid #a1cabb;border-radius:13px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;direction:rtl}.rawaa-cloud-bar span{flex:1 1 260px;font-weight:bold;font-size:13px}.rawaa-cloud-actions{display:flex;gap:7px;flex-wrap:wrap}.rawaa-cloud-actions button{padding:9px 12px;min-height:43px;border:1px solid #2a664d;background:#fff;color:#15513c;font:inherit;font-weight:700;border-radius:8px;cursor:pointer}@media(max-width:520px){.rawaa-cloud-actions{width:100%}.rawaa-cloud-actions button{flex:1 1 40%}}';document.head.append(s);
 }
 async function login(){
  const overlay=item('div',undefined,'rawaa-cloud-overlay');overlay.id='cloud-login';
  const box=item('div',undefined,'rawaa-cloud-dialog');
  const title=item('h2','تسجيل الدخول — RAWAA Cloud'),subtitle=item('p','استخدم نفس البريد وكلمة المرور على كل جهاز لتظهر سجلات موظفيك نفسها. البيانات محمية بحسابك ولا تُعرض علنًا.');
  const form=item('form'),emailLabel=item('label','البريد الإلكتروني'),email=item('input'),passLabel=item('label','كلمة المرور'),pass=item('input');
  email.type='email';email.autocomplete='username';email.required=true;pass.type='password';pass.autocomplete='current-password';pass.required=true;pass.minLength=8;
  emailLabel.append(email);passLabel.append(pass);
  const message=item('p');message.setAttribute('role','status');
  const submit=item('button','تسجيل الدخول'),create=item('button','إنشاء حساب لأول مرة');submit.type='submit';create.type='button';
  form.append(emailLabel,passLabel,submit,create,message);box.append(title,subtitle,form,item('p','حسابات البريد الأخرى تحصل على مساحة منفصلة. لا تشارك كلمة مرور المدير مع موظفين آخرين.'));overlay.append(box);document.body.append(overlay);
  async function enter(signup){
   if(!email.checkValidity()||!pass.checkValidity()){message.textContent='أدخل بريدًا وكلمة مرور صالحين.';return;}
   submit.disabled=create.disabled=true;message.textContent='جارٍ التحقق من حسابك...';
   try{
    let r=signup?await client.auth.signUp.email({name:'RAWAA Manager',email:email.value.trim(),password:pass.value}):await client.auth.signIn.email({email:email.value.trim(),password:pass.value});
    if(r.error)throw Error(r.error.message||'تعذر تسجيل الدخول');
    const session=resultOrThrow(await client.auth.getSession());
    if(!session?.user||!session?.session)throw Error('لم تصبح الجلسة نشطة. تحقق من البريد إذا طُلب التأكيد.');
    user=session.user;pass.value='';overlay.remove();await activate();
   }catch(e){message.textContent=safe(e.message);submit.disabled=create.disabled=false;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();enter(false);});
  create.addEventListener('click',()=>{if(confirm('إنشاء حساب جديد بهذا البريد؟ كل بريد يحتفظ بسجلاته الخاصة.'))enter(true);});
 }
 async function activate(){
  try{
   const row=await initialRow();rev=Number(row.revision);localStorage._load(check(row.payload));
   cloudBar();await loadExistingScripts();
   storedRev=localRev=0;loggedIn=true;
   localStorage._observe(schedule);
   statusMsg('✓ متصل بالسحابة؛ البيانات متاحة على الأجهزة المتصلة بالحساب');
   const track=e=>{lastActivity=Date.now();if((e.type==='input'||e.type==='change')&&e.target?.closest?.('form'))hasUnsubmittedForm=true;};
   document.addEventListener('pointerdown',track,true);document.addEventListener('input',track,true);document.addEventListener('change',track,true);
   document.addEventListener('submit',()=>{hasUnsubmittedForm=false;lastActivity=Date.now();},true);
   document.addEventListener('reset',()=>{hasUnsubmittedForm=false;lastActivity=Date.now();},true);
   pollTimer=setInterval(poll,12000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastActivity=Date.now();poll();}});
   window.addEventListener('beforeunload',e=>{if(localRev!==storedRev){e.preventDefault();e.returnValue='';}});
   window.addEventListener('online',()=>{if(!stopped&&localRev!==storedRev)flush();else poll();});
  }catch(e){warn('فشل تحميل حساب RAWAA: '+safe(e.message),true);}
 }
 async function start(){
  style();const intro=item('div',undefined,'rawaa-cloud-overlay');intro.id='cloud-loading';
  const box=item('div',undefined,'rawaa-cloud-dialog');box.append(item('h2','RAWAA Cloud'),item('p','جارٍ فتح الاتصال السحابي الآمن...'));intro.append(box);document.body.append(intro);
  try{
   const module=await import(SDK);
   client=module.createClient({auth:{url:AUTH},dataApi:{url:DATA}});
   const session=await client.auth.getSession();
   intro.remove();if(session.error)throw Error(session.error.message);
   if(session.data?.user&&session.data?.session){user=session.data.user;await activate();}
   else await login();
  }catch(e){
   intro.remove();const modal=item('div',undefined,'rawaa-cloud-overlay');const box=item('div',undefined,'rawaa-cloud-dialog');
   box.append(item('h2','تعذر فتح السحابة'),item('p',safe(e.message)),item('p','تأكد من الاتصال بالإنترنت، ثم أعد تحميل الصفحة. لا تدخل بيانات في وضع غير متصل.'));
   const retry=item('button','تحديث');retry.onclick=()=>location.reload();box.append(retry);modal.append(box);document.body.append(modal);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();