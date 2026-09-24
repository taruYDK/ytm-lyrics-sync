import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = name => fs.readFileSync(new URL('../src/content/' + name, import.meta.url),'utf8');
function tracking() {
  let now=100, resize; const frames=[], scrolls=[];
  const line={getBoundingClientRect:()=>({top:400,height:40})};
  const list={clientHeight:500, scrollTop:100, children:[line], style:{setProperty(){}},
    getBoundingClientRect:()=>({top:0}),scrollTo:arg=>scrolls.push(arg),addEventListener(){}};
  const c=vm.createContext({STATE:{enabled:true,hasSync:true,trackingEnabled:true,trackingPosition:42,manualScrollReturnMs:5000,currentIndex:0},
    listEl:list,manualScrollUntil:0,pendingReturnToCurrent:false,autoScrollUntil:0,scrollInteractionBound:false,
    performance:{now:()=>now},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    ResizeObserver:class {constructor(fn){resize=fn;}observe(){}}, window:{addEventListener(){}},
    canTrackCurrentPlayback:()=>true,getVideoElement:()=>({})});
  vm.runInContext(source('tracking.js'),c);
  return {c,line,list,frames,scrolls,setNow:n=>now=n,resize:()=>resize()};
}
test('tracking: configurable focus and original start position',()=>{
  const {c,line,scrolls}=tracking();
  c.scrollCurrentLineIntoView(line); assert.equal(scrolls.at(-1).top,310);
  c.STATE.trackingPosition=50; c.scrollCurrentLineIntoView(line); assert.equal(scrolls.at(-1).top,270);
  line.getBoundingClientRect=()=>({top:-76,height:40});
  c.scrollCurrentLineIntoView(line); assert.equal(scrolls.at(-1).top,0);
});
test('resize: events coalesce and respect manual reading and tracking disabled',()=>{
  const h=tracking();h.c.bindScrollInteraction();h.c.pauseAutoScrollFromUser();
  assert.equal(h.c.manualScrollUntil,5100);
  h.resize();h.resize();assert.equal(h.frames.length,1);h.frames.shift()();
  assert.equal(h.scrolls.length,0);assert.equal(h.c.pendingReturnToCurrent,true);
  h.setNow(5200);h.list.clientHeight=600;h.resize();h.frames.shift()();
  assert.equal(h.scrolls.at(-1).top,268);
  h.c.STATE.trackingEnabled=false;h.resize();h.frames.shift()();assert.equal(h.scrolls.length,1);
});
test('quick timing: dispatch captures track identity, rejects mismatch and reports errors',async()=>{
  const sent=[],errors=[];
  const c=vm.createContext({STATE:{enabled:true,trackTimingOffsetsLoaded:true,hasSync:true,displayedVideoId:'a'},getAuthoritativeVideoId:()=> 'a',
    sendUserDataMutation:async p=>{sent.push(p);},reportSaveError:e=>errors.push(e)});
  vm.runInContext(source('timing-offset.js'),c);
  await c.nudgeCurrentTrackTiming(100);assert.equal(sent[0].videoId,'a');assert.equal(sent[0].deltaMs,100);assert.equal(sent[0].action,'nudgeTiming');
  c.STATE.displayedVideoId='b';await c.nudgeCurrentTrackTiming(-100);assert.equal(sent.length,1);
  c.STATE.displayedVideoId='a';c.sendUserDataMutation=async()=>{throw Error('quota');};await c.nudgeCurrentTrackTiming(100);assert.equal(errors[0].message,'quota');
});
test('tracking settings: bounds and invalid backup values use defaults',()=>{
  const c=vm.createContext({});vm.runInContext(source('settings.js'),c);
  for(const invalid of [undefined,null,'42',NaN,Infinity,{}]) assert.equal(c.boundedTrackingSetting(invalid,42,25,65),42);
  assert.equal(c.boundedTrackingSetting(0,42,25,65),25);
  assert.equal(c.boundedTrackingSetting(90,42,25,65),65);
  assert.equal(c.boundedTrackingSetting(5000,3500,1000,10000),5000);
});

test('settings: saved values load and sync updates apply without local-key interference',()=>{
 let loaded,changed,aligned=0,highlighted=0;
 const c=vm.createContext({STATE:{hasSync:true,enabled:true},DEFAULT_PROVIDER_ORDER:[],normalizedProviderEnabled:()=>({}),normalizedProviderOrder:()=>[],
 chrome:{storage:{sync:{get:(defaults,cb)=>loaded=()=>cb({...defaults,uiVersion:9,trackingPosition:35,manualScrollReturnMs:5000}),remove(){}},onChanged:{addListener:cb=>changed=cb}}},
 applySettings(){},tick(){},scheduleTrackingRealignment(){aligned++;},isManualScrollPaused:()=>false,
 TRACK_TIMING_OFFSETS_STORAGE_KEY:'timing',LYRICS_EDITS_STORAGE_KEY:'edits',MANUAL_SEARCH_STORAGE_KEY:'manual',PINNED_LYRICS_STORAGE_KEY:'pinned',LOCAL_LYRICS_STORAGE_KEY:'local',
 updateTrackTimingControl(){},getVideoElement:()=>({}),canTrackCurrentPlayback:()=>true,getAuthoritativePlaybackTime:()=>20,updateHighlight:()=>highlighted++});
 vm.runInContext(source('settings.js'),c);c.loadSettings();loaded();
 assert.equal(c.STATE.trackingPosition,35);assert.equal(c.STATE.manualScrollReturnMs,5000);
 changed({trackingPosition:{newValue:60}},'sync');assert.equal(c.STATE.trackingPosition,60);assert.equal(aligned,1);
 changed({trackingPosition:{newValue:25}},'local');assert.equal(c.STATE.trackingPosition,60);
 changed({manualScrollReturnMs:{}},'sync');assert.equal(c.STATE.manualScrollReturnMs,3500);
 changed({timing:{newValue:{song:{offsetMs:100}}}},'local');assert.equal(c.STATE.trackTimingOffsets.song.offsetMs,100);assert.equal(highlighted,1);
});

test('quick timing UI: only the direction at its limit is disabled and explained',()=>{
 const buttons=[{dataset:{nudge:'100'}},{dataset:{nudge:'-100'}}];
 const c=vm.createContext({STATE:{enabled:true,hasSync:true,trackTimingOffsetsLoaded:true,displayedVideoId:'a'},
 trackTimingButtonEl:{setAttribute(){}},trackTimingPopoverEl:{hidden:true,querySelectorAll:()=>buttons},trackTimingButtonLabelEl:null,trackTimingTitleEl:null,trackTimingAddPointEl:null,trackTimingTotalEl:null,
 lyricsHealthState:()=>({label:'ok'})});
 vm.runInContext(source('timing-offset.js'),c);
 c.updateOffsetPreview=()=>{};c.getTrackOffsetVideoId=()=> 'a';c.effectiveTimingOffsetMs=()=>0;
 c.getTrackTimingPoints=()=>[{position:0,offsetMs:20000}];c.updateTrackTimingControl(false);
 assert.equal(buttons[0].disabled,true);assert.match(buttons[0].textContent,/上限/);assert.equal(buttons[1].disabled,false);
 c.getTrackTimingPoints=()=>[{position:0,offsetMs:-20000}];c.updateTrackTimingControl(false);
 assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,true);
});
