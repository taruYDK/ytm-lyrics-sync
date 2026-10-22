import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+(name.startsWith('src/')?'':'extension/')+name,import.meta.url),'utf8');
test('backup page: invalid sync settings are rejected before either storage area is written',async()=>{
 for(const backup of [
 {sync:{trackingPosition:500},local:{ytmlsLocalLyricsV200:{song:{rawLrc:'[00:00]valid'}}}}
 ]) {
 let writes=0;const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);},querySelectorAll:()=>[]};
 const c=vm.createContext({document,window:{confirm:()=>true},chrome:{storage:{sync:{set:()=>writes++}},runtime:{}},managerBusy:false,selectedTracks:new Set(),mutateData:()=>writes++});
 vm.runInContext(read('backup-validation.js'),c);vm.runInContext(read('backup.js'),c);
 elements.get('importFile').files=[{size:100,text:async()=>JSON.stringify({format:'ytm-lyrics-sync-backup',formatVersion:1,...backup})}];
 await elements.get('importFile').handlers.change();
 assert.equal(writes,0);assert.match(elements.get('status').textContent,/形式が不正/);
 }
});

test('partial backup import reports rejected songs and requests a preserving merge',async()=>{
 const elements=new Map(),operations=[],prompts=[];
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);},querySelectorAll:()=>[]};
 const c=vm.createContext({document,window:{confirm:message=>{prompts.push(message);return true;}},chrome:{storage:{sync:{}},runtime:{}},managerBusy:false,selectedTracks:new Set(),refreshSavedTracks:async()=>{},mutateData:async op=>operations.push(op)});
 vm.runInContext(read('backup-validation.js'),c);vm.runInContext(read('backup.js'),c);
 elements.get('importFile').files=[{size:100,text:async()=>JSON.stringify({format:'ytm-lyrics-sync-backup',formatVersion:1,sync:{},local:{ytmlsLocalLyricsV200:{bad:{rawLrc:42},good:{rawLrc:'[00:00]good'}}}})}];
 await elements.get('importFile').handlers.change();assert.equal(operations.length,1);assert.equal(operations[0].merge,true);assert.deepEqual(Object.keys(operations[0].data.ytmlsLocalLyricsV200),['good']);assert.match(prompts[0],/1件/);assert.match(prompts[0],/バックアップにない曲は残します/);assert.doesNotMatch(prompts[0],/上書きします/);assert.match(elements.get('status').textContent,/1件.*保持/);
});
