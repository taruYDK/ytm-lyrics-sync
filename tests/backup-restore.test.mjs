import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../extension/backup.js',import.meta.url),'utf8').split('exportButton.addEventListener')[0];
function harness({failSync=false,failLocal=false,failRollback=false}={}){
 const store={fontSize:40},events=[];let writes=0;
 const chrome={runtime:{},storage:{sync:{
  get(keys,cb){cb(Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,store[k]])));},
  set(data,cb){events.push('sync');writes++;if((failSync&&writes===1)||(failRollback&&writes===2)){chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;}else {Object.assign(store,data);cb();}},
  remove(keys,cb){for(const k of keys)delete store[k];cb();}
 }}};
 const c=vm.createContext({chrome,document:{getElementById:()=>({})},mutateData:async()=>{events.push('local');if(failLocal)throw Error('local failure');}});
 vm.runInContext(code,c);
 return {store,events,run:()=>vm.runInContext('restoreBackupData({fontSize:64,readingJapanese:false},{ytmlsPinnedLyricsV200:{}})',c)};
}
test('backup restore: completes sync before local, rolls sync back if local fails',async()=>{
 const ok=harness();await ok.run();assert.deepEqual(ok.events,['sync','local']);assert.equal(ok.store.fontSize,64);
 const local=harness({failLocal:true});await assert.rejects(local.run(),/local failure/);assert.deepEqual(local.store,{fontSize:40});
 const sync=harness({failSync:true});await assert.rejects(sync.run(),/quota/);assert.deepEqual(sync.events,['sync']);assert.deepEqual(sync.store,{fontSize:40});
});
test('backup restore: reports rollback failure explicitly',async()=>{
 const h=harness({failLocal:true,failRollback:true});await assert.rejects(h.run(),/巻き戻しにも失敗/);
});
