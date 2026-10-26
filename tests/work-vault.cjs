/* Node 22+: node tests/work-vault.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {TextEncoder,TextDecoder}=require('node:util');
const code=fs.readFileSync(path.join(__dirname,'..','work-vault.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','work.html'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'..','service-worker.js'),'utf8');
assert.equal((html.match(/data-rawaa-deferred/g)||[]).length,15,'all 15 legacy scripts must be deferred');
assert.equal((html.match(/<script src="\.\/work-vault\.js\?v=116">/g)||[]).length,1);
assert.ok(sw.includes("'./work.html'")&&sw.includes("'./work-vault.js?v=116'"));
assert.ok(code.includes("legacyBackup.closest('.card')"));
new Function(code);
const rows=new Map();
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.parent=null;this.value='';this.hidden=false;this.className='';this.style={};this.textContent='';this.files=[];this.listeners={};}
 append(...children){for(const item of children){item.parent=this;this.children.push(item);}}
 appendChild(item){this.append(item);return item;}
 prepend(item){item.parent=this;this.children.unshift(item);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(){}focus(){}click(){}
}
function find(node,id){if(node.id===id)return node;for(const child of node.children){const found=find(child,id);if(found)return found;}return null;}
function indexedDB(){
 return {open(){const request={};queueMicrotask(()=>{
   const database={
    objectStoreNames:{contains:()=>true},createObjectStore(){},
    transaction(_store,_mode){const tx={};
     tx.objectStore=()=>({
      get(id){const read={};queueMicrotask(()=>{read.result=rows.get(id);read.onsuccess?.();});return read;},
      put(value,id){rows.set(id,value);queueMicrotask(()=>tx.oncomplete?.());}
     });
     return tx;
    }
   };
   request.result=database;request.onsuccess?.();
 });return request;}};
}
async function boot(){
 const body=new Element('body'),head=new Element('head'),events={};
 const document={readyState:'complete',body,head,createElement:tag=>new Element(tag),getElementById:id=>find(body,id),
  querySelectorAll:()=>[],querySelector:()=>null,addEventListener(n,fn){events[n]=fn;}};
 const window={isSecureContext:true,addEventListener(){}};
 const location={reload(){}};
 const context=vm.createContext({document,window,location,indexedDB:indexedDB(),crypto:webcrypto,
  TextEncoder,TextDecoder,Uint8Array,Blob,URL,Date,JSON,Map,Object,Array,String,Number,Promise,console,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  setTimeout,confirm:()=>true});
 vm.runInContext(code,context,{filename:'work-vault.js'});
 for(let i=0;i<20&&!find(body,'work-login-overlay');i++)await new Promise(r=>setTimeout(r,0));
 assert.ok(find(body,'work-login-overlay'),'password overlay must appear before app scripts');
 return {body,window};
}
async function submitLogin(app,password,confirmation){
 const overlay=find(app.body,'work-login-overlay');
 const panel=overlay.children[0];
 const form=panel.children.find(x=>x.tag==='form');
 const first=form.children.find(x=>x.tag==='label');
 first.children[0].value=password;
 const second=form.children.filter(x=>x.tag==='label')[1];
 if(second)second.children[0].value=confirmation;
 await form.listeners.submit({preventDefault(){}});
 return form;
}
async function waitForSave(){
 for(let i=0;i<100;i++){
   const envelope=rows.get('main');
   if(envelope&&envelope.ciphertext&&envelope.ciphertext!==INITIAL_CIPHER)return;
   await new Promise(r=>setTimeout(r,50));
 }
 throw Error('Timed out waiting for encrypted write');
}
let INITIAL_CIPHER='';
(async()=>{
 const first=await boot();
 const login=await submitLogin(first,'strong-password-123456','strong-password-123456');
 assert.equal(find(first.body,'work-login-overlay'),null,'unlock must remove overlay');
 assert.ok(first.window.RAWAA_WORK_STORAGE,'virtual store exposed');
 INITIAL_CIPHER=rows.get('main').ciphertext;
 const secretName='اسم موظف سري جدًا - الرقم 120';
 first.window.RAWAA_WORK_STORAGE.setItem('RAWAA_DEMO_STAFF_V19',JSON.stringify([{id:'001',name:secretName}]));
 await waitForSave();
 assert.ok(rows.get('main').ciphertext!==INITIAL_CIPHER,'ciphertext updates');
 assert.ok(!JSON.stringify(rows.get('main')).includes(secretName),'raw names must not appear at rest');
 assert.ok(rows.get('main').salt&&rows.get('main').iv);
 const wrong=await boot();
 const wrongForm=await submitLogin(wrong,'totally-wrong-password');
 assert.ok(find(wrong.body,'work-login-overlay'),'wrong passphrase must keep the gate closed');
 assert.match(wrongForm.children.find(x=>x.className==='work-error').textContent,/غير صحيحة/);
 const second=await boot();
 await submitLogin(second,'strong-password-123456');
 assert.equal(JSON.parse(second.window.RAWAA_WORK_STORAGE.getItem('RAWAA_DEMO_STAFF_V19'))[0].name,secretName,'unlock restores the original employee data');
 console.log('PASS: scripts gated; AES-GCM ciphertext at rest; wrong password rejected; records survive reload; service worker caches private route');
})().catch(error=>{console.error(error);process.exitCode=1;});