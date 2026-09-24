import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('popup version follows manifest rather than a fixed release string',()=>{
  const html=readFileSync(new URL('../popup.html',import.meta.url),'utf8');
  assert.match(html,/id="extensionVersion"><\/div>/);
  const source=readFileSync(new URL('../popup.js',import.meta.url),'utf8');
  for(const version of ['2.2.0','9.8.7']){
    const elements=new Map();
    const document={createElement:()=>({}),addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(){}});return elements.get(id);}};
    const chrome={runtime:{getManifest:()=>({version})},storage:{local:{get(){}},sync:{get(){}}}};
    vm.runInNewContext(source,{document,chrome,window:{addEventListener(){}}});
    assert.equal(elements.get('extensionVersion').textContent,`v${version}`);
  }
});

test('popup: tracking settings restore, save numeric values and report failures',()=>{
 let load;const elements=new Map(),writes=[];
 const document={createElement:()=>({}),addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',style:{},dataset:{},options:[],appendChild(option){this.options.push(option);},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return elements.get(id);}};
 const chrome={runtime:{getManifest:()=>({version:'2.4.1'})},storage:{local:{get(){}},sync:{get:(defaults,cb)=>load=()=>cb({...defaults,trackingPosition:35,manualScrollReturnMs:5000}),set:(value,cb)=>{writes.push(value);cb();}}}};
 const c=vm.createContext({document,chrome,window:{addEventListener(){}},setTimeout:()=>1,clearTimeout(){}});vm.runInContext(readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);
 c.renderProviderList=()=>{};load();
 assert.equal(elements.get('trackingPosition').value,35);assert.equal(elements.get('manualScrollReturnMs').value,'5000');
 const position=elements.get('trackingPosition');position.value='45';position.handlers.input();position.handlers.change();c.flushTrackingSettings();
 assert.equal(writes[0].trackingPosition,45);assert.equal(elements.get('trackingPositionValue').textContent,'上から45%');
 const delay=elements.get('manualScrollReturnMs');delay.value='1000';delay.handlers.change();c.flushTrackingSettings();assert.equal(writes[1].manualScrollReturnMs,1000);
 chrome.runtime.lastError={message:'quota'};position.handlers.change();c.flushTrackingSettings();assert.match(elements.get('trackingSettingsStatus').textContent,/保存できません/);
});

test('popup: rapid changes are coalesced and closing flushes the latest values',()=>{
 const elements=new Map(),timers=new Map(),events={},writes=[];let timerId=0;
 const document={createElement:()=>({}),addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);}};
 const chrome={runtime:{getManifest:()=>({version:'test'})},storage:{local:{get(){}},sync:{get(){},set:(v,cb)=>{writes.push(v);cb();}}}};
 const c=vm.createContext({document,chrome,window:{addEventListener:(name,fn)=>events[name]=fn},
 setTimeout:(fn,ms)=>{assert([500,2200].includes(ms));timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);
 for(let i=0;i<200;i++)c.saveTrackingSetting('trackingPosition',25+i%41);
 c.saveTrackingSetting('manualScrollReturnMs',5000);
 assert.equal(writes.length,0);assert.equal(timers.size,1);
 [...timers.values()][0]();assert.equal(writes.length,1);assert.equal(writes[0].trackingPosition,60);assert.equal(writes[0].manualScrollReturnMs,5000);
 c.saveTrackingSetting('trackingPosition',42);events.pagehide();assert.equal(writes.length,2);assert.equal(writes[1].trackingPosition,42);assert.equal(timers.size,1);
});

test('popup: restored custom choices match runtime and notices expire or report failure',()=>{
 const elements=new Map(),timers=new Map();let count=0,fail=false;
 const document={createElement:()=>({}),addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{options:[],appendChild(o){this.options.push(o);},addEventListener(){}});return elements.get(id);}};
 const c=vm.createContext({document,window:{addEventListener(){}},setTimeout:(fn,ms)=>{assert.equal(ms,2200);timers.set(++count,fn);return count;},clearTimeout:id=>timers.delete(id),
 chrome:{runtime:{getManifest:()=>({version:'test'})},storage:{local:{get(){}},sync:{get(){},set(data,cb){if(fail)c.chrome.runtime.lastError={message:'quota'};cb();delete c.chrome.runtime.lastError;}}}}});
 vm.runInContext(readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);
 const font=document.getElementById('fontSizeSelect'),delay=document.getElementById('manualScrollReturnMs');
 c.selectRestoredValue(font,30,32,10,100,v=>v+'px');c.selectRestoredValue(delay,4000,3500,1000,10000,v=>v/1000+'秒');
 assert.equal(font.value,'30');assert.equal(delay.value,'4000');assert.equal(font.options[0].value,'30');assert.equal(delay.options[0].value,'4000');
 c.saveProviderConfig();const note=elements.get('providerNote');assert.match(note.textContent,/保存しました/);
 [...timers.values()][0]();assert.equal(note.textContent,'');
 fail=true;c.saveProviderConfig();assert.match(note.textContent,/保存できません/);
});

