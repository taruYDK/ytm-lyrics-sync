import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('helpful UI status distinguishes searching, source, unavailable and disabled',()=>{
 const STATE={enabled:true,lastTrackKey:'song',isSearching:true};const c=vm.createContext({STATE});
 vm.runInContext(fs.readFileSync(new URL('../src/content/helpful-ui.js',import.meta.url),'utf8'),c);
 assert.equal(c.helpfulStatus(),'歌詞を検索中…');STATE.isSearching=false;assert.equal(c.helpfulStatus(),'同期歌詞が見つかりません');
 STATE.hasLyricsResult=true;STATE.hasSync=true;STATE.source='YouTube Music';assert.match(c.helpfulStatus(),/取得済み · YouTube Music/);
 STATE.enabled=false;assert.equal(c.helpfulStatus(),'拡張機能はOFFです');
});
