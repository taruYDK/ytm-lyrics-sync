import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness(){
 let handler,fail=false;const store={};
 const chrome={runtime:{id:'self',onMessage:{addListener:fn=>{handler=fn;}}},storage:{local:{
  get(keys,cb){const snapshot=Object.fromEntries((keys || Object.keys(store)).filter(k=>k in store).map(k=>[k,structuredClone(store[k])]));setTimeout(()=>cb(snapshot),1);},
  remove(keys,cb){for(const key of keys) delete store[key];cb();},
  set(data,cb){setTimeout(()=>{if(fail){fail=false;chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;}else{Object.assign(store,structuredClone(data));cb();}},1);},
 }}};
 const context=vm.createContext({chrome});
 vm.runInContext(readFileSync(new URL('../backup-validation.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../storage-broker.js',import.meta.url),'utf8'),context);
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

test('timing nudge: concurrent increments use committed values and preserve curve',async()=>{
 const h=harness(),key='ytmlsTrackTimingOffsetsV174';
 h.store[key]={song:{points:[{position:0,offsetMs:0},{position:0.5,offsetMs:500}]}};
 const results=await Promise.all(Array.from({length:10},()=>h.send({action:'nudgeTiming',videoId:'song',deltaMs:100})));
 assert(results.every(r=>r.ok));assert.deepEqual(h.store[key].song.points.map(p=>p.offsetMs),[1000,1500]);
 await h.send({action:'nudgeTiming',videoId:'song',deltaMs:-100});
 assert.deepEqual(h.store[key].song.points.map(p=>p.offsetMs),[900,1400]);
});
test('timing nudge: limits, failed saves, other songs and reset to zero',async()=>{
 const h=harness(),key='ytmlsTrackTimingOffsetsV174';
 h.store[key]={limit:{points:[{position:0,offsetMs:19900},{position:0.5,offsetMs:20000}]},keep:{offsetMs:300}};
 await h.send({action:'nudgeTiming',videoId:'limit',deltaMs:100});
 assert.deepEqual(h.store[key].limit.points.map(p=>p.offsetMs),[19900,20000]);
 h.failNext();assert.equal((await h.send({action:'nudgeTiming',videoId:'new',deltaMs:100})).ok,false);
 assert(!h.store[key].new);
 await h.send({action:'nudgeTiming',videoId:'new',deltaMs:100});
 assert.equal(h.store[key].new.offsetMs,100);
 await h.send({action:'nudgeTiming',videoId:'new',deltaMs:-100});assert(!h.store[key].new);
 assert.equal(h.store[key].keep.offsetMs,300);
 assert.equal((await h.send({action:'nudgeTiming',videoId:'keep',deltaMs:Infinity})).ok,false);
});

test('restore: valid current and legacy entries restore without mutation',async()=>{
 const h=harness();const data={
 ytmlsTrackTimingOffsetsV174:{legacy:100,song:{points:[{position:0,offsetMs:-100},{position:0.5,offsetMs:500}]}},
 ytmlsManualSearchOverridesV190:{song:{title:'title',artist:'artist'}},
 ytmlsLyricsEditsV199:{song:{candidates:{candidate:{originalLineCount:2,replacements:{0:'edited',1:''}}}}},
 ytmlsPinnedLyricsV200:{song:{candidateId:'candidate',result:{syncLevel:'word',lines:[{time:0,end:null,text:'hello',words:[{time:0,end:1,text:'hello'}]}]}}},
 ytmlsLocalLyricsV200:{song:{rawLrc:'[00:00.00]hello'}}};
 const before=structuredClone(data);assert.equal((await h.send({action:'restore',data})).ok,true);
 assert.deepEqual(h.store,data);assert.deepEqual(data,before);
});
test('restore: malformed entries reject the whole operation and preserve existing data',async()=>{
 const h=harness();h.store.ytmlsLocalLyricsV200={keep:{rawLrc:'[00:00]keep'}};const before=structuredClone(h.store);
 const invalid=[
 {ytmlsTrackTimingOffsetsV174:{song:{points:[{position:2,offsetMs:100}]}}},
 {ytmlsTrackTimingOffsetsV174:{song:{offsetMs:'invalid'}}},
 {ytmlsPinnedLyricsV200:{song:{candidateId:'x',result:{lines:[null]}}}},
 {ytmlsLyricsEditsV199:{song:{candidates:{x:{originalLineCount:1,replacements:{2:'invalid'}}}}}},
 {ytmlsManualSearchOverridesV190:{song:{title:123,artist:'a'}}},
 {ytmlsLocalLyricsV200:{song:{rawLrc:42}}},
 JSON.parse('{"ytmlsLocalLyricsV200":{"__proto__":{"rawLrc":"[00:00]bad"}}}')
 ];
 for(const bad of invalid){const result=await h.send({action:'restore',data:{ytmlsLocalLyricsV200:{new:{rawLrc:'[00:00]new'}},...bad}});assert.equal(result.ok,false);assert.deepEqual(h.store,before);}
 assert.equal((await h.send({action:'entry',key:'ytmlsLocalLyricsV200',videoId:'next',entry:{rawLrc:'[00:00]ok'}})).ok,true);
});

test('manual readings: migration, restore validation and track deletion include readings',async()=>{
 const h=harness(),key='ytmlsManualReadingsV256';
 const entries=[{text:'君',start:0,end:1,lineIndex:0,reading:'きみ'}];
 h.store.ytmls_manual_readings_song=entries;
 assert.equal((await h.send({action:'migrateReadings'})).ok,true);
 assert.deepEqual(h.store[key].song.entries,entries);
 assert.equal(h.store.ytmls_manual_readings_song,undefined);
 const backup=structuredClone(h.store[key]);
 await h.send({action:'deleteTracks',videoIds:['song']});assert(!h.store[key].song);
 assert.equal((await h.send({action:'restore',data:{[key]:backup}})).ok,true);
 assert.deepEqual(h.store[key].song.entries,entries);
 assert.equal((await h.send({action:'restore',data:{[key]:{bad:{entries:[{text:'x',start:0,end:99,reading:'y'}]}}}})).ok,false);
 assert.deepEqual(h.store[key].song.entries,entries);
});

test('manual readings: failed migration retains legacy data for retry',async()=>{
 const h=harness();const entries=[{text:'君',start:0,end:1,reading:'きみ'}];
 h.store.ytmls_manual_readings_song=entries;h.failNext();
 assert.equal((await h.send({action:'migrateReadings'})).ok,false);
 assert.deepEqual(h.store.ytmls_manual_readings_song,entries);
 assert.equal((await h.send({action:'migrateReadings'})).ok,true);
 assert.deepEqual(h.store.ytmlsManualReadingsV256.song.entries,entries);
});
