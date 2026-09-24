import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('quick LRCLIB: one bounded request, validated synced candidate, stale response discarded',async()=>{
 let finish, calls=0;
 const context=vm.createContext({STATE:{lastTrackKey:'song'},URLSearchParams,
 fetchJson:(url,options)=>{calls++;assert.match(url,/track_name=Song/);assert.equal(options.timeoutMs,8000);return new Promise(resolve=>finish=resolve);},
 bestSearchResult:(items,title,artist,duration)=>{assert.equal(title,'Song');assert.equal(artist,'Artist');assert.equal(duration,180);assert.equal(items.length,1);return items[0];},
 parseLRC:()=>[{time:0,text:'lyric'}]});
 vm.runInContext(fs.readFileSync(new URL('../src/content/providers.js',import.meta.url),'utf8'),context);
 const info={title:'Song',artist:'Artist'};
 const pending=context.fetchFromLrclibQuick(info,180,'song');
 finish({ok:true,data:[{plainLyrics:'plain'},{syncedLyrics:'[00:00]lyric'}]});
 assert.equal((await pending).syncLevel,'line');assert.equal(calls,1);
 const stale=context.fetchFromLrclibQuick(info,180,'song');context.STATE.lastTrackKey='other';
 finish({ok:true,data:[{syncedLyrics:'[00:00]lyric'}]});assert.equal(await stale,null);
});
