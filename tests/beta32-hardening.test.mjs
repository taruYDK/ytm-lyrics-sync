import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function requestHarness(response) {
 let handler,last,canceled=false;
 const c=vm.createContext({chrome:{runtime:{id:'self',getManifest:()=>({version:'2.8.0'}),onMessage:{addListener:f=>handler=f}}},importScripts(){},URL,AbortController,TextEncoder,TextDecoder,setTimeout,clearTimeout,fetch:async(url,init)=>{last={url,init};return response?.(()=>canceled=true)||new Response('{}');}});
 vm.runInContext(read('extension/background.js'),c);
 return {send:message=>new Promise(r=>handler({type:'YTMLS_FETCH',url:'https://lrclib.net/api/search',...message},{id:'self'},r)),last:()=>last,canceled:()=>canceled};
}
test('fetch rejects redirects and restricts credential inclusion to Better Lyrics',async()=>{
 const h=requestHarness();for(const url of ['https://lrclib.net/api/search','https://lyrics.api.dacubeking.com/v2/lyrics']){
  assert.equal((await h.send({url,credentials:'include'})).ok,true);assert.equal(h.last().init.redirect,'error');assert.equal(h.last().init.credentials,url.includes('dacubeking')?'include':'omit');
 }
});
test('fetch rejects declared or streamed oversized bodies and cancels the download',async()=>{
 const declared=requestHarness(cancel=>new Response(new ReadableStream({cancel}),{headers:{'Content-Length':String(9*1024*1024)}}));const r=await declared.send({});assert.equal(r.ok,false);assert.match(r.error,/8 MiB/);assert(declared.last().init.signal.aborted);assert(declared.canceled());
 const streamed=requestHarness(cancel=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(5*1024*1024));},cancel})));const s=await streamed.send({});assert.equal(s.ok,false);assert.match(s.error,/8 MiB/);assert(streamed.last().init.signal.aborted);assert(streamed.canceled());
});
test('fetch decodes UTF-8 split between streamed chunks',async()=>{
 const bytes=new TextEncoder().encode('{"value":"歌詞"}');const h=requestHarness(()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i++)c.enqueue(bytes.slice(i,i+1));c.close();}})));const r=await h.send({});assert.equal(r.ok,true);assert.equal(r.data.value,'歌詞');
});
test('legacy Better Lyrics GET never reads or sends JWT in the URL',async()=>{
 let requested;const c=vm.createContext({STATE:{lastTrackKey:'song'},URLSearchParams,setStatus(){},refreshSearchingSubtext(){},cleanTitle:s=>s,cleanArtist:s=>s,storageLocalGet(){throw Error('JWT should not be read');},fetchJson:async(url)=>{requested=url;return{ok:false}}});vm.runInContext(read('src/content/providers.js'),c);await c.fetchFromBetterLyricsJson({videoId:'video',title:'title'},100,'song');assert(requested.includes('lyrics?'));assert.equal(new URL(requested).searchParams.has('token'),false);
});
test('English dictionary loads through an internal message and retries after a failure',async()=>{
 let calls=0;const c=vm.createContext({chrome:{runtime:{sendMessage:async()=>{if(++calls===1)return{ok:false,error:'temporary'};return{ok:true,dictionary:{hello:'ハロー'}};}}}});vm.runInContext(read('src/content/readings.js'),c);await assert.rejects(c.getEnglishReadings(),/temporary/);assert.equal((await c.getEnglishReadings()).hello,'ハロー');await c.getEnglishReadings();assert.equal(calls,2);
});
test('worker dictionary is cached internally and rejects other extension senders',async()=>{
 let handler,loads=0;const c=vm.createContext({chrome:{runtime:{id:'self',getURL:path=>'chrome-extension://self/'+path,onMessage:{addListener:f=>handler=f}}},fetch:async url=>{loads++;assert.match(url,/^chrome-extension:\/\/self\//);return{ok:true,json:async()=>({hello:'ハロー'})}}});vm.runInContext(read('extension/readings-service.js'),c);const request=id=>new Promise(r=>handler({type:'YTMLS_ENGLISH_READINGS'},{id},r));assert.equal((await request('other')).ok,false);assert.equal(loads,0);assert.equal((await request('self')).dictionary.hello,'ハロー');await request('self');assert.equal(loads,1);
 const manifest=JSON.parse(read('extension/manifest.json'));assert.equal(manifest.web_accessible_resources.length,0);
});
test('legacy sync keys are removed only when a legacy value was loaded',()=>{
 for(const old of [false,true]){let removed=[];const c=vm.createContext({STATE:{},DEFAULT_PROVIDER_ORDER:[],normalizedProviderOrder:()=>[],normalizedProviderEnabled:()=>({}),applySettings(){},tick(){},chrome:{runtime:{},storage:{onChanged:{addListener(){}},sync:{get:(defaults,cb)=>cb({...defaults,enabled:false,uiVersion:6,...(old?{trackingMode:'old'}:{})}),remove:(keys,cb)=>{removed=Array.from(keys);cb();}}}}});vm.runInContext(read('src/content/settings.js'),c);c.loadSettings();assert.deepEqual(removed,old?['trackingMode']:[]);}
});
