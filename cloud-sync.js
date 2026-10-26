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
 const AUTH=window.RAWAA_FIRST_PARTY_AUTH?location.origin+'/auth':'https://ep-red-wave-b9ap8bfz.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
 const DATA=window.RAWAA_FIRST_PARTY_AUTH?location.origin+'/data':'https://ep-red-wave-b9ap8bfz.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1';
 const TABLE='rawaa_cloud_workspace_v1';
 const SELECT='owner_id,revision,payload,updated_at';
 let client=null,user=null,rev=0,queue=Promise.resolve(),localRev=0,storedRev=0,stopped=false,pulling=false,editingStarted=false;
 let syncTimer=null,pollTimer=null,status=null,head=null;let loggedIn=false;
 let hasUnsubmittedForm=false;
 const $=id=>document.getElementById(id);
 const safe=message=>String(message||'فشل الاتصال');
 function statusMsg(m,error=false){if(status){status.textContent=m;status.style.color=error?'#a72820':'#165d42';}}
 function item(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
 function warn(text,block=false,conflict=false){
  statusMsg(text,true);
  if(!block)return;
  stopped=true;
  if($('cloud-sync-lock'))return;
  const overlay=item('div',undefined,'rawaa-cloud-overlay');overlay.id='cloud-sync-lock';
  const box=item('div',undefined,'rawaa-cloud-dialog');
  box.append(item('h2','توقفت مزامنة RAWAA'),item('p',text));
  const save=item('button','تنزيل نسخة طوارئ من التعديلات غير المرسلة');
  save.type='button';save.onclick=async()=>{try{await encryptedDownload('RAWAA_Unsent_Changes_'+new Date().toISOString().slice(0,10)+'.json',localStorage._snapshot());}catch(e){statusMsg('لم تُنشأ نسخة الطوارئ: '+safe(e.message),true);}};
  const retry=item('button','إعادة المحاولة');retry.type='button';
  if(conflict)retry.hidden=true;
  retry.onclick=async()=>{overlay.remove();stopped=false;try{await checkServerVersion();if(localRev!==storedRev)await flush();else await poll();}catch(e){warn('تعذر استئناف الحفظ: '+safe(e.message),true);}};
  const reload=item('button','تحميل أحدث نسخة من السحابة');reload.type='button';reload.onclick=()=>{
   if(confirm('قد تضيع المدخلات غير المحفوظة. صدّر نسخة طوارئ أولًا. متابعة؟'))location.reload();
  };
  box.append(item('p','نسخة الطوارئ مشفّرة بكلمة مرور تختارها. احفظ الملف وكلمة المرور في مكان آمن.'));box.append(save,retry,reload);
  overlay.append(box);document.body.append(overlay);
 }
 async function encryptedDownload(filename,entries){
  if(!crypto?.subtle)throw Error('هذا المتصفح لا يدعم التشفير اللازم للنسخ الاحتياطية.');
  const pass=prompt('أنشئ كلمة مرور للنسخة المشفّرة (12 حرفًا على الأقل):');if(pass===null)return false;
  if(pass.length<12)throw Error('استخدم كلمة مرور أطول لحماية النسخة.');
  if(prompt('أعد كتابة كلمة مرور النسخة:')!==pass)throw Error('كلمتا المرور غير متطابقتين.');
  const encoder=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const base=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},base,{name:'AES-GCM',length:256},false,['encrypt']);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify({kind:'rawaa-work-data-v1',entries:check(entries)}))));
  const b64=bytes=>{let str='';for(let i=0;i<bytes.length;i+=16000)str+=String.fromCharCode(...bytes.subarray(i,i+16000));return btoa(str);};
  const vault={format:'RAWAA_WORK_AES256_GCM_V1',version:1,salt:b64(salt),iv:b64(iv),ciphertext:b64(encrypted)};
  download(filename,JSON.stringify({format:'RAWAA_ENCRYPTED_BACKUP_V1',createdAt:new Date().toISOString(),vault},null,2));return true;
 }
 async function decodeBackup(parsed){
  if(parsed.format==='rawaa-cloud-backup-v1'){
   if(!confirm('هذه نسخة JSON قديمة وغير مشفّرة. هل تريد متابعة الاستعادة؟'))return null;
   return check(parsed.data);
  }
  const vault=parsed.vault;
  if(parsed.format!=='RAWAA_ENCRYPTED_BACKUP_V1'||vault?.format!=='RAWAA_WORK_AES256_GCM_V1'||vault.version!==1)throw Error('النسخة ليست ملف RAWAA مشفّرًا صالحًا.');
  const pass=prompt('أدخل كلمة مرور النسخة المشفّرة:');if(pass===null)return null;
  const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  let plaintext;
  try{
   const salt=bytes(vault.salt),iv=bytes(vault.iv);if(salt.length!==16||iv.length!==12)throw Error('invalid iv');
   const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
   const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},base,{name:'AES-GCM',length:256},false,['decrypt']);
   plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,bytes(vault.ciphertext));
  }catch(_){throw Error('كلمة المرور غير صحيحة أو الملف تالف.');}
  const parsedContent=JSON.parse(new TextDecoder().decode(plaintext));
  if(parsedContent.kind!=='rawaa-work-data-v1')throw Error('نسخة البيانات غير مدعومة.');
  return check(parsedContent.entries);
 }
 function download(filename,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 function check(data){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>35)throw Error('تنسيق سجلات غير مقبول.');
  for(const [k,v] of Object.entries(data)){if(typeof k!=='string'||k.length>100||typeof v!=='string'||v.length>3000000)throw Error('سجلات كبيرة أو غير متوقعة.');}
  const out=JSON.stringify(data);if(out.length>3500000)throw Error('حجم البيانات يتجاوز حد التخزين السحابي.');return data;
 }
 // A fingerprint identifies the exact encrypted snapshot without storing its payroll.
 // Canonical key order makes the digest stable after JSON encryption and restore.
 async function snapshotFingerprint(source){
  if(!crypto?.subtle)throw Error('التحقق الآمن من ملف النقل يحتاج متصفحًا يدعم Web Crypto.');
  const data=check(source);
  const normalized=JSON.stringify(Object.keys(data).sort().map(k=>[k,data[k]]));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized)));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 }
 function expectedTransfer(){
  try{
   const data=JSON.parse(sessionStorage.getItem('rawaa_manager_transfer_expected')||'null');
   if(data&&typeof data.email==='string'&&/^[0-9a-f]{64}$/.test(data.fingerprint||''))return data;
  }catch(_){}
  return null;
 }
 function transferSummary(data){
  const count=key=>{try{const val=JSON.parse(data[key]||'null');return Array.isArray(val)?val.length:Array.isArray(val?.rows)?val.rows.length:null;}catch{return null;}};
  const staff=count('RAWAA_DEMO_STAFF_V19'),attendance=count('RAWAA_DEMO_ATTENDANCE_V12'),ledger=count('RAWAA_DEMO_LEDGER_V13');
  return ['الموظفون: '+(staff??'حسب السجلات'),'الحضور: '+(attendance??'حسب السجلات'),'الدفعات: '+(ledger??'حسب السجلات')].join(' | ');
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
  }).catch(err=>{warn('لم يتم اعتماد بعض التغييرات على السحابة: '+safe(err.message),true,/تعارض تحديث/.test(String(err.message)));});
  return queue;
 }
 async function poll(){
  if(!loggedIn||stopped||pulling||localRev!==storedRev)return;
  pulling=true;
  try{
   const row=await getRow();
   if(!row)throw Error('مساحة العمل غير متاحة.');
   const incoming=Number(row.revision);
   if(incoming===rev)return;
   // A request may finish after a local edit begins. Never reload over
   // unsent saves or form drafts, even if this request started when idle.
   if(localRev!==storedRev)return;
   if(incoming<rev){
    warn('النسخة الموجودة على الخادم أقدم من بيانات هذا الجهاز. أوقفنا التعديل احتياطيًا.',true,true);
    return;
   }
   if(!hasUnsubmittedForm){
    stopped=true;
    statusMsg('✓ وصلت بيانات جديدة من جهاز آخر. جارٍ تحديث الصفحة بأمان…');
    location.reload();
    return;
   }
   warn('وصل تحديث من جهاز آخر (نسخة '+incoming+'). توجد مدخلات في نموذج لم يتم إرسالها بعد؛ احفظ مسودة طوارئ مشفّرة قبل فتح أحدث نسخة من السحابة.',true,true);
  }catch(e){statusMsg('تتعذر مراجعة تغييرات الأجهزة الأخرى حاليًا؛ تحقق من الشبكة.',true);}finally{pulling=false;}
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
 function accountSecurity(){
  // This screen never accepts Gmail passwords; only a one-time email code.
  const overlay=item('div',undefined,'rawaa-cloud-overlay');
  overlay.id='cloud-account-security';
  const panel=item('section',undefined,'rawaa-cloud-dialog');
  const title=item('h2','حماية حساب مدير RAWAA');
  const info=item('p','البريد المرتبط بحساب المدير: '+String(user?.email||'غير معروف'));
  const verification=item('p',user?.emailVerified?'✓ البريد الإلكتروني مؤكَّد في Neon':'لم يتم تأكيد ملكية البريد الإلكتروني بعد.');
  verification.id='cloud-email-verified-status';
  const warning=item('p','لحماية بيانات الموظفين، لا تنشر كلمة المرور أو رمز البريد. تأكيد Gmail يثبت ملكية عنوان البريد، ولا يفعّل تسجيل الدخول بزر Google تلقائيًا.');
  const send=item('button','إرسال رمز تأكيد إلى Gmail');
  send.type='button';send.id='cloud-send-email-otp';
  const form=item('form');form.id='cloud-verify-email-form';
  const label=item('label','رمز التأكيد المرسل إلى البريد');
  const input=item('input');input.type='text';input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=12;input.required=true;input.pattern='[0-9]{4,12}';input.placeholder='أدخل رمز البريد هنا';label.append(input);
  const verify=item('button','تأكيد البريد');verify.type='submit';
  const result=item('p');result.id='cloud-otp-message';result.setAttribute('role','status');
  const notes=item('p','تغيير حساب المدير إلى Gmail آخر يتطلب تسليم صلاحيات مستقلًا؛ تسجيل الخروج والدخول ببريد مختلف لا ينقل الرواتب، ولا يلغي صلاحية الحساب القديم. استخدم النسخة المشفّرة قبل أي انتقال.');
  const close=item('button','إغلاق');close.type='button';close.onclick=()=>overlay.remove();
  let lastSent=0;
  if(user?.emailVerified){send.hidden=true;form.hidden=true;}
  send.onclick=async()=>{
    if(Date.now()-lastSent<60000){result.textContent='انتظر دقيقة قبل طلب رمز جديد.';return;}
    if(!user?.email){result.textContent='لا يوجد بريد مرتبط بالحساب.';return;}
    send.disabled=true;result.textContent='جارٍ إرسال رمز التحقق إلى البريد…';
    try{
      if(!client?.auth?.emailOtp?.sendVerificationOtp)throw Error('ميزة رموز التحقق غير متاحة في جلسة الدخول الحالية.');
      const response=await client.auth.emailOtp.sendVerificationOtp({email:user.email,type:'email-verification'});
      if(response.error)throw Error(response.error.message||'تعذر إرسال الرمز.');
      lastSent=Date.now();result.textContent='إذا كان البريد يدعم استلام الرسائل، افحص Gmail والبريد غير المرغوب وأدخل رمز التحقق. لا تشارك الرمز في المحادثة.';
    }catch(e){result.textContent='فشل إرسال الرمز: '+safe(e.message);}
    finally{send.disabled=false;}
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(verify.disabled)return;
    const otp=input.value.trim();
    if(!/^[0-9]{4,12}$/.test(otp)){result.textContent='أدخل رمزًا رقميًا صحيحًا من البريد.';return;}
    verify.disabled=true;result.textContent='جارٍ التحقق من الرمز…';
    try{
      if(!client?.auth?.emailOtp?.verifyEmail)throw Error('التحقق من البريد غير مدعوم في جلسة الدخول الحالية.');
      const response=await client.auth.emailOtp.verifyEmail({email:user.email,otp});
      if(response.error)throw Error(response.error.message||'الرمز غير صحيح أو انتهت صلاحيته.');
      const check=await client.auth.getSession();
      if(check.error)throw Error(check.error.message||'تعذر تحديث حالة الحساب.');
      if(check.data?.user?.id===user.id&&check.data.user.emailVerified===true){
        user=check.data.user;
        verification.textContent='✓ تم تأكيد Gmail بنجاح.';
        const account=$('cloud-security-account-button');if(account)account.textContent='✓ Gmail مؤكَّد · إعدادات الأمان';
        send.hidden=true;form.hidden=true;
        result.textContent='تم تأكيد ملكية البريد. احتفظ بنفس حساب المدير على جميع الأجهزة.';
      }else{
        result.textContent='استقبل الخادم طلب التحقق، لكن الجلسة لم تعرض حالة «مؤكَّد» بعد. أغلق النافذة وأعد تحميل الصفحة للتحقق؛ لا تنشئ حسابًا جديدًا.';
      }
    }catch(e){result.textContent='تعذر تأكيد البريد: '+safe(e.message);}
    finally{input.value='';verify.disabled=false;}
  };
  form.append(label,verify);
  panel.append(title,info,verification,warning,send,form,result,notes,close);
  overlay.append(panel);document.body.append(overlay);
 }
 
 function managerTransfer(){
  if($('cloud-manager-transfer'))return;
  const overlay=item('div',undefined,'rawaa-cloud-overlay');overlay.id='cloud-manager-transfer';
  const panel=item('section',undefined,'rawaa-cloud-dialog');
  const title=item('h2','تغيير حساب مدير RAWAA إلى Gmail آخر');
  const lead=item('p','هذه عملية نقل نسخة مشفّرة إلى حساب جديد، وليست تغييرًا مباشرًا لهوية Neon. يحتفظ الحساب القديم ببياناته وصلاحياته حتى يتم إيقافه لاحقًا بشكل منفصل.');
  const oldEmail=item('p','حساب المدير الحالي: '+String(user?.email||''));
  const emailLabel=item('label','عنوان Gmail الجديد الذي تملكه');
  const target=item('input');target.type='email';target.autocomplete='off';target.required=true;target.placeholder='example@gmail.com';target.id='cloud-manager-new-email';emailLabel.append(target);
  const notes=item('p','1) نزّل نسخة مشفّرة من السجلات الحالية واحفظها وكلمة مرورها. 2) افتح حساب RAWAA جديدًا بالبريد الذي تملكه وكلمة مرور RAWAA مستقلة عن Google. 3) أكّد البريد ثم استعد النسخة. 4) بعد اختبار البيانات وصلاحيات الحساب الجديد، يُلغى دخول الحساب القديم بإجراء مستقل.');
  const backup=item('button','1 · تنزيل نسخة مشفّرة قبل الانتقال');backup.type='button';backup.id='cloud-manager-export';
  const stepInfo=item('p','الخطوة 1 من 2: اضغط زر التنزيل أولًا، أنشئ كلمة مرور قوية للنسخة، ثم تحقّق من وجود ملف RAWAA_Manager_Transfer في تطبيق الملفات.');
  stepInfo.id='cloud-manager-step-info';
  const confirmSaved=item('label');confirmSaved.className='rawaa-confirm-line';const saved=item('input');saved.type='checkbox';saved.id='cloud-manager-file-saved';saved.disabled=true;confirmSaved.append(saved,document.createTextNode(' تأكدت أن ملف النسخة المشفّرة موجود على جهازي وأنني أعرف كلمة مرورها.'));
  const go=item('button','2 · تسجيل الخروج لإنشاء حساب المدير الجديد');go.type='button';go.disabled=true;go.id='cloud-manager-proceed';
  const message=item('p');message.id='cloud-manager-message';message.setAttribute('role','status');
  const close=item('button','إلغاء');close.type='button';close.onclick=()=>overlay.remove();
  let downloaded=false,exportRevision=-1,exportLocalRevision=-1,exportFingerprint='';
  const validate=()=>{
   const ok=/^[^\s@]+@gmail\.com$/i.test(target.value.trim())&&target.value.trim().toLowerCase()!==String(user?.email||'').toLowerCase();
   go.disabled=!(downloaded&&saved.checked&&ok&&rev===exportRevision&&localRev===exportLocalRevision&&!hasUnsubmittedForm);
   return ok;
  };
  target.oninput=()=>{
   downloaded=false;exportRevision=-1;exportLocalRevision=-1;exportFingerprint='';
   saved.disabled=true;saved.checked=false;
   stepInfo.textContent='الخطوة 1 من 2: نزّل نسخة مشفّرة من السجلات الحالية بعد اختيار Gmail الصحيح.';
   validate();
  };
  saved.onchange=validate;
  backup.onclick=async()=>{
   if(!validate()){message.textContent='أدخل بريد Gmail جديدًا مختلفًا عن حساب المدير الحالي.';return;}
   if(hasUnsubmittedForm){message.textContent='احفظ أو ألغِ مسودة نموذج الموظف المفتوحة أولًا.';return;}
   if(localRev!==storedRev){await flush();if(stopped||localRev!==storedRev){message.textContent='تعذّر حفظ جميع التعديلات، لا تنتقل الآن.';return;}}
   try{
    backup.disabled=true;
    await checkServerVersion();
    const snapshot=localStorage._snapshot(),hash=await snapshotFingerprint(snapshot);
    const exportAtRevision=rev,exportAtLocalRevision=localRev;
    const success=await encryptedDownload('RAWAA_Manager_Transfer_'+new Date().toISOString().slice(0,10)+'.json',snapshot);
    if(success){
     await checkServerVersion();
     downloaded=true;exportRevision=exportAtRevision;exportLocalRevision=exportAtLocalRevision;exportFingerprint=hash;
     saved.disabled=false;saved.checked=false;
     stepInfo.textContent='الخطوة 2 من 2: افتح تطبيق الملفات، وابحث عن RAWAA_Manager_Transfer، ثم فعّل المربع الصغير أدناه إذا كان الملف موجودًا وكلمة مروره محفوظة.';
     message.textContent='تم تجهيز النسخة المشفّرة. '+transferSummary(snapshot)+'. تحقّق من حفظ الملف وكلمة مروره، ثم ضع علامة التأكيد. إذا تغير أي سجل بعدها يجب تنزيل نسخة أحدث.';
    }
    else message.textContent='لم تُنزّل نسخة احتياطية. لن يُسمح بالانتقال.';
    validate();
   }catch(e){message.textContent='تعذّر إنشاء النسخة: '+safe(e.message);}
   finally{backup.disabled=false;}
  };
  go.onclick=async()=>{
   if(!validate()||!saved.checked||!downloaded){
    message.textContent='تغيرت البيانات أو لم تُحفظ نسخة مشفّرة. أعد تنزيل نسخة حديثة بعد حفظ كافة التعديلات.';
    return;
   }
   if(!confirm('هل تحققت من حفظ نسخة الرواتب المشفّرة وكلمة مرورها؟ سيُسجل خروجك من الحساب القديم، الذي سيبقى محتفظًا ببياناته لحين انتهاء النقل.'))return;
   go.disabled=true;
   try{
    if(hasUnsubmittedForm)throw Error('توجد مسودة نموذج غير محفوظة.');
    if(localRev!==storedRev){await flush();if(stopped||localRev!==storedRev)throw Error('بيانات غير محفوظة.');}
    await checkServerVersion();
    if(rev!==exportRevision||localRev!==exportLocalRevision||
       await snapshotFingerprint(localStorage._snapshot())!==exportFingerprint)
      throw Error('تغيّرت بيانات الموظفين منذ إنشاء النسخة المشفّرة. نزّل نسخة أحدث قبل الانتقال.');
    const normalizedEmail=target.value.trim().toLowerCase();
    sessionStorage.setItem('rawaa_manager_transfer_expected',JSON.stringify({
     email:normalizedEmail,fingerprint:exportFingerprint,sourceRevision:rev,createdAt:new Date().toISOString()
    }));
    sessionStorage.setItem('rawaa_manager_transfer_target',normalizedEmail);
    const out=await client.auth.signOut();
    if(out.error)throw Error(out.error.message||'فشل تسجيل الخروج');
    location.reload();
   }catch(e){
    sessionStorage.removeItem('rawaa_manager_transfer_expected');
    message.textContent='لم يحدث انتقال: '+safe(e.message);go.disabled=false;
   }
  };
  panel.append(title,lead,oldEmail,emailLabel,notes,backup,stepInfo,confirmSaved,go,message,close);
  overlay.append(panel);document.body.append(overlay);
 }

 function cloudBar(){
  const bar=item('div',undefined,'rawaa-cloud-bar');bar.id='cloud-control-bar';
  const h=item('strong','RAWAA | السحابة');status=item('span','✓ تم تحميل الحساب');
  const userInfo=item('small',user.email||'الحساب الحالي');
  const actions=item('div',undefined,'rawaa-cloud-actions');
  const security=item('button',user?.emailVerified?'✓ Gmail مؤكَّد · إعدادات الأمان':'تأكيد Gmail · إعدادات الأمان');
  security.type='button';security.id='cloud-security-account-button';security.onclick=accountSecurity;
  const changeManager=item('button','نقل المدير إلى Gmail جديد');changeManager.type='button';changeManager.id='cloud-manager-change-button';changeManager.onclick=managerTransfer;
  const backup=item('button','تنزيل نسخة احتياطية مشفّرة');backup.onclick=async()=>{
   try{if(localRev!==storedRev){await flush();if(stopped)return;}
    if(await encryptedDownload('RAWAA_Cloud_Backup_'+new Date().toISOString().slice(0,10)+'.json',localStorage._snapshot()))statusMsg('✓ تم تجهيز نسخة مشفّرة؛ احفظ كلمة المرور منفصلة.');
   }catch(e){statusMsg('تعذّر إنشاء النسخة: '+safe(e.message),true);}
  };
  const restore=item('button','استعادة نسخة احتياطية');restore.type='button';
  const restoreInput=item('input');restoreInput.type='file';restoreInput.accept='.json,application/json';restoreInput.hidden=true;
  restore.onclick=()=>restoreInput.click();
  restoreInput.onchange=async()=>{
   const file=restoreInput.files?.[0];restoreInput.value='';if(!file)return;
   try{
    if(file.size>4500000)throw Error('الملف أكبر من الحد المسموح.');
    const parsed=JSON.parse(await file.text());
    const data=await decodeBackup(parsed);if(!data)return;
    if(localRev!==storedRev)throw Error('هناك تغييرات غير محفوظة. انتظر تأكيد المزامنة أولاً.');
    if(hasUnsubmittedForm)throw Error('هناك مسودة نموذج لم تُحفظ. احفظها أو ألغِها أولًا.');
    const transfer=expectedTransfer();
    const completingTransfer=!!transfer&&transfer.email===String(user?.email||'').toLowerCase();
    const fileHash=await snapshotFingerprint(data);
    if(completingTransfer){
     if(!user.emailVerified)throw Error('قبل نقل السجلات، افتح «تأكيد Gmail · إعدادات الأمان» وأكّد ملكية البريد الجديد أولًا.');
     if(fileHash!==transfer.fingerprint)throw Error('ملف النسخة لا يطابق النسخة المصدّرة أثناء نقل المدير. اختر الملف الصحيح؛ لم يُستبدل أي سجل.');
    }
    const promptText='ستحل السجلات التالية محل السجلات الحالية لهذا الحساب فقط:\n'+transferSummary(data)+
      '\nتأكد من أنك لا تستبدل بيانات أحدث. يحتفظ الحساب القديم بصلاحياته بعد النقل. هل أنت متأكد؟';
    if(!confirm(promptText))return;
    await queue;if(stopped)throw Error('توقفت المزامنة.');
    await checkServerVersion();
    const expectedRevision=rev+1;
    const result=await client.from(TABLE).update({payload:data,revision:expectedRevision,updated_at:new Date().toISOString()})
     .eq('owner_id',user.id).eq('revision',rev).select('revision').maybeSingle();
    if(result.error||!result.data)throw Error(result.error?.message||'جهاز آخر عدّل السجلات. أُلغيت الاستعادة.');
    // Do not announce a complete handover until the server has read back
    // the exact same encrypted-backup payload at the expected revision.
    const saved=await getRow();
    if(!saved||Number(saved.revision)!==expectedRevision||await snapshotFingerprint(saved.payload)!==fileHash)
     throw Error('تم إرسال الاستعادة لكن لم نستطع تأكيد تطابق سجلات الخادم. لا تحذف الملف أو الحساب القديم؛ أعد فحص البيانات.');
    if(completingTransfer){
     sessionStorage.setItem('rawaa_manager_transfer_restored',JSON.stringify({
      email:transfer.email,sourceRevision:transfer.sourceRevision,
      targetRevision:expectedRevision,fingerprint:fileHash,verifiedAt:new Date().toISOString()
     }));
     sessionStorage.removeItem('rawaa_manager_transfer_expected');
     sessionStorage.removeItem('rawaa_manager_transfer_created');
    }
    location.reload();
   }catch(e){warn('تعذرت الاستعادة: '+safe(e.message));}
  };
  const importOld=item('button','نقل بيانات الجهاز السابق');importOld.onclick=importOldVault;
  const refresh=item('button','فحص تحديثات الأجهزة');refresh.onclick=poll;
  const signOut=item('button','تسجيل الخروج');signOut.onclick=async()=>{
   if(localRev!==storedRev){await flush();if(stopped)return;}
   await client.auth.signOut();location.reload();
  };
  actions.append(security,changeManager,backup,restore,restoreInput,importOld,refresh,signOut);bar.append(h,userInfo,status,actions);
  const main=document.querySelector('main');if(main)document.body.insertBefore(bar,main);else document.body.prepend(bar);
 }
 function style(){
  const s=item('style');s.textContent='.rawaa-cloud-overlay{position:fixed;inset:0;z-index:999999;background:#082e28;display:flex;align-items:safe center;justify-content:center;overflow-x:hidden;overflow-y:auto;padding:16px;direction:rtl;width:100%;max-width:100vw;box-sizing:border-box}.rawaa-cloud-dialog{background:#fff;color:#103b30;max-width:470px;width:100%;min-width:0;box-sizing:border-box;padding:clamp(14px,4vw,24px);border-radius:17px;box-shadow:0 18px 70px #0004;overflow-wrap:anywhere}.rawaa-cloud-dialog h2{margin:0 0 10px}.rawaa-cloud-dialog input:not([type="checkbox"]):not([type="file"]){display:block;width:100%;min-width:0;box-sizing:border-box;min-height:45px;margin:6px 0 13px;padding:8px;border-radius:8px;border:1px solid #aec9b7;font:inherit;font-size:max(16px,1em)}.rawaa-cloud-dialog input[type="checkbox"]{display:inline-block;appearance:auto;width:21px;height:21px;min-width:21px;min-height:21px;margin:0;padding:0;vertical-align:middle;flex-shrink:0;accent-color:#103e34}.rawaa-cloud-dialog .rawaa-confirm-line{display:flex;align-items:center;gap:10px;line-height:1.7;padding:12px 4px;overflow-wrap:anywhere}.rawaa-cloud-dialog .rawaa-confirm-line:has(input:disabled){opacity:.6}.rawaa-cloud-dialog #cloud-manager-step-info{border-inline-start:3px solid #ca9b51;padding:9px 12px;background:#f5f7f0;margin:12px 0}.rawaa-cloud-dialog #cloud-manager-export,.rawaa-cloud-dialog #cloud-manager-proceed{width:100%;margin:7px 0;line-height:1.6;white-space:normal;min-height:48px}.rawaa-cloud-dialog #cloud-manager-new-email{direction:ltr;text-align:left}.rawaa-cloud-dialog label{display:block;font-weight:650;font-size:13px}.rawaa-cloud-dialog button{min-height:44px;margin:5px 5px 5px 0;padding:8px 14px;border-radius:9px;color:#fff;background:#103e34;border:0;font:inherit;font-weight:bold;cursor:pointer}.rawaa-cloud-dialog button[disabled]{opacity:.55}.rawaa-cloud-dialog p{font-size:13px;color:#65776d}.rawaa-cloud-bar{max-width:1050px;margin:12px auto;padding:12px 15px;background:#eaf4ef;border:1px solid #a1cabb;border-radius:13px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;direction:rtl}.rawaa-cloud-bar span{flex:1 1 260px;font-weight:bold;font-size:13px}.rawaa-cloud-actions{display:flex;gap:7px;flex-wrap:wrap}.rawaa-cloud-actions button{padding:9px 12px;min-height:43px;border:1px solid #2a664d;background:#fff;color:#15513c;font:inherit;font-weight:700;border-radius:8px;cursor:pointer}@media(max-width:520px){.rawaa-cloud-actions{width:100%}.rawaa-cloud-actions button{flex:1 1 40%}}';document.head.append(s);
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
  let transferTarget='';
  try{transferTarget=window.RAWAA_FIRST_PARTY_AUTH?(sessionStorage.getItem('rawaa_manager_transfer_target')||''):'';}catch(_){}
  if(window.RAWAA_FIRST_PARTY_AUTH&&!transferTarget){
   create.hidden=true;create.disabled=true;
   subtitle.textContent='استخدم حساب المدير المسجّل. لن يظهر إنشاء حساب جديد إلا بعد تجهيز نسخة مشفّرة وبدء نقل المدير من داخل الحساب القديم.';
  }else if(window.RAWAA_FIRST_PARTY_AUTH&&transferTarget){
   email.value=transferTarget;email.readOnly=true;
   create.textContent='إنشاء حساب المدير الجديد بهذا Gmail';
   subtitle.textContent='أنت في خطوة إنشاء حساب RAWAA للبريد الجديد. استخدم كلمة مرور قوية جديدة خاصة بالتطبيق (وليست كلمة مرور Google). السجلات القديمة لا تُنقل تلقائيًا؛ ستستعيدها من ملف النسخة المشفّرة.';
  }
  form.append(emailLabel,passLabel,submit,create,message);box.append(title,subtitle,form,item('p','لا تشارك كلمة مرور المدير مع موظفين آخرين. إذا لم تتمكن من تسجيل الدخول، لا تنشئ حسابًا آخر بالبريد نفسه.'));overlay.append(box);document.body.append(overlay);
  async function enter(signup){
   if(!email.checkValidity()||!pass.checkValidity()){message.textContent='أدخل بريدًا وكلمة مرور صالحين.';return;}
   submit.disabled=create.disabled=true;message.textContent='جارٍ التحقق من حسابك...';
   try{
    let r=signup?await client.auth.signUp.email({name:'RAWAA Manager',email:email.value.trim(),password:pass.value}):await client.auth.signIn.email({email:email.value.trim(),password:pass.value});
    if(r.error)throw Error(r.error.message||'تعذر تسجيل الدخول');
    // Some Safari versions do not expose a new session on the very next tick.
    // Retry briefly; never misreport an account as unregistered or create it twice.
    let session=null;
    for(let attempt=0;attempt<4;attempt++){
      const checkResult=await client.auth.getSession();
      if(checkResult.error)throw Error(checkResult.error.message||'تعذر التحقق من جلسة الدخول.');
      session=checkResult.data;
      if(session?.user&&session?.session)break;
      await new Promise(done=>setTimeout(done,350+attempt*300));
    }
    if(!session?.user||!session?.session)throw Error('لم تصبح الجلسة نشطة. تحقق من البريد إذا طُلب التأكيد.');
    user=session.user;pass.value='';
    if(transferTarget&&String(user.email||'').toLowerCase()!==transferTarget.toLowerCase())
     throw Error('حساب تسجيل الدخول لا يطابق بريد المدير الجديد الذي جهزت له النسخة.');
    if(transferTarget){
     if(user.email?.toLowerCase()!==transferTarget.toLowerCase())throw Error('جلسة الدخول لا تطابق بريد المدير الجديد.');
     sessionStorage.removeItem('rawaa_manager_transfer_target');
     sessionStorage.setItem('rawaa_manager_transfer_created',user.email.toLowerCase());
    }
    overlay.remove();await activate();
   }catch(e){message.textContent=safe(e.message);submit.disabled=create.disabled=false;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();enter(false);});
  create.addEventListener('click',()=>{
    if(transferTarget&&email.value.trim().toLowerCase()!==transferTarget.toLowerCase()){message.textContent='عنوان البريد لا يطابق Gmail المستهدف.';return;}
    if(confirm(transferTarget?'إنشاء حساب RAWAA جديد على Gmail المحدد؟ لن تُحذف بيانات الحساب القديم ولن تُنقل إلا باستعادة النسخة المشفّرة.':'إنشاء حساب جديد بهذا البريد؟ كل بريد يحتفظ بسجلاته الخاصة.'))enter(true);
  });
 }
 async function activate(){
  try{
   const row=await initialRow();rev=Number(row.revision);localStorage._load(check(row.payload));
   cloudBar();await loadExistingScripts();
   let justTransferred='';
   try{justTransferred=sessionStorage.getItem('rawaa_manager_transfer_created')||'';}catch(_){}
   if(justTransferred===String(user.email||'').toLowerCase()){
    const reminder=item('div',undefined,'rawaa-cloud-bar');reminder.id='cloud-new-manager-reminder';
    const message=item('strong','تم إنشاء الحساب الجديد. قبل اعتماد هذا Gmail مديرًا فعليًا: اضغط «تأكيد Gmail · إعدادات الأمان»، ثم «استعادة نسخة احتياطية» واختر الملف المشفّر الذي نزّلته من الحساب القديم. بعد التأكد من جميع سجلات الرواتب، اطلب إيقاف وصول الحساب القديم. لا تنسَ كلمة مرور النسخة.');
    const done=item('button','فهمت');done.type='button';done.onclick=()=>{sessionStorage.removeItem('rawaa_manager_transfer_created');reminder.remove();};
    reminder.append(message,done);const main=document.querySelector('main');if(main)document.body.insertBefore(reminder,main);else document.body.prepend(reminder);
   }
   // The legacy public-demo backup exports employee data as plaintext JSON.
   // The cloud workspace exposes only its AES-GCM encrypted backup controls.
   const legacyBackup=$('fin-backup');
   if(legacyBackup){const legacyCard=legacyBackup.closest('.card');if(legacyCard)legacyCard.hidden=true;}
   // Only show a success banner if the authenticated, verified new manager
   // owns exactly the restored cloud payload. Old account remains active.
   try{
    const checked=JSON.parse(sessionStorage.getItem('rawaa_manager_transfer_restored')||'null');
    if(checked&&checked.email===String(user.email||'').toLowerCase()){
     const panel=item('div',undefined,'rawaa-cloud-bar');panel.id='cloud-transfer-verified';
     const success=item('strong','✓ تمت مراجعة النسخة المستعادة وقراءة البيانات نفسها من الخادم (الإصدار '+checked.targetRevision+'). بيانات RAWAA مرتبطة الآن بهذا الحساب. ما زال المدير القديم يحتفظ بإمكانية الدخول إلى سجلاته السابقة؛ لا تعتبر سحب صلاحياته مكتملًا.');
     const dismiss=item('button','إخفاء التنبيه');dismiss.type='button';dismiss.onclick=()=>{sessionStorage.removeItem('rawaa_manager_transfer_restored');panel.remove();};
     panel.append(success,dismiss);const main=document.querySelector('main');if(main)document.body.insertBefore(panel,main);else document.body.prepend(panel);
    }
   }catch(_){}
   storedRev=localRev=0;loggedIn=true;
   localStorage._observe(schedule);
   statusMsg('✓ متصل بالسحابة؛ البيانات متاحة على الأجهزة المتصلة بالحساب');
   const track=e=>{
    // A focused field alone is not an unsaved draft; only user edits are.
    // Composition guards cover keyboards that commit text on blur (iPhone).
    if(e.target?.closest?.('#cloud-account-security'))return;
    if(e.target?.closest?.('form'))hasUnsubmittedForm=true;
   };
   document.addEventListener('input',track,true);
   document.addEventListener('change',track,true);
   document.addEventListener('compositionstart',track,true);
   document.addEventListener('beforeinput',track,true);
   document.addEventListener('submit',()=>{hasUnsubmittedForm=false;},true);
   document.addEventListener('reset',()=>{hasUnsubmittedForm=false;},true);
   pollTimer=setInterval(poll,12000);
   document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
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