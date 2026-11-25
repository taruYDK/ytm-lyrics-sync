import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+(name.startsWith('src/')?'':'extension/')+name,import.meta.url),'utf8');
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
 const h=timing(),handlers={},fills={},range={value:'0',style:{setProperty:(k,v)=>fills[k]=v},addEventListener:(name,fn)=>handlers[name]=fn};
 h.c.bindTrackTimingRange(range,{querySelector:()=>({})},{position:0},'song');
 for(let i=1;i<=40;i++){range.value=String(i*100);handlers.input();}
 assert.equal(fills['--from'],'50%');assert.equal(fills['--to'],'60%');
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
test('lyrics: Enter seeks, Space toggles playback without repeats or modifiers',()=>{
 let toggles=0;
 const nodes=[];function element(){return {dataset:{},handlers:{},classList:{add(){}},setAttribute(key,value){this[key]=value;},addEventListener(key,fn){this.handlers[key]=fn;},click(){this.activations=(this.activations||0)+1;}};}
 const c=vm.createContext({STATE:{lines:[{time:1,text:'line',words:[]}],lastDisplayedTrackKey:'key',displayedVideoId:'song'},
 getVideoId:()=> 'song',
 refreshLyricsReadings(){},listEl:{appendChild:node=>nodes.push(node)},document:{createElement:element,documentElement:{classList:{contains:()=>false}}},getVideoElement:()=>null});
 c.window={addEventListener(){}};
 vm.runInContext(read('src/content/player-bridge.js'),c);
 c.requestPlayerToggle=id=>{assert.equal(id,'song');toggles++;};
 vm.runInContext(read('src/content/timing-offset.js'),c);c.renderLines();
 const line=nodes[0];assert.equal(line.tabIndex,0);assert.equal(line.role,'button');
 for(const key of ['Enter',' '])line.handlers.keydown({key,preventDefault(){},stopPropagation(){}});
 line.handlers.keydown({key:' ',repeat:true,preventDefault(){},stopPropagation(){}});
 line.handlers.keydown({key:'Enter',ctrlKey:true});
 line.handlers.keydown({key:' ',ctrlKey:true});
 line.handlers.keydown({key:'Enter',preventDefault(){},stopPropagation(){}});
 assert.equal(line.activations,2);assert.equal(toggles,1);
});

test('timing popover anchors to the visible menu summary when the compact button becomes hidden',()=>{
 const bounds={left:700,top:320,bottom:350,width:90,height:30};
 const summary={isConnected:true,getBoundingClientRect:()=>bounds,focus(){this.focused=true;}};
 const compactButton={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,bottom:0,width:0,height:0}),setAttribute(){}};
 const popover={hidden:true,offsetHeight:200,offsetWidth:320,style:{},querySelector:()=>null};
 const c=vm.createContext({document:{querySelector:()=>summary},window:{innerWidth:900,innerHeight:620},
  trackTimingPopoverEl:popover,trackTimingButtonEl:compactButton,trackTimingPreview:null,requestAnimationFrame:fn=>fn()});
 vm.runInContext(read('src/content/timing-offset.js'),c);
 c.ensureTrackTimingPopover=()=>{};c.updateTrackTimingControl=()=>{};c.getTrackOffsetVideoId=()=> 'song';
 c.toggleTrackTimingPopover(summary);
 assert.equal(popover.hidden,false);assert.deepEqual(popover.style,{left:'568px',top:'108px'});
 c.dismissTrackTimingPopover();
 assert.equal(popover.hidden,true);assert.equal(summary.focused,true);
});

test('a11y: only the status line is a live region, not the whole lyrics panel',()=>{
 const source=read('src/content/lyrics-panel.js');
 assert.doesNotMatch(source,/panelEl\.setAttribute\("aria-live"/);
 assert.match(source,/statusEl\.setAttribute\("aria-live", "polite"\)/);
});

test('an empty lyrics result still cancels the previous song reading refresh',()=>{
 let refreshes=0;const children=[];
 const el=()=>({className:'',id:'',textContent:'',children:[],appendChild(child){this.children.push(child);},setAttribute(){}});
 const listEl={innerHTML:'',classList:{remove(){},add(){}},appendChild:c=>children.push(c),querySelector:()=>null,getBoundingClientRect:()=>({width:0,height:0}),style:{removeProperty(){}}};
 const c=vm.createContext({STATE:{lines:[],isSearching:false,hasSync:false,statusText:'見つかりませんでした'},listEl,document:{createElement:el,documentElement:{classList:{contains:()=>false}}},matchMedia:()=>({matches:false}),
  resetLyricsScrollPosition(){},refreshLyricsReadings:()=>{refreshes++;}});
 vm.runInContext(read('src/content/timing-offset.js'),c);
 c.renderLines();
 assert.equal(children.length,1);assert.equal(refreshes,1);
});

test('CSS: one place controls the current-line filter and the blur of other lines',()=>{
 const motion=read('lyrics-motion.css'),style=read('style.css');
 assert.doesNotMatch(motion,/ytmls-active\s*\{[^}]*filter:\s*none/);
 assert.match(style,/:not\(\[data-browsing="true"\]\) \.ytmls-line:not\(\.ytmls-active\) \{ filter: blur\(/);
 assert.match(style,/#ytmls-fullscreen\[data-focus-fade="on"\]\[data-tracking-mode="auto"\]:not\(\[data-browsing="true"\]\) \.ytmls-full-line:not\(\.active\) \{ filter: blur\(/);
});

test('CSS: the current word glow outranks the per-word filter reset',()=>{
 const style=read('style.css');
 assert.match(style,/\.ytmls-line\.ytmls-active \.ytmls-word \{ text-shadow: none !important; filter: none !important; \}|ytmls-full-line\.active \.ytmls-word \{ text-shadow: none !important; filter: none !important; \}/);
 assert.match(style,/\.ytmls-word\.ytmls-word-current \{\s*filter: drop-shadow\([^}]*!important;/);
});

test('word glow applies only while its setting is on (panel and fullscreen)',()=>{
 const style=read('style.css'),panel=read('src/content/lyrics-panel.js'),practice=read('src/content/practice.js');
 assert.match(style,/#ytmls-panel\[data-tracking-mode="auto"\]\[data-word-glow="on"\][^{]*ytmls-word-current/);
 assert.match(style,/#ytmls-fullscreen\[data-tracking-mode="auto"\]\[data-word-glow="on"\][^{]*ytmls-word-current/);
 assert.match(panel,/panelEl\.dataset\.wordGlow = STATE\.wordGlow === false \? "off" : "on"/);
 assert.match(practice,/box\.dataset\.wordGlow=STATE\.wordGlow===false\?'off':'on'/);
});
