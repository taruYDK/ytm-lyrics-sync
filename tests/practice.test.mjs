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
 c.window={addEventListener(){}};
 c.getVideoId=()=>id;
 c.document={documentElement:{classList:{contains:()=>false}}};
 vm.runInContext(read('src/content/player-bridge.js'),c);
 vm.runInContext(read('src/content/practice.js'),c);
 return {c,lines,seeks,run:s=>vm.runInContext(s,c),track:value=>id=value,time:value=>time=value,clock:value=>now=value};
}
test('per-track display: saved override and common settings on next song',()=>{
 const h=harness();h.run("practiceLocalReady=practiceSyncReady=true;practiceData={one:{settings:{fontSize:48,readingJapanese:false,readingEnglish:true}}};applyPracticePrefs()");
 assert.equal(h.c.STATE.fontSize,48);assert.equal(h.c.STATE.readingJapanese,false);
 h.track('two');h.run('applyPracticePrefs()');assert.equal(h.c.STATE.fontSize,32);assert.equal(h.c.STATE.readingJapanese,true);
});

test('global reading OFF overrides saved per-track ON without deleting the preference',()=>{
 const h=harness();
 h.run("practiceLocalReady=practiceSyncReady=true;practiceData={one:{settings:{fontSize:48,readingJapanese:true,readingEnglish:true}}};practiceGlobal={fontSize:32,readingJapanese:false,readingEnglish:true};applyPracticePrefs()");
 assert.equal(h.c.STATE.readingJapanese,false);assert.equal(h.c.STATE.readingEnglish,true);assert.equal(h.c.STATE.fontSize,48);
 assert.equal(h.run('practiceData.one.settings.readingJapanese'),true);
 h.run('practiceGlobal.readingEnglish=false;applyPracticePrefs()');assert.equal(h.c.STATE.readingEnglish,false);
 h.run('practiceGlobal.readingJapanese=true;applyPracticePrefs()');assert.equal(h.c.STATE.readingJapanese,true);assert.equal(h.c.STATE.readingEnglish,false);
 h.run('practiceData.one.settings.readingJapanese=false;applyPracticePrefs()');assert.equal(h.c.STATE.readingJapanese,false);
 h.track('two');h.run('applyPracticePrefs()');assert.equal(h.c.STATE.readingJapanese,true);assert.equal(h.c.STATE.readingEnglish,false);
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
 h.c.row={click:()=>{throw Error('Space should not activate the custom row handler');}};
 h.c.event={key:' ',preventDefault(){},stopPropagation(){}};
 h.run("handlePracticeLineKey(event,'one',STATE.lines,row)");assert.equal(toggles,3);
 h.run('practiceFullscreen=null');fire();assert.equal(toggles,3);
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

test('editing only font size preserves the masked per-track reading preference',async()=>{
 const h=harness(),fields=[];
 h.run("practiceLocalReady=practiceSyncReady=true;practiceGlobal.readingJapanese=false;practiceData={one:{settings:{readingJapanese:true}}}");
 h.c.practicePane=()=>({body:{isConnected:true},status:{},id:'one',lines:h.lines});
 h.c.practiceButton=()=>{};
 h.c.practiceField=(body,label,type,value)=>{
  const field={value,checked:value,addEventListener:(event,fn)=>{field.change=fn;}};
  fields.push(field);return field;
 };
 h.c.sendUserDataMutation=async({entry})=>({ytmlsTrackDisplayV280:{one:entry}});
 h.c.refreshPracticeExtras=async()=>{};
 h.run('showTrackDisplay()');
 assert.equal(fields[1].checked,true);
 fields[0].value='40';fields[0].change();
 await h.run('practiceSettingsSaveQueue');
 assert.equal(h.c.STATE.fontSize,40);
 assert.equal(h.c.STATE.readingJapanese,false);
 h.run('practiceGlobal.readingJapanese=true;applyPracticePrefs()');
 assert.equal(h.c.STATE.readingJapanese,true);
 assert.equal(h.run('practiceData.one.settings.readingEnglish'),undefined);
});

test('Japanese songs keep their own English lines and drop only same-time translations',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/language-filter.js'),c);
 const lines=[['静かな街に朝が来る',1],['Shizuka na machi ni asa ga kuru',1],['Hello my morning sky',5],['窓辺の光を数えてる',9],['I love you',13],['Mado no hikari',9.02]]
  .map(([text,time])=>({time,end:null,text,words:[]}));
 c.input={syncLevel:'line',lines};
 const result=vm.runInContext("sanitizeCandidateForTrackLanguage(input,'ja')",c);
 assert.deepEqual(Array.from(result.lines,x=>x.text),['静かな街に朝が来る','Hello my morning sky','窓辺の光を数えてる','I love you']);
});

test('Japanese songs also drop translations of kanji-only lines and slightly shifted ones',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/language-filter.js'),c);
 const lines=[['運命',10],['unmei',10],['Destiny',10],['静かな夜',20],['Shizuka na yoru',20.2],['Hello my morning sky',25]]
  .map(([text,time])=>({time,end:null,text,words:[]}));
 c.input={syncLevel:'line',lines};
 const result=vm.runInContext("sanitizeCandidateForTrackLanguage(input,'ja')",c);
 assert.deepEqual(Array.from(result.lines,x=>x.text),['運命','静かな夜','Hello my morning sky']);
});

test('fullscreen header follows the cover on every refresh and a picked alignment wins over the stored one',()=>{
 const text=read('src/content/practice.js');
 const refresh=text.slice(text.indexOf('function refreshPracticeFullscreen'),text.indexOf('function syncPracticeFullscreenTracking'));
 assert.match(refresh,/paintPracticeBackground\(box\);updatePracticeFullscreenHeader\(box\);/);
 assert.equal((refresh.match(/updatePracticeFullscreenHeader/g)||[]).length,1,'not only when the lyrics change');
 assert.match(text,/const chooseAlign = value => \{\n  box\.alignChosen = true;/);
 assert.match(text,/practiceFullscreen === box && !box\.alignChosen\) setAlign\(/);
});

test('a size chosen in the menu shows at once and is not undone before its save finishes', () => {
  const source = read('src/content/enhancements.js');
  assert.match(source, /practicePendingSettings\[id\]=\{\.\.\.\(practicePendingSettings\[id\]\|\|\{\}\),fontSize:size\};\s*applyPracticePrefs\(\);/);
  assert.doesNotMatch(source, /button\.disabled=true/, 'the button stays usable while saving');
  assert.match(source, /if\(practicePendingSettings\[id\]\?\.fontSize===size\)\{delete practicePendingSettings\[id\];applyPracticePrefs\(\);\}/);
  assert.match(source, /reportSaveError\(e\)/, 'a failed save says why, and the chosen size stays on screen');
  const h = harness();
  h.run("practiceLocalReady=true;practiceSyncReady=true;practiceData.one={settings:{fontSize:26}};practicePendingSettings.one={fontSize:40};applyPracticePrefs()");
  assert.equal(h.c.STATE.fontSize, 40, 'the pending choice wins over the saved one');
  h.run("delete practicePendingSettings.one;applyPracticePrefs()");
  assert.equal(h.c.STATE.fontSize, 26);
});

test('saving a track display entry keeps only the fields in use, so an old entry cannot block the save', async () => {
  const sent = [];
  const h = harness();
  h.c.sendUserDataMutation = async message => { sent.push(message); return {}; };
  h.run("practiceLocalReady=true;practiceSyncReady=true");
  await h.c.savePracticeEntry('other', {title: 't', settings: {fontSize: 40, readingJapanese: false, fontScale: 1.2, showRomaji: 'yes'}, translations: 'old', legacy: 1});
  const entry = sent[0].entry;
  assert.deepEqual(Object.keys(entry).sort(), ['artist', 'settings', 'title', 'updatedAt']);
  assert.deepEqual({...entry.settings}, {fontSize: 40, readingJapanese: false});
  const validation = read('extension/backup-validation.js');
  const v = {};
  vm.runInNewContext(validation, v);
  assert.doesNotThrow(() => v.YTMLSBackupValidation.local({ytmlsTrackDisplayV280: {other: JSON.parse(JSON.stringify(entry))}}), 'passes the storage check');
});
