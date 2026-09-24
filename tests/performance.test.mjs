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
 assert.equal(writes.length,1);assert.equal(writes[0].ytmlsLyricsCacheV198.song.lines[0].text,'3');
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
 vm.runInContext(read('readings-worker.js'),c);c.onmessage({data:{id:1,text:'今日'}});
 const r=await result;assert.equal(r.ok,true);assert.equal(r.tokens[0].reading,'キョウ');
 assert.deepEqual(Object.keys(r.tokens[0]).sort(),['reading','surface_form']);
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
