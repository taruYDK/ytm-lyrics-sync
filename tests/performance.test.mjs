import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+(p.startsWith('src/')?'':'extension/')+p,import.meta.url),'utf8');

test('cache writes coalesce and serialize the latest cache only once',()=>{
 const timers=new Map();let id=0,writes=[];
 const c=vm.createContext({STATE:{lyricsCache:new Map()},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),chrome:{storage:{local:{set:data=>writes.push(data)}}}});
 vm.runInContext(read('src/content/lyrics-storage.js'),c);
 for(let i=0;i<4;i++){c.STATE.lyricsCache.set('song',{lines:[{text:String(i)}]});c.saveLyricsCacheToStorage();}
 assert.equal(timers.size,1);assert.equal(writes.length,0);[...timers.values()][0]();
 assert.equal(writes.length,1);assert.equal(writes[0].ytmlsLyricsCacheV232.song.lines[0].text,'3');
});

test('bridge throttles metadata, stops while disabled and resumes',()=>{
 let now=0,reads=0,posts=0,listener;const timers=new Map();let id=0;
 const player={getVideoData(){reads++;return {video_id:'a'};},getCurrentTime:()=>now/1000,getDuration:()=>100,getPlayerState:()=>1,getPlaybackRate:()=>1,querySelector:()=>null};
 const window={postMessage(){posts++;},addEventListener:(type,fn)=>{if(type==='message')listener=fn;}};
 const c=vm.createContext({window,document:{getElementById:()=>player,addEventListener(){}},performance:{now:()=>now},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(read('player-bridge.js'),c);
 for(let i=0;i<10;i++){now+=34;const [key,fn]=timers.entries().next().value;timers.delete(key);fn();}
 assert.equal(posts,11);assert.equal(reads,2);
 listener({source:window,data:{source:'ytmls-player-bridge-v1',type:'tracking-config',enabled:false}});assert.equal(timers.size,0);
 listener({source:window,data:{source:'ytmls-player-bridge-v1',type:'tracking-config',enabled:true}});assert.equal(timers.size,1);assert.equal(reads,3);
});

test('offscreen setup is shared and rejects invalid requests',async()=>{
 let handler,created=0;const c=vm.createContext({clients:{matchAll:async()=>[]},chrome:{runtime:{id:'self',getURL:p=>'extension://'+p,onMessage:{addListener:fn=>handler=fn},sendMessage:async()=>({ok:true,tokens:[]})},offscreen:{createDocument:async()=>{created++;}}}});
 vm.runInContext(read('readings-service.js'),c);
 const request=()=>new Promise(resolve=>handler({type:'YTMLS_JAPANESE_TOKENS',text:'今日'},{id:'self'},resolve));
 const responses=await Promise.all([request(),request()]);assert.equal(created,1);assert(responses.every(r=>r.ok));
 let rejected;handler({type:'YTMLS_JAPANESE_TOKENS',text:'x'.repeat(4001)},{id:'self'},r=>rejected=r);assert.equal(rejected.ok,false);
});

test('shared dictionary worker terminates after idle and is recreated on demand',()=>{
 let listener,worker,created=0,terminated=0;const timers=new Map();let id=0;
 const c=vm.createContext({Worker:class{constructor(){worker=this;created++;}postMessage(m){this.message=m;}terminate(){terminated++;}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),chrome:{runtime:{id:'self',onMessage:{addListener:fn=>listener=fn}}}});
 vm.runInContext(read('readings-offscreen.js'),c);
 const request=()=>listener({type:'YTMLS_READING_WORKER',text:'今日'},{id:'self'},()=>{});
 request();request();assert.equal(created,1);
 worker.onmessage({data:{id:1,ok:true,tokens:[]}});worker.onmessage({data:{id:2,ok:true,tokens:[]}});
 const idle=[...timers.values()].find(t=>t.ms===300000);assert(idle);idle.fn();assert.equal(terminated,1);request();assert.equal(created,2);
});

test('real dictionary initializes and tokenizes inside worker global without page globals',async()=>{
 const {fileURLToPath}=await import('node:url');
 let complete;const result=new Promise(resolve=>complete=resolve);
 class XHR {
  open(method,url){this.url=url;}
  send(){fs.readFile(fileURLToPath(new URL('../extension/'+this.url.split('/extension/')[1],import.meta.url)),(error,data)=>{if(error){this.onerror(error);return;}this.status=200;this.response=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);this.onload();});}
 }
 const c=vm.createContext({URL,XMLHttpRequest:XHR,setTimeout,clearTimeout,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,ArrayBuffer,DataView,console,location:{href:'https://local/extension/readings-worker.js'},postMessage:complete});
 c.self=c;c.importScripts=path=>vm.runInContext(read(path),c);
 vm.runInContext(read('readings-worker.js'),c);c.onmessage({data:{id:1,text:'今日、私は君へ愛を'}});
 const r=await result;assert.equal(r.ok,true);assert.equal(r.tokens[0].reading,'キョウ');
 assert.deepEqual(Object.keys(r.tokens[0]).sort(),['pronunciation','reading','surface_form']);
 assert.equal(r.tokens.find(t=>t.surface_form==='は').pronunciation,'ワ');
 assert.equal(r.tokens.find(t=>t.surface_form==='へ').pronunciation,'エ');
});

test('bridge toggles current playback and rejects stale or disabled commands',()=>{
 let listener,state=1,plays=0,pauses=0;
 const player={getVideoData:()=>({video_id:'song'}),getCurrentTime:()=>0,getDuration:()=>100,getPlayerState:()=>state,getPlaybackRate:()=>1,querySelector:()=>null,playVideo(){plays++;state=1;},pauseVideo(){pauses++;state=2;}};
 const window={postMessage(){},addEventListener:(type,fn)=>{if(type==='message')listener=fn;}};
 vm.runInNewContext(read('player-bridge.js'),{window,document:{getElementById:()=>player,addEventListener(){}},performance:{now:()=>0},setTimeout:()=>1,clearTimeout(){}});
 const send=(videoId='song')=>listener({source:window,data:{source:'ytmls-player-bridge-v1',type:'toggle-playback',payload:{videoId}}});
 send();assert.equal(pauses,1);send();assert.equal(plays,1);
 state=3;send();assert.equal(pauses,2);send('old');assert.equal(plays,1);
 listener({source:window,data:{source:'ytmls-player-bridge-v1',type:'tracking-config',enabled:false}});
 send();assert.equal(plays,1);
});

test('hidden main tick performs no DOM or playback work and resumes when visible',()=>{
 let reads=0;
 const c=vm.createContext({document:{hidden:true,readyState:'loading'},window:{addEventListener(){}},runtimeAvailable:()=>true,STATE:{enabled:false},updateLyricsTheme:()=>reads++,ensureLyricsMount(){},ensureVideoListener(){},ensurePlayerBarTimingControl(){},maintainLyricsAutoOpen(){},applySettings(){},updatePlayerBarHealth(){},updateDiagnosticsSummary(){}});
 vm.runInContext(read('src/content/main.js'),c);
 for(let i=0;i<100;i++) c.tick();
 assert.equal(reads,0);
 c.document.hidden=false;c.tick();assert.equal(reads,1);
});

test('empty state measurements ignore unrelated page and lyric-row updates',()=>{
 let frames=[];const observers=[];const panel={};
 const doc={documentElement:{},querySelector:s=>s==='#ytmls-panel'?panel:null};
 const c=vm.createContext({document:doc,window:{addEventListener(){}},requestAnimationFrame:fn=>frames.push(fn),ResizeObserver:class{observe(){} disconnect(){}},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(target,opts){this.opts=opts;}disconnect(){}}});
 vm.runInContext(read('empty-width.js'),c);
 assert.equal(frames.length,1);frames.shift()();
 assert.equal(observers[0].opts.characterData,true);
 assert.equal(observers[1].opts.characterData,undefined);
 const unrelated={nodeType:1,matches:()=>false,querySelector:()=>null,closest:()=>null};
 observers[1].fn([{type:'childList',addedNodes:[unrelated],removedNodes:[]}]);
 observers[0].fn([{type:'characterData',target:{nodeType:3,parentElement:unrelated},addedNodes:[],removedNodes:[]}]);
 assert.equal(frames.length,0);
 const status={...unrelated,closest:()=>true};
 observers[0].fn([{type:'characterData',target:{nodeType:3,parentElement:status},addedNodes:[],removedNodes:[]}]);
 assert.equal(frames.length,1);frames.shift()();
 observers[1].fn([{type:'attributes',attributeName:'player-page-open',target:unrelated,addedNodes:[],removedNodes:[]}]);
 assert.equal(frames.length,1);
});

test('combined display settings preserve defaults and newer changes',()=>{
 let listener,finish;const classes=new Map();
 const c=vm.createContext({document:{documentElement:{classList:{toggle:(name,value)=>classes.set(name,value)}}},chrome:{runtime:{},storage:{local:{get:(defaults,cb)=>{finish=()=>cb(defaults);}},onChanged:{addListener:fn=>listener=fn}}}});
 vm.runInContext(read('display-class-settings.js'),c);
 listener({ytmlsPlayerBarCustomEnabled:{newValue:false},musicGlassLightweight:{newValue:true}},'local');
 finish();
 assert.equal(classes.get('ytmls-custom-playerbar'),false);
 assert.equal(classes.get('ytmls-lyrics-motion-lightweight'),true);
 assert.equal(classes.get('ytmls-depth-animation-disabled'),false);
 listener({ytmlsDepthAnimationEnabled:{newValue:false}},'local');
 assert.equal(classes.get('ytmls-depth-animation-disabled'),true);
 listener({ytmlsDepthAnimationEnabled:{newValue:true}},'sync');
 assert.equal(classes.get('ytmls-depth-animation-disabled'),true);
});

test('tracking skips paused or hidden frames while seek and play force updates',()=>{
 const frames=[],events={};let updates=[],fullscreenUpdates=0;
 const video={isConnected:true,paused:true,ended:false,addEventListener:(name,fn)=>events[name]=fn,removeEventListener(){}};
 const c=vm.createContext({STATE:{enabled:true,hasSync:true,contextInvalidated:false},videoEl:null,videoTimeUpdateHandler:null,videoForceUpdateHandler:null,videoEndedHandler:null,videoMetadataHandler:null,trackingRaf:0,lyricsWasVisible:true,practiceFullscreen:null,pendingReturnToCurrent:false,manualScrollUntil:0,performance:{now:()=>10},getVideoElement:()=>video,getAuthoritativePlaybackTime:()=>17,canTrackCurrentPlayback:()=>true,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},syncPracticeFullscreenTracking:()=>fullscreenUpdates++});
 vm.runInContext(read('src/content/tracking.js'),c);c.updateHighlight=(time,force)=>{updates.push([time,force]);};
 c.ensureVideoListener();frames.shift()();assert.equal(updates.length,0);
 events.seeked();assert.deepEqual(updates.at(-1),[17,true]);assert.equal(fullscreenUpdates,1);
 video.paused=false;events.play();assert.deepEqual(updates.at(-1),[17,true]);
 frames.shift()();assert.equal(updates.length,3);
 c.lyricsWasVisible=false;frames.shift()();assert.equal(updates.length,3);
 c.practiceFullscreen={};frames.shift()();assert.equal(updates.length,4);
});

test('watchdog allows resumed display a fresh tracking grace period',()=>{
 let now=10000,recoveries=0;
 const state={enabled:true,hasSync:true,trackingEnabled:true,healthVideoId:'song',healthPlaybackTime:8,healthPlaybackSampleAt:9700,healthLastAdvanceAt:9700,lyricsAppliedAt:100,lastTrackingPulseAt:1000,lines:[],currentIndex:0};
 const c=vm.createContext({STATE:state,trackingDisplayResumedAt:10000,performance:{now:()=>now},getFreshPlayerSnapshot:()=>({playerState:1,currentTime:now/1000}),getAuthoritativeVideoId:()=> 'song',trackingDisplayVisible:()=>true,performLyricsResync:()=>recoveries++,effectiveTimingOffsetMs:()=>0,isManualScrollPaused:()=>false});
 vm.runInContext(read('src/content/health.js'),c);c.performLyricsResync=()=>recoveries++;
 c.runAutoRecoveryWatchdog();assert.equal(recoveries,0);
 now=14000;c.runAutoRecoveryWatchdog();assert.equal(recoveries,1);
});

test('a paused seek highlights the new row even before the bridge publishes its updated time',()=>{
 const frames=[],events={};
 const video={isConnected:true,paused:true,ended:false,currentTime:12,addEventListener:(type,fn)=>{events[type]=fn;}};
 const STATE={enabled:true,hasSync:true,trackingEnabled:true,syncLevel:'line',currentIndex:0,currentWordIndex:-1,
  lines:[{time:0},{time:60}],playerSnapshot:{videoId:'song',currentTime:12,receivedAt:100,playerState:2},displayedVideoId:'song',trackStartGuardActive:false};
 const c=vm.createContext({STATE,videoEl:null,videoTimeUpdateHandler:null,trackingRaf:0,lyricsWasVisible:true,pendingReturnToCurrent:false,manualScrollUntil:0,
  performance:{now:()=>100},window:{addEventListener(){}},requestAnimationFrame:fn=>frames.push(fn),getVideoElement:()=>video,getVideoId:()=> 'song',getPlayerVideoIdFromDom:()=> 'song',timingOffsetSeconds:()=>0,
  listEl:{children:STATE.lines.map(()=>({classList:{toggle(){}}}))}});
 for(const name of ['player-bridge','lyrics-storage','tracking'])vm.runInContext(read('src/content/'+name+'.js'),c);
 c.scrollCurrentLineIntoView=()=>true;c.ensureVideoListener();
 video.currentTime=75;events.seeked({type:'seeked'});
 assert.equal(STATE.currentIndex,1);
 assert.equal(STATE.playerSnapshot.currentTime,12);
 frames.shift()();assert.equal(STATE.currentIndex,1);
 STATE.playerSnapshot.videoId='other';video.currentTime=4;events.seeked({type:'seeked'});
 assert.equal(STATE.currentIndex,1);
});
