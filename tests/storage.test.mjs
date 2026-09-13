import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness(){
 let handler,fail=false;const store={};
 const chrome={runtime:{id:'self',onMessage:{addListener:fn=>{handler=fn;}}},storage:{local:{
  get(keys,cb){const snapshot=Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,structuredClone(store[k])]));setTimeout(()=>cb(snapshot),1);},
  set(data,cb){setTimeout(()=>{if(fail){fail=false;chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;}else{Object.assign(store,structuredClone(data));cb();}},1);},
 }}};
 vm.runInNewContext(readFileSync(new URL('../storage-broker.js',import.meta.url),'utf8'),{chrome});
 return {store,failNext:()=>{fail=true;},send:payload=>new Promise(resolve=>handler({type:'YTMLS_USER_DATA',...payload},{id:'self'},resolve))};
}
test('storage: concurrent requests preserve separate songs and last-request order',async()=>{
 const h=harness(),key='ytmlsPinnedLyricsV200';
 const results=await Promise.all(Array.from({length:20},(_,i)=>h.send({action:'entry',key,videoId:'song'+i,entry:{candidateId:'A'}})));
 assert(results.every(r=>r.ok));assert.equal(Object.keys(h.store[key]).length,20);
 await Promise.all(['A','B','C'].map(candidateId=>h.send({action:'entry',key,videoId:'same',entry:{candidateId}})));
 assert.equal(h.store[key].same.candidateId,'C');
});
test('storage: failed write does not poison queue; deleting one song does not remove others',async()=>{
 const h=harness(),key='ytmlsLocalLyricsV200';
 h.failNext();assert.equal((await h.send({action:'entry',key,videoId:'fail',entry:{rawLrc:'x'}})).ok,false);
 await h.send({action:'entry',key,videoId:'keep',entry:{rawLrc:'x'}});
 await h.send({action:'entry',key,videoId:'delete',entry:{rawLrc:'x'}});
 await h.send({action:'deleteTracks',videoIds:['delete']});
 assert(h.store[key].keep);assert(!h.store[key].delete);assert(!h.store[key].fail);
});
test('storage: user corrections are not evicted by count',async()=>{
 const h=harness(),key='ytmlsTrackTimingOffsetsV174';
 h.store[key]=Object.fromEntries(Array.from({length:501},(_,i)=>['song'+i,{offsetMs:i}]));
 await h.send({action:'entry',key,videoId:'new',entry:{offsetMs:1}});
 assert.equal(Object.keys(h.store[key]).length,502);
});
