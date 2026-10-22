import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness(){
 let handler,fail=false;const store={},removals=[];
 const chrome={runtime:{id:'self',onMessage:{addListener:fn=>{handler=fn;}}},storage:{local:{
  get(keys,cb){const snapshot=Object.fromEntries((keys || Object.keys(store)).filter(k=>k in store).map(k=>[k,structuredClone(store[k])]));setTimeout(()=>cb(snapshot),1);},
  getBytesInUse(keys,cb){cb(keys.reduce((n,key)=>n+(key in store?JSON.stringify(store[key]).length+key.length:0),0));},
  remove(keys,cb){removals.push([...keys]);for(const key of keys) delete store[key];cb();},
  set(data,cb){setTimeout(()=>{if(fail){fail=false;chrome.runtime.lastError={message:'quota'};cb();delete chrome.runtime.lastError;}else{Object.assign(store,structuredClone(data));cb();}},1);},
 }}};
 const context=vm.createContext({chrome});
 vm.runInContext(readFileSync(new URL('../extension/backup-validation.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../extension/storage-broker.js',import.meta.url),'utf8'),context);
 return {store,removals,failNext:()=>{fail=true;},send:payload=>new Promise(resolve=>handler({type:'YTMLS_USER_DATA',...payload},{id:'self'},resolve))};
}
test('storage: concurrent requests preserve separate songs and last-request order',async()=>{
 const h=harness(),key='ytmlsPinnedLyricsV200';
 const results=await Promise.all(Array.from({length:20},(_,i)=>h.send({action:'entry',key,videoId:'song'+i,entry:{candidateId:'A',result:{lines:[{time:0,text:'a'}]}}})));
 assert(results.every(r=>r.ok));assert.equal(Object.keys(h.store[key]).length,20);
 await Promise.all(['A','B','C'].map(candidateId=>h.send({action:'entry',key,videoId:'same',entry:{candidateId,result:{lines:[{time:0,text:'a'}]}}})));
 assert.equal(h.store[key].same.candidateId,'C');
});
test('storage: failed write does not poison queue; deleting one song does not remove others',async()=>{
 const h=harness(),key='ytmlsLocalLyricsV200';
 h.failNext();assert.equal((await h.send({action:'entry',key,videoId:'fail',entry:{rawLrc:'[00:00]x'}})).ok,false);
 await h.send({action:'entry',key,videoId:'keep',entry:{rawLrc:'[00:00]x'}});
 await h.send({action:'entry',key,videoId:'delete',entry:{rawLrc:'[00:00]x'}});
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

test('manual readings: migration marker prevents full reads and replies contain only requested song',async()=>{
 const h=harness();h.store.ytmlsReadingsMigratedV262=true;
 h.store.ytmlsManualReadingsV256={a:{entries:[{text:'a'}]},b:{entries:[{text:'b'}]}};
 Object.defineProperty(h.store,'privateCache',{enumerable:true,get(){throw Error('full storage read');}});
 const r=await h.send({action:'readReadings',videoId:'a'});assert.equal(r.ok,true);
 assert.deepEqual(structuredClone(r.data),{entries:[{text:'a'}]});
});

test('undo: lyrics edits restore prior values without affecting another song',async()=>{
 const h=harness(),key='ytmlsLyricsEditsV199';
 const save=(id,text)=>h.send({action:'edit',videoId:id,candidateId:'a',entry:{originalLineCount:1,replacements:{0:text}},captureUndo:true});
 await save('song','before');const result=await save('song','after');await save('other','keep');
 assert(result.undoToken);assert.equal((await h.send({action:'undo',token:result.undoToken})).ok,true);
 assert.equal(h.store[key].song.candidates.a.replacements[0],'before');assert.equal(h.store[key].other.candidates.a.replacements[0],'keep');
 assert.equal((await h.send({action:'undo',token:result.undoToken})).ok,false);
});
test('undo: rejects later saves and retains token after storage failure',async()=>{
 const h=harness(),key='ytmlsTrackTimingOffsetsV174';
 const first=await h.send({action:'entry',key,videoId:'song',entry:{offsetMs:100},captureUndo:true});
 h.failNext();assert.equal((await h.send({action:'undo',token:first.undoToken})).ok,false);
 assert.equal((await h.send({action:'undo',token:first.undoToken})).ok,true);assert.equal(h.store[key].song,undefined);
 const second=await h.send({action:'nudgeTiming',videoId:'song',deltaMs:100,captureUndo:true});
 await h.send({action:'nudgeTiming',videoId:'song',deltaMs:100});
 assert.equal((await h.send({action:'undo',token:second.undoToken})).ok,false);assert.equal(h.store[key].song.offsetMs,200);
});
test('undo: manual readings can be restored after reset',async()=>{
 const h=harness(),key='ytmlsManualReadingsV256',entry={entries:[{text:'今日',start:0,end:2,reading:'きょう',lineIndex:0}]};
 await h.send({action:'entry',key,videoId:'song',entry});
 const r=await h.send({action:'entry',key,videoId:'song',entry:null,captureUndo:true});
 assert.equal((await h.send({action:'undo',token:r.undoToken})).ok,true);assert.deepEqual(h.store[key].song,entry);
});

test('manual readings: invalid legacy entries do not block valid songs or repeat migration',async()=>{
 const h=harness();
 const valid={text:'漢字',reading:'かんじ',start:0,end:2};
 const invalid={...valid,end:99};
 h.store.ytmls_manual_readings_bad=[invalid,valid];
 h.store.ytmls_manual_readings_good=[valid];
 assert.equal((await h.send({action:'migrateReadings'})).ok,true);
 assert.deepEqual(h.store.ytmlsManualReadingsV256.bad.entries,[valid]);
 assert.deepEqual(h.store.ytmlsManualReadingsV256.good.entries,[valid]);
 assert.deepEqual(h.store.ytmls_manual_readings_bad,[invalid,valid]);
 assert.equal(h.store.ytmls_manual_readings_good,undefined);
 assert.equal(h.store.ytmlsReadingsMigratedV262,true);
 assert.equal((await h.send({action:'migrateReadings'})).ok,true);
});

test('practice data: validation, restore and track deletion include display preferences and translations',async()=>{
 const h=harness(),key='ytmlsTrackDisplayV280',entry={settings:{fontSize:48,readingJapanese:false,readingEnglish:true,showTranslation:true,showRomaji:false},translations:[{text:'原文',translation:'translation',occurrence:0}]};
 assert.equal((await h.send({action:'entry',key,videoId:'song',entry})).ok,true);
 assert.equal((await h.send({action:'entry',key,videoId:'bad',entry:{settings:{fontSize:Infinity}}})).ok,false);
 assert.equal((await h.send({action:'entry',key,videoId:'bad',entry:{translations:[{text:'a',translation:'b',occurrence:-1}]}})).ok,false);
 const backup=structuredClone({[key]:{song:entry}});await h.send({action:'deleteTracks',videoIds:['song']});assert(!h.store[key].song);
 assert.equal((await h.send({action:'restore',data:backup})).ok,true);assert.deepEqual(h.store[key].song,entry);
});

test('normal saves reject unrestorable pins, local lyrics, edits and timings without altering storage',async()=>{
 const h=harness(),before=structuredClone(h.store);
 for(const [key,entry]of [['ytmlsPinnedLyricsV200',{candidateId:'a',result:{lines:[{time:0,text:'a',words:[{time:-1,end:1,text:'a'}]}]}}],['ytmlsLocalLyricsV200',{rawLrc:'no timestamps'}],['ytmlsTrackTimingOffsetsV174',{offsetMs:Infinity}]]){
   assert.equal((await h.send({action:'entry',key,videoId:'bad',entry})).ok,false);assert.deepEqual(h.store,before);
 }
 assert.equal((await h.send({action:'edit',videoId:'bad',candidateId:'a',entry:{originalLineCount:1,replacements:{3:'bad'}}})).ok,false);assert.deepEqual(h.store,before);
 const good={originalLineCount:1,replacements:{0:'good'}};assert.equal((await h.send({action:'edit',videoId:'good',candidateId:'a',entry:good})).ok,true);
 const backup=structuredClone(h.store);assert.equal((await h.send({action:'restore',data:backup})).ok,true);
});

test('partial restore merges accepted songs and leaves skipped existing songs intact',async()=>{
 const h=harness(),key='ytmlsLocalLyricsV200';h.store[key]={bad:{rawLrc:'[00:00]old'},keep:{rawLrc:'[00:00]keep'}};
 const r=await h.send({action:'restore',merge:true,data:{[key]:{good:{rawLrc:'[00:00]good'}}}});assert.equal(r.ok,true);
 assert.equal(h.store[key].bad.rawLrc,'[00:00]old');assert.equal(h.store[key].keep.rawLrc,'[00:00]keep');assert.equal(h.store[key].good.rawLrc,'[00:00]good');
});

test('startup removes only the legacy cache, leaving current cache and user songs intact',async()=>{
 const h=harness();h.store.ytmlsLyricsCacheV198={old:{lines:[{text:'old'}]}};h.store.ytmlsLyricsCacheV232={current:{lines:[{text:'current'}]}};h.store.ytmlsLocalLyricsV200={song:{rawLrc:'[00:00]keep'}};
 await h.send({action:'entry',key:'ytmlsTrackTimingOffsetsV174',videoId:'song',entry:{offsetMs:100}});
 assert.equal(h.store.ytmlsLyricsCacheV198,undefined);assert(h.store.ytmlsLyricsCacheV232.current);assert.equal(h.store.ytmlsLocalLyricsV200.song.rawLrc,'[00:00]keep');
 await h.send({action:'entry',key:'ytmlsTrackTimingOffsetsV174',videoId:'song',entry:{offsetMs:200}});assert.equal(h.removals.filter(keys=>keys.includes('ytmlsLyricsCacheV198')).length,1);
 const fresh=harness();await fresh.send({action:'entry',key:'ytmlsTrackTimingOffsetsV174',videoId:'song',entry:{offsetMs:0}});assert.equal(fresh.removals.length,0);
});
test('normal-save validation uses save wording while restore keeps backup wording',async()=>{
 const h=harness();const result=await h.send({action:'edit',videoId:'song',candidateId:'x',entry:{originalLineCount:0,replacements:{1:'bad'}}});assert.equal(result.ok,false);assert.match(result.error,/保存する曲データ/);assert.doesNotMatch(result.error,/バックアップ/);
 const restored=await h.send({action:'restore',data:{ytmlsLocalLyricsV200:{bad:{rawLrc:4}}}});assert.match(restored.error,/バックアップ/);
});
