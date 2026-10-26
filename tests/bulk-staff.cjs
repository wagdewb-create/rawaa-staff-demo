const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const ids=new Map(),fields=new Map(),events={};
class El{constructor(){this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.style={}}set innerHTML(html){this.html=html;for(const tag of html.matchAll(/<(?:input|button|div|p)[^>]*>/g)){const attrs=Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));const e=new El();e.value=attrs.value||'';e.checked=/\schecked(?:\s|>)/.test(tag[0]);if(attrs.id)ids.set(attrs.id,e);if(attrs['data-emp'])fields.set(attrs['data-bulk-kind']+'|'+attrs['data-emp'],e)}}querySelector(s){const k=s.match(/data-bulk-kind="([^"]+)"/)[1],id=s.match(/data-emp="([^"]+)"/)[1];return fields.get(k+'|'+id)}addEventListener(n,fn){this[n]=fn}}
ids.set('bulk-attendance',new El());
let staff=[{id:'custom',name:'New staff',rate:25,status:'active'},{id:'old',name:'Archived',rate:20,status:'archived'}],entries=[];
const context={window:{RAWAA_RESTAURANT_TODAY:()=> '2027-01-01',RAWAA_STAFF:{getAll:()=>staff},RAWAA_ATTENDANCE_BRIDGE:{storageKey:'attendance',getEntries:()=>entries,validateImportedBatch:()=>null,replaceImported:rows=>{entries=rows}},RAWAA_DEMO_TEST:{calc:rows=>rows.map(r=>({...r,duration:8,normal:8,extra:0,wage:8*r.rate}))}},document:{getElementById:id=>ids.get(id),addEventListener:(n,f)=>events[n]=f},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},confirm:()=>true};
vm.runInNewContext(fs.readFileSync('daily-batch.js','utf8'),context);
const field=(k)=>fields.get(k+'|custom');
assert.equal(ids.get('bulk-day').value,'2027-01-01');assert.ok(ids.get('bulk-people').html.includes('New staff'));assert.ok(!ids.get('bulk-people').html.includes('Archived'));
field('enabled').checked=true;field('start').value='09:00';field('end').value='17:00';field('note').value='unsaved';
staff[0]={...staff[0],name:'Renamed',rate:30};events['rawaa:staff-changed']();assert.equal(field('enabled').checked,true);assert.equal(field('start').value,'09:00');assert.equal(field('note').value,'unsaved');assert.equal(field('rate').value,'30');
field('rate').value='27';staff[0]={...staff[0],rate:35};events['rawaa:staff-changed']();assert.equal(field('rate').value,'27');
ids.get('bulk-save').onclick();assert.equal(entries.length,1);assert.equal(entries[0].employeeId,'custom');assert.equal(entries[0].rate,27);assert.equal(entries[0].date,'2027-01-01');assert.equal(field('enabled').checked,false);
staff[0]={...staff[0],status:'archived'};events['rawaa:staff-changed']();assert.equal(ids.get('bulk-save').disabled,true);assert.equal(entries.length,1);
const weekly=fs.readFileSync('weekly-report.js','utf8');const init=weekly.slice(weekly.indexOf('const today='),weekly.indexOf('render();window.RAWAA_WEEKLY_TEST='));ids.set('weekly-start',new El());vm.runInNewContext(init,{window:context.window,$:id=>ids.get(id)});assert.equal(ids.get('weekly-start').value,'2026-12-26');
console.log('PASS: custom staff, archive exclusion, renaming, rate updates, preserved drafts and manual rates, batch save, history retention, Palestine date and week across year boundary');
