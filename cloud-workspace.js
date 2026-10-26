/* RAWAA 1.17 — authenticated cloud workspace, no secrets in browser. */
const localStorage=(()=>{
  const data=new Map();let observe=()=>{};
  return {
    getItem(key){key=String(key);return data.has(key)?data.get(key):null},
    setItem(key,value){data.set(String(key),String(value));observe()},
    removeItem(key){data.delete(String(key));observe()},
    clear(){data.clear();observe()},
    key(i){return [...data.keys()][i]??null},
    get length(){return data.size},
    _load(entries){data.clear();for(const [k,v] of Object.entries(entries))data.set(String(k),String(v))},
    _snapshot(){return Object.fromEntries(data)},
    _observe(callback){observe=callback}
  };
})();
window.RAWAA_CLOUD_STORAGE=localStorage;
(()=>{
  'use strict';
  const $=id=>document.getElementById(id), encoder=new TextEncoder(),decoder=new TextDecoder();
  const DB='/data/rawaa_cloud_workspace_v1', AUTH='/auth';
  let user=null,token=null,revision=null,lastSynced='{}';
  let cloudReady=false,blocked=false,changed=0,saved=0,queue=Promise.resolve(),writing=false;
  let indicator=null,alertElement=null;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function snapshot(){return localStorage._snapshot();}
  function status(message,bad=false){
    if(indicator){indicator.textContent=message;indicator.style.color=bad?'#a6231d':'#144b3a';}
  }
  function gate(title,description){
    document.getElementById('rawaa-cloud-overlay')?.remove();
    const layer=document.createElement('div');layer.id='rawaa-cloud-overlay';layer.className='rawaa-cloud-shield';
    const card=document.createElement('div');card.className='rawaa-cloud-panel';
    const h=document.createElement('h2');h.textContent=title;const p=document.createElement('p');p.textContent=description;
    card.append(h,p);layer.append(card);document.body.append(layer);return card;
  }
  function blockEdits(reason){
    if(blocked)return;blocked=true;
    status(reason,true);
    const panel=gate('حماية سجلات RAWAA',reason+' لن تتم متابعة التعديل قبل حل المشكلة حتى لا تضيع السجلات.');
    const b=document.createElement('button');b.type='button';b.textContent='إعادة تحميل البيانات من السحابة';b.onclick=()=>location.reload();panel.append(b);
  }
  function css(){
    const style=document.createElement('style');
    style.textContent='.rawaa-cloud-shield{position:fixed;inset:0;z-index:999999;overflow:auto;display:grid;place-items:center;background:#073129;padding:18px;direction:rtl}.rawaa-cloud-panel{width:100%;max-width:490px;box-sizing:border-box;background:#fff;padding:22px;border-radius:18px;color:#123b31;box-shadow:0 18px 65px #0006}.rawaa-cloud-panel h2{margin:0 0 12px;font-size:24px}.rawaa-cloud-panel p{font-size:14px;color:#5b6f64}.rawaa-cloud-panel label{display:block;margin:10px 0}.rawaa-cloud-panel input{box-sizing:border-box;width:100%;min-height:45px;padding:10px;border:1px solid #b7cabc;border-radius:9px;font:inherit;display:block}.rawaa-cloud-panel button,.rawaa-cloud-controls button{border:1px solid #205740;background:#174639;color:#fff;border-radius:9px;padding:10px;min-height:44px;font:inherit;font-weight:bold;cursor:pointer}.rawaa-cloud-panel button{width:100%}.rawaa-cloud-panel button:disabled{opacity:.5}.rawaa-cloud-status{font-weight:bold;font-size:13px;max-width:1050px;margin:10px auto;background:#e6f2e8;border:1px solid #a0cdb4;border-radius:13px;padding:11px;direction:rtl;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.rawaa-cloud-status strong{font-weight:bold}.rawaa-cloud-status span{flex:1 1 210px}.rawaa-cloud-controls{display:flex;flex-wrap:wrap;gap:6px}.rawaa-cloud-controls button{background:white;color:#174639;min-height:39px;padding:6px 10px;font-size:12px}@media(max-width:550px){.rawaa-cloud-controls{width:100%}.rawaa-cloud-controls button{flex:1 1 43%}}.rawaa-cloud-error{color:#ae241d!important;font-weight:700}';
    document.head.append(style);
  }
  async function api(url,options={}){
    if(!token)throw Error('يجب تسجيل الدخول قبل قراءة بيانات الموظفين.');
    const response=await fetch(url,{...options,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
    if(response.status===401){blockEdits('انتهت صلاحية الجلسة. أعد تسجيل الدخول.');throw Error('انتهت جلسة الدخول.');}
    if(!response.ok){const message=(await response.text()).slice(0,350);throw Error('فشل اتصال قاعدة RAWAA ('+response.status+'). '+message);}
    return response.status===204?[]:await response.json();
  }
  async function refreshSession(){
    const response=await fetch(AUTH+'/get-session',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return false;
    const result=await response.json(),body=result?.data||result;
    const next=body?.session?.access_token||response.headers.get('set-auth-jwt');
    if(!body?.user?.id||!next)return false;
    token=next;user=body.user;return true;
  }
  function authForm(){
    const card=gate('تسجيل الدخول إلى RAWAA Cloud','سجلات المطعم مرتبطة بالبريد الإلكتروني وكلمة المرور نفسها على كل الأجهزة. أنشئ حساب المدير مرة واحدة ثم اختر «دخول» من باقي الأجهزة.');
    const form=document.createElement('form');
    const e=document.createElement('label');e.textContent='البريد الإلكتروني';const email=document.createElement('input');email.type='email';email.required=true;email.autocomplete='username';e.append(email);
    const l=document.createElement('label');l.textContent='كلمة المرور';const password=document.createElement('input');password.type='password';password.minLength=12;password.required=true;password.autocomplete='current-password';l.append(password);
    const msg=document.createElement('p');msg.className='rawaa-cloud-error';msg.setAttribute('role','alert');
    const submit=document.createElement('button');submit.textContent='دخول إلى حسابي';submit.type='submit';
    const switcher=document.createElement('button');switcher.textContent='إنشاء حساب مدير جديد';switcher.type='button';switcher.style.marginTop='8px';
    const hint=document.createElement('p');hint.textContent='للحماية، أنشئ حساب المدير بالبريد الذي تتحكم فيه. تسجيل حساب آخر ينشئ مساحة عمل مختلفة، ولا يمنح صلاحية الاطلاع على سجلاتك.';
    let signup=false;
    switcher.onclick=()=>{signup=!signup;submit.textContent=signup?'إنشاء حساب المدير':'دخول إلى حسابي';switcher.textContent=signup?'لدي حساب: تسجيل الدخول':'إنشاء حساب مدير جديد';password.autocomplete=signup?'new-password':'current-password';msg.textContent='';};
    form.append(e,l,msg,submit,switcher);card.append(form,hint);
    form.onsubmit=async ev=>{
      ev.preventDefault();if(submit.disabled)return;submit.disabled=true;msg.textContent='';
      try{
        if(signup&&password.value.length<12)throw Error('استخدم كلمة مرور لا تقل عن 12 حرفًا.');
        const endpoint=signup?'/sign-up/email':'/sign-in/email';
        const body={email:email.value.trim(),password:password.value};
        if(signup)body.name='RAWAA Admin';
        const response=await fetch(AUTH+endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json().catch(()=>({}));if(!response.ok||result.error)throw Error(result.error?.message||'بيانات الدخول غير صحيحة أو الحساب يحتاج تفعيل بريد إلكتروني.');
        if(!await refreshSession())throw Error('نجح التسجيل ولكن لم تُفتح الجلسة. تحقق من بريدك إذا كان التأكيد مطلوبًا.');
        document.getElementById('rawaa-cloud-overlay')?.remove();await boot();
      }catch(error){msg.textContent=error.message||'تعذر تسجيل الدخول.';submit.disabled=false;}
      password.value='';
    };
  }
  async function getRemote(){
    const result=await api(DB+'?select=owner_id,revision,payload,updated_at&owner_id=eq.'+encodeURIComponent(user.id)+'&limit=1');
    if(!Array.isArray(result))throw Error('استجابة قاعدة البيانات غير صالحة.');
    return result[0]||null;
  }
  function validateEntries(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('سجلات غير صالحة.');
    if(Object.entries(value).some(([k,v])=>typeof v!=='string'||k.length>150))throw Error('تنسيق سجلات RAWAA غير صالح.');
    return value;
  }
  async function writeLatest(){
    if(!cloudReady||blocked)return;
    if(saved===changed)return;
    writing=true;
    const content=snapshot(), target=changed;
    status('جارٍ حفظ التغييرات على الخادم…');
    try{
      let response;
      if(revision===null){
        response=await api(DB,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:user.id,revision:1,payload:content})});
      }else{
        response=await api(DB+'?owner_id=eq.'+encodeURIComponent(user.id)+'&revision=eq.'+revision,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({revision:revision+1,payload:content})});
      }
      if(!Array.isArray(response)||response.length!==1)throw Error('تعارض في التعديلات: جهاز آخر حفظ بيانات جديدة. لا يمكن الكتابة فوقها.');
      revision=Number(response[0].revision);saved=target;lastSynced=JSON.stringify(content);
      status(saved===changed?'✓ جميع التغييرات محفوظة في السحابة':'جارٍ مزامنة التغييرات التالية…');
    }catch(err){blockEdits('لم تُحفَظ آخر التغييرات في السحابة: '+err.message);}
    finally{writing=false;}
  }
  function persist(){
    if(!cloudReady||blocked)return;changed++;
    status('توجد تغييرات لم تُحفظ بعد…',true);
    queue=queue.then(()=>writeLatest());
  }
  async function runApp(){
    const scripts=[...document.querySelectorAll('script[data-rawaa-deferred]')];
    for(const old of scripts){
      const src=old.getAttribute('src'),script=document.createElement('script');
      if(src){await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('تعذر تحميل '+src));script.src=src;script.async=false;document.body.append(script);});}
      else{script.textContent=old.textContent;document.body.append(script);}
    }
    const legacy=$('fin-backup');if(legacy){const box=legacy.closest('.card');if(box)box.hidden=true;}
  }
  async function downloadBackup(){
    if(blocked||saved!==changed){status('انتظر اكتمال الحفظ قبل إنشاء نسخة احتياطية.',true);return;}
    const pass=prompt('أنشئ كلمة مرور للنسخة الاحتياطية المشفرة (12 حرفًا على الأقل):');
    if(pass===null)return;if(pass.length<12){status('كلمة مرور النسخة قصيرة.',true);return;}
    const confirmPass=prompt('أعد إدخال كلمة مرور النسخة:');if(confirmPass!==pass){status('كلمتا المرور غير متطابقتين.',true);return;}
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await derive(pass,salt);
    const input=encoder.encode(JSON.stringify({kind:'rawaa-work-data-v1',entries:snapshot()}));
    const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,input));
    const envelope={format:'RAWAA_WORK_AES256_GCM_V1',version:1,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};
    const blob=new Blob([JSON.stringify({format:'RAWAA_ENCRYPTED_BACKUP_V1',vault:envelope,createdAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='RAWAA_Cloud_Backup_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status('✓ تم تجهيز النسخة المشفرة. احفظها في «الملفات».');
  }
  const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
  const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  async function derive(pass,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  async function importBackup(file){
    if(blocked||saved!==changed)throw Error('احفظ كل التغييرات الحالية أولًا.');
    if(file.size>12*1024*1024)throw Error('النسخة كبيرة جدًا.');
    const data=JSON.parse(await file.text());
    if(data.format!=='RAWAA_ENCRYPTED_BACKUP_V1'||data.vault?.format!=='RAWAA_WORK_AES256_GCM_V1')throw Error('الملف ليس نسخة RAWAA مشفّرة.');
    const password=prompt('أدخل كلمة مرور النسخة القديمة:');if(password===null)return;
    const key=await derive(password,unb64(data.vault.salt));
    let entries;
    try{const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(data.vault.iv)},key,unb64(data.vault.ciphertext));const obj=JSON.parse(decoder.decode(plaintext));if(obj.kind!=='rawaa-work-data-v1')throw Error();entries=validateEntries(obj.entries);}
    catch{throw Error('كلمة مرور النسخة خاطئة أو الملف تالف.');}
    if(!confirm('ستستبدل الاستعادة جميع أسماء الموظفين والدوام والسحوبات الموجودة في حسابك السحابي. احفظ نسخة من البيانات الحالية أولًا. هل تؤكد الاستبدال؟'))return;
    localStorage._load(entries);changed++;await writeLatest();
    if(!blocked)location.reload();
  }
  function controls(){
    const bar=document.createElement('section');bar.className='rawaa-cloud-status';bar.id='rawaa-cloud-controls';
    const name=document.createElement('strong');name.textContent='RAWAA CLOUD · '+user.email;
    indicator=document.createElement('span');indicator.textContent='✓ تم الاتصال بحساب المدير';
    const actions=document.createElement('div');actions.className='rawaa-cloud-controls';
    const buttons=[['تنزيل نسخة مشفّرة',()=>downloadBackup().catch(e=>status(e.message,true))],['استيراد نسخة من الجهاز',()=>file.click()],['تحديث من السحابة',()=>{if(saved!==changed){status('توجد تغييرات معلقة لا يمكن تجاهلها.',true);return;}location.reload();}],['تسجيل الخروج',async()=>{if(saved!==changed){status('انتظر اكتمال المزامنة قبل الخروج.',true);return;}await fetch(AUTH+'/sign-out',{method:'POST',credentials:'same-origin'});location.reload();}]];
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
    file.onchange=async()=>{const f=file.files?.[0];if(f)try{await importBackup(f);}catch(e){status('تعذرت الاستعادة: '+e.message,true);}file.value='';};
    for(const [label,fn] of buttons){const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=fn;actions.append(b);}
    actions.append(file);bar.append(name,indicator,actions);
    const main=document.querySelector('main');if(main)document.body.insertBefore(bar,main);else document.body.prepend(bar);
  }
  async function poll(){
    if(blocked||!cloudReady||writing||saved!==changed||document.visibilityState==='hidden')return;
    try{
      const value=await getRemote();
      if(value&&Number(value.revision)>revision)blockEdits('تم حفظ تغييرات جديدة من جهاز آخر. افتح البيانات المحدثة قبل تسجيل المزيد.');
      if(!value&&revision!==null)blockEdits('أصبحت مساحة العمل غير متاحة.');
    }catch{status('تعذر التحقق من آخر تغييرات الأجهزة الأخرى.',true);}
  }
  async function boot(){
    const cover=gate('جلب بيانات RAWAA','جارٍ جلب سجلاتك من قاعدة البيانات السحابية قبل تفعيل النماذج.');
    try{
      const row=await getRemote();
      if(row){revision=Number(row.revision);localStorage._load(validateEntries(row.payload));}
      else{revision=null;localStorage._load({});}
      cover.parentElement.remove();
      controls();
      await runApp();
      cloudReady=true;
      localStorage._observe(persist);
      // Seed default demo staff roster only for newly created workspace; never
      // overwrite a remotely existing record.
      if(!row){changed++;await writeLatest();}
      if(blocked)return;
      if('BroadcastChannel' in window){
        const channel=new BroadcastChannel('rawaa-cloud-revision');
        channel.onmessage=e=>{if(e.data?.type==='changed'&&e.data.owner===user.id)poll();};
        const previous=localStorage._observe;
        // periodic re-fetch catches writes made on another device.
      }
      setInterval(poll,12000);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
      window.addEventListener('beforeunload',e=>{if(saved!==changed&&!blocked){e.preventDefault();e.returnValue='';}});
      status('✓ السجلات متزامنة مع السحابة');
    }catch(error){blockEdits('تعذر تهيئة التطبيق السحابي: '+error.message);}
  }
  async function begin(){
    css();
    try{if(await refreshSession())await boot();else authForm();}
    catch(error){const card=gate('خطأ في الاتصال',error.message||'تعذر الاتصال.');const b=document.createElement('button');b.textContent='إعادة المحاولة';b.onclick=()=>location.reload();card.append(b);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin);else begin();
})();