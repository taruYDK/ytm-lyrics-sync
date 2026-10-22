import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {kanaToRomaji} from '../src/core/practice.mjs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('romaji: digraphs, gemination, nasal boundary, long vowels and mixed text',()=>{
 for(const [input,expected] of [['キョウ','kyou'],['マッチ','matchi'],['しんよう','shin\'you'],['スーパー','suupaa'],['ﾌｧｲﾙ','fairu'],['歌 ABC','歌 ABC'],['ニッポン','nippon']])assert.equal(kanaToRomaji(input),expected);
});
function harness(){
 const lines=[{text:'同じ',time:10},{text:'同じ',time:20}];const seeks=[];let id='one',time=0,now=2000;
 const c=vm.createContext({STATE:{enabled:true,displayedVideoId:'one',lines,fontSize:32,readingJapanese:true,readingEnglish:true},getAuthoritativeVideoId:()=>id,applySettings:()=>{},refreshLyricsReadings:()=>{},getVideoElement:()=>({}),getAuthoritativePlaybackTime:()=>time,getFreshPlayerSnapshot:()=>({playerState:1}),getAuthoritativeDuration:()=>100,playbackTimeForLyricsTime:t=>t-.5,requestPlayerSeek:(...args)=>seeks.push(args),performance:{now:()=>now}});
 vm.runInContext(read('src/content/practice.js'),c);
 return {c,lines,seeks,run:s=>vm.runInContext(s,c),track:value=>id=value,time:value=>time=value,clock:value=>now=value};
}
test('per-track display: saved override and common settings on next song',()=>{
 const h=harness();h.run("practiceLocalReady=practiceSyncReady=true;practiceData={one:{settings:{fontSize:48,readingJapanese:false,readingEnglish:true}}};applyPracticePrefs()");
 assert.equal(h.c.STATE.fontSize,48);assert.equal(h.c.STATE.readingJapanese,false);
 h.track('two');h.run('applyPracticePrefs()');assert.equal(h.c.STATE.fontSize,32);assert.equal(h.c.STATE.readingJapanese,true);
});
test('translation filtering: translation rows are removed without changing the input',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/language-filter.js'),c);
 const original={syncLevel:'line',lines:[{time:10,text:'Hello my friend'},{time:10,text:'こんにちは友達'},{time:20,text:'How are you today'},{time:20,text:'今日は元気ですか'}]};c.original=structuredClone(original);
 const result=vm.runInContext("filterTranslationRows(original,'en')",c);
 assert.deepEqual(Array.from(result.lines,x=>x.text),['Hello my friend','How are you today']);
 assert.deepEqual(JSON.parse(JSON.stringify(c.original)),original);
});

test('auto-save queue: order survives a failed write and reset follows pending saves',async()=>{
 const h=harness();h.c.saved=[];
 const results=await Promise.allSettled([
  h.run("queuePracticeSettingsSave(async()=>{saved.push('first');throw Error('quota')})"),
  h.run("queuePracticeSettingsSave(async()=>{saved.push('last toggle')})"),
  h.run("queuePracticeSettingsSave(async()=>{saved.push('reset')})"),
 ]);
 assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'fulfilled');
 assert.deepEqual(Array.from(h.c.saved),['first','last toggle','reset']);
});


test('fullscreen keys: Space toggles once, Enter seeks; repeats and stale rows cannot act',()=>{
 const h=harness();let clicks=0,toggles=0,prevented=0,stopped=0;
 h.c.requestPlayerToggle=id=>{assert.equal(id,'one');toggles++;};
 h.c.row={click:()=>clicks++};
 const event=(key,extra={})=>({key,preventDefault:()=>prevented++,stopPropagation:()=>stopped++,...extra});
 h.c.event=event(' ');h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");
 assert.equal(toggles,1);assert.equal(clicks,0);assert.equal(prevented,1);assert.equal(stopped,1);
 h.c.event=event('Enter');h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");assert.equal(clicks,1);
 h.c.event=event(' ',{repeat:true});h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");assert.equal(toggles,1);
 h.c.event=event(' ',{ctrlKey:true});h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");assert.equal(prevented,3);
 h.track('two');h.c.event=event(' ');h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");assert.equal(toggles,1);
});

test('startup preferences: wait for both storage callbacks in either order, do not apply defaults on failure',()=>{
 for(const order of ['local-first','sync-first','failed-sync']){
  const h=harness();let localCallback,syncCallback,readings=0;
  h.c.document={addEventListener:()=>{}};h.c.setTimeout=()=>0;
  h.c.refreshLyricsReadings=()=>readings++;
  h.c.chrome={runtime:{},storage:{local:{get:(_,cb)=>localCallback=cb},sync:{get:(_,cb)=>syncCallback=cb},onChanged:{addListener:()=>{}}}};
  h.run('refreshPracticeExtras=async()=>{};initPracticeStorage()');
  h.c.STATE.fontSize=40;h.c.STATE.readingJapanese=false;
  const local=()=>localCallback({ytmlsTrackDisplayV280:{one:{settings:{fontSize:48,readingJapanese:false,readingEnglish:false}}}});
  const sync=()=>syncCallback({fontSize:40,readingJapanese:false,readingEnglish:false});
  if(order==='sync-first'){sync();assert.equal(h.c.STATE.fontSize,40);local();}
  else {local();assert.equal(h.c.STATE.fontSize,40);assert.equal(readings,0);if(order==='failed-sync')h.c.chrome.runtime.lastError={message:'storage unavailable'};sync();}
  assert.equal(h.c.STATE.fontSize,order==='failed-sync'?40:48);
  assert.equal(h.c.STATE.readingJapanese,false);
 }
});


test('fullscreen Space works on root and after rows disappear, suppresses repeats and native keyup click',()=>{
 const h=harness();let toggles=0,prevented=0,stopped=0;
 h.c.requestPlayerToggle=id=>{assert.equal(id,'one');toggles++;};h.run('practiceFullscreen={}');
 const fire=(extra={})=>{h.c.event={type:'keydown',key:' ',target:{closest:()=>null},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++,...extra};h.run('handlePracticeFullscreenSpace(event)');};
 fire();assert.equal(toggles,1);fire({repeat:true});assert.equal(toggles,1);
 fire({type:'keyup'});assert.equal(prevented,3);assert.equal(stopped,3);
 fire({target:{isContentEditable:true}});fire({target:{closest:()=>({})}});fire({ctrlKey:true});assert.equal(toggles,1);
 h.c.STATE.trackingEnabled=false;fire();assert.equal(toggles,2);
 h.run('practiceFullscreen=null');fire();assert.equal(toggles,2);
});


test('startup reads retry transient errors and allow manual recovery after bounded failures',async()=>{
 for(const area of ['local','sync']){
  const h=harness();let failures=1,calls=0;const timers=[];
  h.c.setTimeout=fn=>timers.push(fn);
  const get=(_,cb)=>{calls++;if(failures-->0){h.c.chrome.runtime.lastError={message:'unavailable'};cb();delete h.c.chrome.runtime.lastError;}else cb(area==='local'?{ytmlsTrackDisplayV280:{one:{settings:{fontSize:48,readingJapanese:false}}}}:{fontSize:40,readingJapanese:false});};
  h.c.chrome={runtime:{},storage:{[area]:{get}}};h.run('refreshPracticeExtras=async()=>{}');
  const first=h.run(`loadPracticeSettings('${area}')`);assert.equal(calls,1);assert(h.run(`practiceLoadErrors.${area}`));timers.shift()();assert.equal(await first,true);assert.equal(calls,2);assert.equal(h.run(`practiceLoadErrors.${area}`),undefined);
  failures=4;const failed=h.run(`loadPracticeSettings('${area}')`);while(timers.length)timers.shift()();assert.equal(await failed,false);assert(h.run(`practiceLoadErrors.${area}`).includes('再試行できます'));
  failures=0;assert.equal(await h.run(`loadPracticeSettings('${area}')`),true);assert.equal(h.run(`practiceLoadErrors.${area}`),undefined);
 }
});
