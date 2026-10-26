// Regression tests for renaming existing, new, and archived demo employees.
// Run from repository root: node tests/staff-rename.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','staff.js'),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.parent=null;this.attrs={};this.value='';this.dataset={};this.options=[];this.style={};this.hidden=false;this.listeners={};this.className='';this.textContent='';}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}if(this.tag==='select')this.options=this.children;}
 replaceChildren(...items){this.children=[];this.append(...items);if(this.tag==='select')this.options=this.children;}
 addEventListener(kind,handler){this.listeners[kind]=handler;}
 setAttribute(k,v){this.attrs[k]=v;}
 focus(){}select(){}scrollIntoView(){}reset(){}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
 closest(selector){let node=this;while(node){if(selector==='.staff-manage-card'&&node.className==='staff-manage-card')return node;node=node.parent;}return null;}
 querySelectorAll(selector){const matches=[];const walk=node=>{for(const child of node.children){if(selector==='input[data-rename-id]'&&child.tag==='input'&&child.dataset.renameId!==undefined)matches.push(child);walk(child);}};walk(this);return matches;}
 querySelector(selector){let match=null;const walk=node=>{for(const child of node.children){if(!match&&((selector==='.staff-inline-rename'&&child.className==='staff-inline-rename')||(selector==='input'&&child.tag==='input')))match=child;walk(child);}};walk(this);return match;}
}
const stored=new Map();let storageFails=false;
const localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(storageFails)throw Error('storage unavailable');stored.set(key,value);}};
function boot(){
 const nodes=new Map(),listeners=new Map();
 const document={
  getElementById(id){if(!nodes.has(id))nodes.set(id,new Element(id==='staff-form'?'form':id==='selected-employee'||id.endsWith('-employee')||id.endsWith('-filter')?'select':'div'));return nodes.get(id);},
  createElement:tag=>new Element(tag),
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
  dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);}
 };
 let staffChanges=0;document.addEventListener('rawaa:staff-changed',()=>{staffChanges++;});
 const window={RAWAA_ATTENDANCE_BRIDGE:{getEntries:()=>[{employeeId:'001'}]},RAWAA_FINANCE_TEST:{getTransactions:()=>[{employeeId:'001'}]}};
 const Event=class{constructor(type){this.type=type;}};
 new Function('window','document','localStorage','Event','confirm',source)(window,document,localStorage,Event,()=>true);
 return {window,document,get staffChanges(){return staffChanges;}};
}
const app=boot(),api=app.window.RAWAA_STAFF;
const oldId=api.getAll()[0].id,originalRate=api.getAll()[0].rate;
assert.equal(api.renameEmployees([{id:oldId,name:'  موظف   معدل  '}]),1);
assert.equal(api.getById(oldId).name,'موظف معدل');
assert.equal(api.getById(oldId).rate,originalRate);
assert.equal(app.window.RAWAA_ATTENDANCE_BRIDGE.getEntries()[0].employeeId,oldId);
assert.equal(app.window.RAWAA_FINANCE_TEST.getTransactions()[0].employeeId,oldId);
assert.equal(app.staffChanges,1);
assert.equal(api.renameEmployees([{id:oldId,name:'موظف معدل'}]),0);
assert.throws(()=>api.renameEmployees([{id:'002',name:'   '}]));
assert.throws(()=>api.renameEmployees([{id:'missing',name:'مجهول'}]));
assert.throws(()=>api.renameEmployees([{id:'002',name:'موظف معدل'}]));
assert.throws(()=>api.renameEmployees([{id:'002',name:'أ'},{id:'002',name:'ب'}]));
const fresh={...api.getAll()[0],id:'new-employee',name:'موظف جديد',status:'active'};
api.replaceRoster([...api.export(),fresh]);
api.getById('003').status='archived';
assert.equal(api.renameEmployees([{id:'003',name:'اسم مؤرشف'},{id:'new-employee',name:'اسم جديد'}]),2);
assert.equal(api.getById('003').name,'اسم مؤرشف');
assert.equal(api.getById('new-employee').name,'اسم جديد');
storageFails=true;
assert.throws(()=>api.renameEmployees([{id:oldId,name:'غير محفوظ'}]),/تعذر حفظ/);
assert.equal(api.getById(oldId).name,'موظف معدل');
storageFails=false;
const cards=app.document.getElementById('staff-manage-cards');
const first=cards.children[0],renameButton=first.children.find(c=>c.dataset.renameStaff===oldId);
assert.ok(renameButton);
cards.listeners.click({target:{closest:()=>renameButton}});
const inline=first.querySelector('.staff-inline-rename');
assert.ok(inline);
inline.querySelector('input').value='تعديل مباشر';
inline.listeners.submit({preventDefault(){}});
assert.equal(api.getById(oldId).name,'تعديل مباشر');
const manager=app.document.getElementById('staff-manager');
const bulk=manager.children.find(node=>node.className==='staff-bulk-rename');
assert.ok(bulk);
const toggle=bulk.children[0],form=bulk.children[2];
toggle.listeners.click();
assert.equal(form.hidden,false);
const inputs=form.querySelectorAll('input[data-rename-id]');
assert.equal(inputs.length,4);
inputs.find(node=>node.dataset.renameId==='002').value='اسم جماعي';
form.listeners.submit({preventDefault(){}});
assert.equal(api.getById('002').name,'اسم جماعي');
assert.equal(form.hidden,true);
const restarted=boot();
assert.equal(restarted.window.RAWAA_STAFF.getById(oldId).name,'تعديل مباشر');
assert.equal(restarted.window.RAWAA_STAFF.getById('002').name,'اسم جماعي');
console.log('PASS: safe staff rename, archived/new staff, inline and bulk UI, unchanged history IDs, validation, rollback, and reload');
