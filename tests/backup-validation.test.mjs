import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('backup page: invalid local or sync data is rejected before either storage area is written',async()=>{
 for(const backup of [
 {sync:{enabled:false},local:{ytmlsLocalLyricsV200:{song:{rawLrc:42}}}},
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
