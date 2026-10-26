/* RAWAA 1.16 — encrypted one-device workspace, not a cloud payroll backend.
   This script MUST remain a classic script, not type="module": the global lexical
   localStorage binding deliberately isolates all deferred existing app scripts. */
const localStorage = (() => {
  const data = new Map();
  let onChange = () => {};
  const api = {
    getItem(key) { key=String(key); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(String(key),String(value)); onChange(); },
    removeItem(key) { data.delete(String(key)); onChange(); },
    clear() { data.clear(); onChange(); },
    key(index) { return [...data.keys()][index] ?? null; },
    get length() { return data.size; },
    _load(entries) { data.clear(); for(const [k,v] of Object.entries(entries)){data.set(k,String(v));} },
    _snapshot() { return Object.fromEntries(data); },
    _observe(fn) { onChange=fn; }
  };
  return api;
})();
window.RAWAA_WORK_STORAGE = localStorage;

(() => {
  'use strict';
  const DB_NAME='RAWAA_Work_Encrypted_v1', STORE='vaults', RECORD='main';
  const FORMAT='RAWAA_WORK_AES256_GCM_V1', ITERATIONS=310000;
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  let db=null,secret=null,salt=null,record=null,unlocked=false,queue=Promise.resolve();
  let revision=0,savedRevision=0,failed=false,lockedByPeer=false,channel=null;
  let statusText=null;
  const $=id=>document.getElementById(id);
  const encode=a=>{let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);};
  const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const random=n=>crypto.getRandomValues(new Uint8Array(n));
  const cryptoReady=()=>window.isSecureContext&&crypto?.subtle&&indexedDB;
  function openDatabase(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains(STORE))database.createObjectStore(STORE);};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('تعذر فتح قاعدة التخزين.'));
    request.onblocked=()=>reject(Error('التخزين محجوز في تبويب آخر.'));
  });}
  function readRecord(){return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(RECORD);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
  });}
  function writeRecord(value){return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('فشل التخزين'));tx.onabort=()=>reject(tx.error||Error('توقف الحفظ'));
    tx.objectStore(STORE).put(value,RECORD);
  });}
  async function derive(password,s){const base=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:ITERATIONS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  function validateEnvelope(v){return !!(v&&v.format===FORMAT&&v.version===1&&v.salt&&v.iv&&v.ciphertext&&typeof v.salt==='string'&&typeof v.iv==='string'&&typeof v.ciphertext==='string');}
  function validateContent(value){if(!value||value.kind!=='rawaa-work-data-v1'||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))throw Error('نسخة البيانات غير صالحة.');return value.entries;}
  async function decrypt(envelope,password){
    if(!validateEnvelope(envelope))throw Error('ملف البيانات المشفرة غير مدعوم.');
    const derived=await derive(password,decode(envelope.salt));
    try{
      const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv)},derived,decode(envelope.ciphertext));
      return {key:derived,entries:validateContent(JSON.parse(decoder.decode(bytes)))};
    }catch(_){throw Error('كلمة المرور غير صحيحة أو البيانات تالفة.');}
  }
  async function encrypt(entries,key,currentSalt){
    const iv=random(12),message=encoder.encode(JSON.stringify({kind:'rawaa-work-data-v1',entries}));
    const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,message));
    return {format:FORMAT,version:1,salt:encode(currentSalt),iv:encode(iv),ciphertext:encode(ciphertext),updatedAt:new Date().toISOString()};
  }
  function setStatus(message,error=false){
    if(statusText){statusText.textContent=message;statusText.style.color=error?'#9f281d':'#175c43';}
  }
  function persist(){
    if(!unlocked||failed||lockedByPeer)return;
    const current=++revision,snapshot=localStorage._snapshot();
    setStatus('جارٍ تشفير البيانات وحفظها على هذا الآيفون…');
    queue=queue.then(async()=>{
      const next=await encrypt(snapshot,secret,salt);
      await writeRecord(next);record=next;savedRevision=current;
      if(savedRevision===revision)setStatus('✓ تم حفظ البيانات مشفرة على هذا الجهاز');
      if(channel)channel.postMessage({type:'update',id:SESSION_ID});
    }).catch(error=>{
      failed=true;setStatus('تعذر حفظ البيانات! توقف عن إدخال سجلات جديدة، وحاول تصدير نسخة احتياطية.',true);
      showCritical('فشل الحفظ المشفر. لا تعتمد التعديلات الحالية قبل إصلاح التخزين. '+(error.message||''));
    });
  }
  const SESSION_ID=encode(random(10));
  function showCritical(message){
    if($('work-fail-overlay'))return;
    const shield=document.createElement('div');shield.id='work-fail-overlay';shield.className='work-lock-screen';
    const panel=document.createElement('div');panel.className='work-lock-panel';
    const h=document.createElement('h2');h.textContent='تنبيه لحماية سجلات العمل';
    const p=document.createElement('p');p.textContent=message;const b=document.createElement('button');b.type='button';b.textContent='إعادة فتح الصفحة';b.onclick=()=>location.reload();
    panel.append(h,p,b);shield.append(panel);document.body.append(shield);
  }
  function showStatusBar(){
    const bar=document.createElement('section');bar.id='work-control-bar';bar.className='work-control-bar';bar.setAttribute('aria-label','إدارة مساحة العمل المحلية');
    const title=document.createElement('strong');title.textContent='RAWAA | العمل المحلي المشفّر';
    statusText=document.createElement('span');statusText.textContent='✓ مساحة العمل مفتوحة';
    const buttons=document.createElement('div');buttons.className='work-controls';
    const backup=document.createElement('button');backup.type='button';backup.textContent='تنزيل نسخة مشفّرة';
    backup.onclick=async()=>{await queue;if(failed||!record){setStatus('تعذر إنشاء نسخة بسبب فشل الحفظ.',true);return;}
      const file={format:'RAWAA_ENCRYPTED_BACKUP_V1',createdAt:new Date().toISOString(),vault:record};
      const blob=new Blob([JSON.stringify(file,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='RAWAA_Encrypted_Backup_'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      setStatus('✓ تم تجهيز نسخة مشفّرة. احفظ الملف في «الملفات» خارج المتصفح.');
    };
    const restore=document.createElement('button');restore.type='button';restore.textContent='استعادة نسخة';
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
    restore.onclick=()=>file.click();
    file.onchange=async()=>{const selected=file.files?.[0];if(!selected)return;if(selected.size>12000000){setStatus('الملف كبير جدًا (الحد 12 ميغابايت).',true);file.value='';return;}
      try{
        const incoming=JSON.parse(await selected.text());
        if(incoming.format!=='RAWAA_ENCRYPTED_BACKUP_V1'||!validateEnvelope(incoming.vault))throw Error('ليست نسخة RAWAA مشفرة مدعومة.');
        const pass=window.prompt('أدخل كلمة مرور النسخة الاحتياطية لاستعادتها:');
        if(pass===null)return;
        const tested=await decrypt(incoming.vault,pass);
        if(!Object.keys(tested.entries).every(k=>typeof tested.entries[k]==='string'))throw Error('صيغة البيانات غير سليمة.');
        if(!confirm('سيُستبدل كل محتوى مساحة العمل الحالية بمحتوى النسخة المحددة. تأكد من حفظ نسخة حالية أولًا. هل تريد المتابعة؟'))return;
        await queue;if(failed)throw Error('التخزين الحالي فشل، لا يمكن الاستعادة الآن.');
        await writeRecord(incoming.vault);location.reload();
      }catch(error){setStatus('تعذرت الاستعادة: '+(error.message||'خطأ في الملف'),true);}
      finally{file.value='';}
    };
    const lock=document.createElement('button');lock.type='button';lock.textContent='قفل';
    lock.onclick=async()=>{await queue;location.reload();};
    buttons.append(backup,restore,file,lock);bar.append(title,statusText,buttons);
    const main=document.querySelector('main');if(main)document.body.insertBefore(bar,main);else document.body.prepend(bar);
    window.addEventListener('beforeunload',event=>{if(revision!==savedRevision&&!failed){event.preventDefault();event.returnValue='';}});
  }
  function setupPeerDetection(){
    if(!('BroadcastChannel' in window))return;
    channel=new BroadcastChannel('rawaa-work-vault-v1');
    channel.onmessage=e=>{
      if(e.data?.type!=='update'||e.data.id===SESSION_ID||lockedByPeer)return;
      lockedByPeer=true;
      showCritical('تم تعديل مساحة العمل من نافذة أخرى. أغلق هذه النافذة أو أعد فتحها قبل إضافة سجلات جديدة حتى لا تستبدل تغييراتك.');
    };
  }
  async function runExistingApp(){
    const scripts=[...document.querySelectorAll('script[data-rawaa-deferred]')];
    for(const old of scripts){
      const src=old.getAttribute('src'),script=document.createElement('script');
      if(src){
        await new Promise((resolve,reject)=>{
          script.onload=resolve;script.onerror=()=>reject(Error('فشل تحميل '+src));
          script.src=src;script.async=false;document.body.append(script);
        });
      }else{script.textContent=old.textContent;document.body.append(script);}
    }
  }
  function addStyles(){
    const style=document.createElement('style');style.textContent='.work-lock-screen{position:fixed;inset:0;z-index:999999;background:#092e27;display:grid;place-items:center;padding:18px;overflow-y:auto;direction:rtl}.work-lock-panel{box-sizing:border-box;background:#fff;color:#153d32;border-radius:18px;padding:22px;width:100%;max-width:455px;box-shadow:0 20px 60px #0005}.work-lock-panel h2{margin:0 0 10px;font-size:23px}.work-lock-panel p{font-size:13px;color:#536b5e}.work-lock-panel label{display:block;margin:12px 0}.work-lock-panel input{display:block;width:100%;box-sizing:border-box;min-height:46px;font:inherit;border:1px solid #a9c4ae;border-radius:10px;padding:10px}.work-lock-panel button{background:#103e34;color:white;border:0;border-radius:10px;min-height:46px;padding:10px 18px;font-weight:bold;font:inherit;width:100%;cursor:pointer}.work-lock-panel .work-error{color:#aa2c22;font-weight:650}.work-control-bar{max-width:1050px;margin:12px auto;padding:12px 15px;border-radius:14px;background:#e4f2e9;border:1px solid #9dc8b0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;direction:rtl;font-size:13px}.work-control-bar strong{color:#153d32}.work-control-bar span{flex:1 1 230px;font-weight:700}.work-controls{display:flex;gap:7px;flex-wrap:wrap}.work-controls button{border:1px solid #265e49;color:#174837;background:white;padding:8px 10px;border-radius:9px;min-height:42px;font-weight:700;cursor:pointer}@media(max-width:480px){.work-controls{width:100%}.work-controls button{flex:1 1 42%}}';document.head.append(style);
  }
  async function start(){
    addStyles();
    if(!cryptoReady()){showCritical('هذا الوضع يتطلب Safari حديثًا واتصال HTTPS مع تفعيل التخزين الخاص بالمتصفح. لا تدخل بيانات في صفحة غير مشفّرة.');return;}
    try{db=await openDatabase();record=await readRecord();}
    catch(error){showCritical('لم نتمكن من فتح التخزين المشفر: '+(error.message||''));return;}
    const newVault=!record;
    if(record&&!validateEnvelope(record)){showCritical('البيانات المحلية موجودة لكن صيغتها غير مدعومة. لا تحذف بيانات Safari؛ احتفظ بالنسخ الاحتياطية.');return;}
    const shield=document.createElement('div');shield.className='work-lock-screen';shield.id='work-login-overlay';
    const panel=document.createElement('div');panel.className='work-lock-panel';
    const title=document.createElement('h2');title.textContent=newVault?'إعداد مساحة عمل RAWAA':'فتح مساحة عمل RAWAA';
    const description=document.createElement('p');description.textContent=newVault?'أنشئ كلمة مرور قوية من 12 حرفًا على الأقل. تُشفَّر السجلات على هذا الجهاز فقط. فقدان الكلمة أو حذف بيانات Safari قد يفقد السجلات؛ نزّل نسخة مشفرة يوميًا.':'أدخل كلمة المرور لفتح سجلاتك. لا يوجد حساب سحابي أو إمكانية استعادة كلمة المرور.';
    const form=document.createElement('form');
    const label=document.createElement('label');label.textContent=newVault?'إنشاء كلمة المرور':'كلمة المرور';
    const pass=document.createElement('input');pass.type='password';pass.required=true;pass.autocomplete=newVault?'new-password':'current-password';pass.id='work-pass';
    label.append(pass);form.append(label);
    let confirmation=null;
    if(newVault){const confirmLabel=document.createElement('label');confirmLabel.textContent='تأكيد كلمة المرور';confirmation=document.createElement('input');confirmation.type='password';confirmation.required=true;confirmation.autocomplete='new-password';confirmLabel.append(confirmation);form.append(confirmLabel);}
    const error=document.createElement('p');error.className='work-error';error.setAttribute('role','alert');
    const submit=document.createElement('button');submit.type='submit';submit.textContent=newVault?'تشفير مساحة العمل وفتحها':'فتح السجلات';
    form.append(error,submit);panel.append(title,description,form);
    const demo=document.createElement('p');demo.textContent='مهم: البيانات لا تتزامن بين الأجهزة. لا تستخدم هذا الوضع لصرف الرواتب نهائيًا دون تدقيق ونسخ احتياطية.';panel.append(demo);shield.append(panel);document.body.append(shield);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(submit.disabled)return;submit.disabled=true;error.textContent='';
      try{
        const password=pass.value;
        if(newVault){
          if(password.length<12)throw Error('كلمة المرور يجب أن تحتوي على 12 حرفًا على الأقل.');
          if(password!==confirmation.value)throw Error('كلمتا المرور غير متطابقتين.');
          salt=random(16);secret=await derive(password,salt);record=await encrypt({},secret,salt);await writeRecord(record);localStorage._load({});
        }else{
          const opened=await decrypt(record,password);salt=decode(record.salt);secret=opened.key;localStorage._load(opened.entries);
        }
        unlocked=true;localStorage._observe(persist);
        shield.remove();showStatusBar();setupPeerDetection();
        await runExistingApp();
        setStatus('✓ مساحة العمل مفتوحة والسجلات مشفّرة على هذا الجهاز');
      }catch(err){error.textContent=err.message||'تعذر فتح السجلات.';submit.disabled=false;}
      pass.value='';if(confirmation)confirmation.value='';
    });
    pass.focus();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();