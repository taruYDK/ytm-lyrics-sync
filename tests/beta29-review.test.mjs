import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readingTokensToRomaji} from '../src/core/practice.mjs';
import {japaneseReadingRanges,mergeManualReadings,layoutManualLineReadings} from '../src/core/readings.mjs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('inline LRC associates repeated rows before sorting and applies offsets to words',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/lyrics-parser.js')+read('src/content/providers.js'),c);
 const result=c.parseInlineTimedLrc('[offset:1000]\n[00:10][01:10]<00:10>A<00:11>\n[00:20]B');
 assert.deepEqual(Array.from(result.lines,l=>[l.time,l.text,l.words[0]?.time,l.words[0]?.end]),[[9,'A',9,10],[19,'B',undefined,undefined],[69,'A',69,70]]);
 assert.equal(result.lines[1].end,69);assert.equal(result.syncLevel,'word');
});
test('romaji uses pronunciation for particles and keeps reading as a fallback',()=>{
 assert.equal(readingTokensToRomaji([{surface_form:'私',reading:'ワタシ',pronunciation:'ワタシ'},{surface_form:'は',reading:'ハ',pronunciation:'ワ'},{surface_form:'君',reading:'キミ'},{surface_form:'へ',reading:'ヘ',pronunciation:'エ'},{surface_form:'愛',reading:'アイ'},{surface_form:'を',reading:'ヲ',pronunciation:'ヲ'}]),'watashi wa kimi e ai o');
 assert.equal(readingTokensToRomaji([{surface_form:'ハ',reading:'ハ',pronunciation:'ハ'}]),'ha');
 assert.equal(readingTokensToRomaji([{reading:'キミ'},{surface_form:' '},{surface_form:'、'},{reading:'アイ'},{surface_form:'。'}]),'kimi, ai.');
});
test('readings worker returns reading and pronunciation without changing ruby reading',async()=>{
 const posts=[];const c=vm.createContext({self:{location:{href:'https://extension/readings-worker.js'},kuromoji:{builder:()=>({build:fn=>fn(null,{tokenize:()=>[{surface_form:'は',reading:'ハ',pronunciation:'ワ'}]})})},postMessage:m=>posts.push(m)},importScripts(){},URL});vm.runInContext(read('extension/readings-worker.js'),c);
 await c.self.onmessage({data:{id:1,text:'は'}});assert.equal(posts[0].tokens[0].reading,'ハ');assert.equal(posts[0].tokens[0].pronunciation,'ワ');
});
test('a transient tokenizer failure does not poison the reading cache',async()=>{
 const row={querySelectorAll:()=>[]},list={children:[row],dataset:{}};row.parentElement=list;
 const c=vm.createContext({STATE:{lines:[{text:'今日'}],readingJapanese:true,readingEnglish:false},listEl:list,lyricsToolsEl:null,editableLineText:l=>l.text,japaneseReadingRanges,mergeManualReadings,layoutManualLineReadings,setTimeout,scheduleTrackingRealignment(){}});vm.runInContext(read('src/content/readings.js'),c);
 let calls=0,rendered=[];c.getJapaneseReadingTokenizer=async()=>({tokenize:async()=>{if(++calls===1)throw Error('worker timeout');return [{surface_form:'今日',reading:'キョウ'}]}});c.loadManualReadings=async()=>[];c.putReadingParts=(node,text,offset,ranges)=>rendered=ranges;
 await c.refreshLyricsReadings();assert.equal(vm.runInContext('lyricsReadingCache.size',c),0);
 await c.refreshLyricsReadings();assert.equal(calls,2);assert.equal(rendered[0].reading,'きょう');
 await c.refreshLyricsReadings();assert.equal(calls,2);
});
test('lyrics tab fallback never scans the document span/div tree on home',()=>{
 const scans=[];const c=vm.createContext({externalLyricsOpen:false,externalLyricsHost:null,document:{querySelector:()=>null,querySelectorAll:s=>{scans.push(s);return []}}});vm.runInContext(read('src/content/auto-open.js'),c);
 for(let i=0;i<50;i++){assert.equal(c.findLyricsTabButton(),null);assert.equal(c.findNextContentTabButton(),null);assert.equal(c.isNextContentViewActive(),false);}
 assert(!scans.some(s=>['yt-formatted-string','.tab-content','[aria-label]','[title]','span','div'].includes(s)));
});
test('wheel bursts reuse view checks while every event resets the idle timer',()=>{
 let now=0,calls=0;const c=vm.createContext({STATE:{enabled:true,autoLyricsOnIdle:true},performance:{now:()=>now},getAuthoritativeVideoId:()=> 'song'});vm.runInContext(read('src/content/auto-open.js'),c);c.isNextContentViewActive=()=>{calls++;return true;};
 for(let i=0;i<20;i++){now=i*3;c.noteUserInteraction({isTrusted:true,type:'wheel'});}assert.equal(calls,1);assert.equal(c.STATE.lyricsAutoOpenArmedAt,57);
 now=90;c.noteUserInteraction({isTrusted:true,type:'wheel'});assert.equal(calls,2);
 now=95;c.noteUserInteraction({isTrusted:true,type:'pointerdown'});assert.equal(calls,3);
});
test('animation frame checks playback once and skips fullscreen sync on a blocked transition',()=>{
 let guardCalls=0,fullCalls=0,allowed=true;const frames=[],video={isConnected:true};
 const c=vm.createContext({trackingRaf:0,videoEl:video,STATE:{enabled:true,hasSync:true,lines:[{}],trackingEnabled:false,currentIndex:-1,currentWordIndex:-1},listEl:{},performance:{now:()=>1},requestAnimationFrame:f=>{frames.push(f);return frames.length;},getVideoElement:()=>video,getAuthoritativePlaybackTime:()=>1,getGuardedPlaybackTime:()=>1,canTrackCurrentPlayback:()=>{guardCalls++;return allowed;},syncPracticeFullscreenTracking:()=>fullCalls++});vm.runInContext(read('src/content/tracking.js'),c);
 c.startTrackingLoop();frames.shift()();assert.equal(guardCalls,1);assert.equal(fullCalls,1);
 allowed=false;frames.shift()();assert.equal(guardCalls,2);assert.equal(fullCalls,1);
});

test('inline offset: standard signs, zero clipping and repeated rows retain relative times',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/lyrics-parser.js')+read('src/content/providers.js'),c);
 assert.equal(c.parseLRC('[offset:1000]\n[00:10]a')[0].time,9);assert.equal(c.parseLRC('[offset:-1000]\n[00:10]a')[0].time,11);
 const p=c.parseInlineTimedLrc('[offset:2000]\n[00:01][01:01]<00:01>A<00:02>');assert.deepEqual(Array.from(p.lines,l=>[l.time,l.words[0].time,l.words[0].end]),[[0,0,0],[59,59,60]]);
 const delayed=c.parseInlineTimedLrc('[offset:-2000]\n[00:01]<00:01>A<00:02>');assert.equal(delayed.lines[0].words[0].time,3);
});

test('inline parser ignores malformed precision rows without consuming later valid rows',()=>{
 const c=vm.createContext({});vm.runInContext(read('src/content/lyrics-parser.js')+read('src/content/providers.js'),c);
 const invalid='[00:10.0000]<00:10.00>he<00:10.50>llo<00:11.00>';
 for(const text of [invalid+'\n[00:20]<00:20>B<00:21>', '[00:01]A\n'+invalid+'\n[00:20][00:40]<00:20>B<00:21>']){
  const expected=c.parseLRC(text).map(l=>[l.time,l.text]);let result;assert.doesNotThrow(()=>result=c.parseInlineTimedLrc(text));assert.deepEqual(Array.from(result.lines,l=>[l.time,l.text]),Array.from(expected,l=>Array.from(l)));
 }
 assert.equal(c.parseInlineTimedLrc(invalid).lines.length,0);
});

test('BiniLyrics requests the verified canonical API and accepts only canonical storage URLs',async()=>{
 for(const storageUrl of ['https://lrc.red/s/example.ttml','https://lrc.red.evil.example/s/example.ttml']){
  const urls=[],texts=[];const c=vm.createContext({STATE:{lastTrackKey:'song'},URLSearchParams,titleVariants:()=>['title'],artistVariants:()=>['artist'],setStatus(){},refreshSearchingSubtext(){},scoreResult:()=>200,sleep:async()=>{},fetchJson:async url=>{urls.push(url);return{ok:true,data:{results:[{lyricsUrl:storageUrl}]}}},fetchText:async url=>{texts.push(url);return{ok:true,data:'<tt></tt>'}},parseTTML:()=>({lines:[{time:0,text:'a'}],syncLevel:'line'})});vm.runInContext(read('src/content/providers.js'),c);
  const result=await c.fetchFromBiniLyrics({title:'title',artist:'artist'},100,'song');assert.equal(new URL(urls[0]).origin,'https://lrc.red');assert.equal(new URL(urls[0]).pathname,'/api/v1');assert.equal(texts.length,storageUrl.startsWith('https://lrc.red/')?1:0);assert.equal(Boolean(result),texts.length>0);
 }
});
