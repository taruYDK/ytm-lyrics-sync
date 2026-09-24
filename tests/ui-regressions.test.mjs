import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('CSS: variable substitution must not corrupt property names',()=>{
 for(const name of ['style.css','theme.css','settings-theme.css'])assert.doesNotMatch(read(name),/var\(--[^)]+\)-/);
 assert.match(read('style.css'),/white-space:\s*pre-wrap/);
});
function timing(){
 let id='song',writes=0;const c=vm.createContext({STATE:{trackTimingOffsets:{},hasSync:false},getAuthoritativeVideoId:()=>id,
 getVideoElement:()=>null,trackTimingButtonEl:null,trackTimingPopoverEl:null,requestAnimationFrame(){}});
 vm.runInContext(read('src/content/timing-offset.js'),c);
 c.updateTrackTimingControl=()=>{};c.updateOffsetPreview=()=>{};c.saveTrackTimingOffsets=()=>writes++;
 return {c,writes:()=>writes,setId:value=>id=value};
}
test('offset slider: repeated input previews without saves, change commits once and rejects old track',()=>{
 const h=timing(),handlers={},range={value:'0',addEventListener:(name,fn)=>handlers[name]=fn};
 h.c.bindTrackTimingRange(range,{querySelector:()=>({})},{position:0},'song');
 for(let i=1;i<=40;i++){range.value=String(i*100);handlers.input();}
 assert.equal(h.writes(),0);assert.equal(h.c.getTrackTimingPoints('song')[0].offsetMs,4000);
 assert.equal(h.c.STATE.trackTimingOffsets.song,undefined);
 handlers.change();assert.equal(h.writes(),1);assert.equal(h.c.STATE.trackTimingOffsets.song.offsetMs,4000);
 handlers.blur();assert.equal(h.writes(),1);
 h.setId('next');range.value='5000';handlers.input();handlers.change();assert.equal(h.writes(),1);assert.equal(h.c.STATE.trackTimingOffsets.next,undefined);
});
test('offset renderer: focused range survives storage-driven refresh',()=>{
 const h=timing();let rebuilds=0;
 h.c.document={activeElement:{classList:{contains:()=>true}}};h.c.trackTimingPointsEl={contains:()=>true,replaceChildren(){rebuilds++;}};
 vm.runInContext('trackTimingRenderedVideoId = "song"',h.c);
 h.c.renderTrackTimingPoints();assert.equal(rebuilds,0);
});
test('tracking OFF: clears once then avoids repeated DOM work',()=>{
 const c=vm.createContext({STATE:{hasSync:true,lines:[{}],trackingEnabled:false,currentIndex:1,currentWordIndex:2},listEl:{},
 performance:{now:()=>1},getVideoElement:()=>({}),canTrackCurrentPlayback:()=>true,getGuardedPlaybackTime:()=>1});
 vm.runInContext(read('src/content/tracking.js'),c);let clears=0;
 c.clearTrackingVisuals=()=>{clears++;c.STATE.currentIndex=-1;c.STATE.currentWordIndex=-1;};
 for(let i=0;i<120;i++)c.updateHighlight(1);assert.equal(clears,1);
});
test('author shortcuts: protect only panel controls, leaving outside playback controls eligible',()=>{
 const record={},save={},back={},undo={},seekStart={},link={},roleButton={},play={},outsideLink={},outsideRole={};
 const inside=new Set([record,save,back,undo,seekStart,link,roleButton]);
 const c=vm.createContext({lyricsToolsPaneEl:{contains:control=>inside.has(control)}});
 vm.runInContext(read('src/content/lyrics-panel.js'),c);
 for(const control of [save,back,undo,seekStart,link,roleButton]) {
   assert.equal(c.authorShortcutTargetsControl({closest:()=>control},record),true);
 }
 for(const control of [record,play,outsideLink,outsideRole,null]) {
   assert.equal(c.authorShortcutTargetsControl({closest:()=>control},record),false);
 }
 c.lyricsToolsPaneEl=null;
 assert.equal(c.authorShortcutTargetsControl({closest:()=>play},record),false);
});
test('lyrics: timed rows support Enter and Space without repeat or modifier activation',()=>{
 const nodes=[];function element(){return {dataset:{},handlers:{},classList:{add(){}},setAttribute(key,value){this[key]=value;},addEventListener(key,fn){this.handlers[key]=fn;},click(){this.activations=(this.activations||0)+1;}};}
 const c=vm.createContext({STATE:{lines:[{time:1,text:'line',words:[]}],lastDisplayedTrackKey:'key',displayedVideoId:'song'},
 refreshLyricsReadings(){},listEl:{appendChild:node=>nodes.push(node)},document:{createElement:element},getVideoElement:()=>null});
 vm.runInContext(read('src/content/timing-offset.js'),c);c.renderLines();
 const line=nodes[0];assert.equal(line.tabIndex,0);assert.equal(line.role,'button');
 for(const key of ['Enter',' '])line.handlers.keydown({key,preventDefault(){},stopPropagation(){}});
 line.handlers.keydown({key:' ',repeat:true,preventDefault(){},stopPropagation(){}});
 line.handlers.keydown({key:'Enter',ctrlKey:true});assert.equal(line.activations,2);
});
