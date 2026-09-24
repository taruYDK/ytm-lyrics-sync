import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../src/content/native-lyrics.js',import.meta.url),'utf8');
const browse=rows=>({contents:{elementRenderer:{newElement:{type:{componentType:{model:{timedLyricsModel:{lyricsData:{timedLyricsData:rows}}}}}}}}});
const next={contents:{singleColumnMusicWatchNextResultsRenderer:{tabbedRenderer:{watchNextTabbedResultsRenderer:{tabs:[{tabRenderer:{endpoint:{browseEndpoint:{browseId:'MPLYtest',browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_TRACK_LYRICS'}}}}}}]}}}}};
const row=(text,start,end)=>({lyricLine:text,cueRange:{startTimeMilliseconds:start,endTimeMilliseconds:end}});
test('YouTube Music: validate timing, reject plain/zero timestamps and order rows',()=>{
 const c=vm.createContext({});vm.runInContext(code,c);
 const parsed=c.parseNativeTimedLyrics(browse([row('second','2000','3500'),row('first','1280','2000'),row('invalid',0,0),row('bad','NaN',5000)]));
 assert.equal(parsed.lines.length,2);assert.equal(parsed.lines[0].time,1.28);assert.equal(parsed.syncLevel,'line');
 assert.equal(c.parseNativeTimedLyrics(browse([row('zero',0,0)])),null);assert.equal(c.parseNativeTimedLyrics({}),null);
 assert.equal(c.nativeLyricsBrowseId(next),'MPLYtest');
});
test('YouTube Music: anonymous video-id lookup; no second request after track change',async()=>{
 let count=0;const c=vm.createContext({STATE:{lastTrackKey:'track',enabled:true,providerEnabled:{}},AbortController,setTimeout,clearTimeout,
 fetch:async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);count++;const body=JSON.parse(options.body);if(count===1){assert.equal(body.videoId,'nBs26EgzsS0');return {ok:true,json:async()=>next};}assert.equal(body.browseId,'MPLYtest');return {ok:true,json:async()=>browse([row('sample',1280,2000)])};}});
 vm.runInContext(code,c);assert.equal((await c.fetchFromYouTubeMusic({videoId:'nBs26EgzsS0'},200,'track')).lines.length,1);assert.equal(count,2);
 count=0;c.fetch=async()=>{count++;c.STATE.lastTrackKey='other';return {ok:true,json:async()=>next};};
 assert.equal(await c.fetchFromYouTubeMusic({videoId:'nBs26EgzsS0'},200,'track'),null);assert.equal(count,1);
});
