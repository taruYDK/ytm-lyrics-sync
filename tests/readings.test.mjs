import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {englishPhonesToKana,englishReadingRanges,japaneseReadingRanges,readingPartsForFragment,toReadingHiragana,mergeManualReadings,layoutManualLineReadings,readingSegmentProgressCss} from '../src/core/readings.mjs';
const dictionary=JSON.parse(fs.readFileSync(new URL('../vendor/readings/english.json',import.meta.url),'utf8'));

test('readings: English words, contractions, punctuation and unknown words',()=>{
 const text="Hello, I love you! Don't zzzqqq.";
 const ranges=englishReadingRanges(text,dictionary);
 assert.deepEqual(ranges.map(r=>[text.slice(r.start,r.end),r.reading]),[['Hello','ハロー'],['I','アイ'],['love','ラブ'],['you','ユー'],["Don't",'ドント']]);
 assert.equal(englishPhonesToKana('N AY1 T'),'ナイト');
 assert.equal(englishPhonesToKana('D R IY1 M'),'ドリーム');
 assert.equal(englishPhonesToKana('UNKNOWN'),'');
 assert.equal(Object.keys(dictionary).length>100000,true);
});
test('readings: Japanese okurigana stays outside ruby and timed fragments preserve all text',()=>{
 const text='今日も歩く';
 const ranges=japaneseReadingRanges(text,[{surface_form:'今日',reading:'キョウ'},{surface_form:'も',reading:'モ'},{surface_form:'歩く',reading:'アルク'}]);
 assert.deepEqual(ranges,[{start:0,end:2,reading:'きょう'},{start:3,end:4,reading:'ある'}]);
 assert.equal(toReadingHiragana('カタカナ'),'かたかな');
 const parts=[...readingPartsForFragment('今',0,ranges),...readingPartsForFragment('日も歩く',1,ranges)];
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.equal(parts.map(p=>p.reading).join(''),'きょうある');
 const english=englishReadingRanges('love',dictionary);
 assert.equal([...readingPartsForFragment('lo',0,english),...readingPartsForFragment('ve',2,english)].map(p=>p.reading).join(''),'ラブ');
});
test('readings: bundled browser tokenizer loads local extension URLs and reads real Japanese',async()=>{
 const requests=[];
 class LocalXHR {
   open(method,url){assert.equal(method,'GET');assert.match(url,/^chrome-extension:\/\/test\/vendor\/kuromoji\/dict\/[a-z_]+\.dat\.gz$/);this.url=url;requests.push(url);}
   send(){fs.readFile(fileURLToPath(new URL('../'+this.url.split('/test/')[1],import.meta.url)),(error,data)=>{
     if(error){this.onerror(error);return;}this.status=200;this.response=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);this.onload();
   });}
 }
 const context=vm.createContext({XMLHttpRequest:LocalXHR,setTimeout,clearTimeout,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,ArrayBuffer,DataView,console});
 context.window=context;
 vm.runInContext(fs.readFileSync(new URL('../vendor/kuromoji/kuromoji.js',import.meta.url),'utf8'),context);
 const tokenizer=await new Promise((resolve,reject)=>context.kuromoji.builder({dicPath:'chrome-extension://test/vendor/kuromoji/dict/'}).build((error,result)=>error?reject(error):resolve(result)));
 const text='今日も君と歩く。Hello world!';
 const tokens=tokenizer.tokenize(text);
 const ranges=japaneseReadingRanges(text,tokens);
 assert(ranges.some(r=>text.slice(r.start,r.end)==='今日'&&r.reading==='きょう'));
 assert(ranges.some(r=>text.slice(r.start,r.end)==='君'&&r.reading==='きみ'));
 assert(ranges.some(r=>text.slice(r.start,r.end)==='歩'&&r.reading==='ある'));
 assert.equal(requests.length,12);
});
test('readings: stale asynchronous results cannot annotate a replacement track',async()=>{
 let finish;const loaded=new Promise(resolve=>finish=resolve);
 const row={textContent:'',querySelectorAll:()=>[],parentElement:null};
 const list={children:[row],dataset:{}};row.parentElement=list;
 const lines=[{text:'hello'}];
 const context=vm.createContext({STATE:{lines,readingEnglish:true,readingJapanese:false},listEl:list,lyricsToolsEl:null,
 editableLineText:line=>line.text,englishReadingRanges,japaneseReadingRanges,readingPartsForFragment,mergeManualReadings,layoutManualLineReadings,readingSegmentProgressCss,setTimeout,clearTimeout,scheduleTrackingRealignment(){}});
 vm.runInContext(fs.readFileSync(new URL('../src/content/readings.js',import.meta.url),'utf8'),context);
 context.getEnglishReadings=()=>loaded;
 context.putReadingParts=()=>{throw Error('stale content was applied');};
 const pending=context.refreshLyricsReadings();
 context.STATE.lines=[{text:'new track'}];finish(dictionary);await pending;
});

test('readings: ruby preserves timed spans and source data; OFF restores plain lyrics',async()=>{
 class Node {
   constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';}
   set textContent(text){this.value=text;this.children=[];}
   get textContent(){return this.value+this.children.map(child=>child.textContent).join('');}
   setAttribute(){}
   append(...nodes){nodes.forEach(node=>this.appendChild(node));}
   appendChild(node){if(node.tag==='fragment'){node.children.forEach(child=>this.appendChild(child));return;}node.parentElement=this;this.children.push(node);}
   replaceChildren(...nodes){this.value='';this.children=[];this.append(...nodes);}
   querySelectorAll(selector){return this.children.flatMap(child=>[...(child.className===selector.slice(1)?[child]:[]),...child.querySelectorAll(selector)]);}
 }
 const document={createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('fragment'),createTextNode:text=>{const n=new Node('text');n.textContent=text;return n;}};
 const list=new Node('list'),row=new Node('row');list.appendChild(row);
 const words=[{text:'lo',time:1,end:1.4},{text:'ve',time:1.4,end:2}];
 words.forEach(word=>{const span=new Node('span');span.className='ytmls-word';span.textContent=word.text;row.appendChild(span);});
 const originalSpans=[...row.children],lines=[{text:'love',time:1,end:2,words}];const before=JSON.stringify(lines);
 const context=vm.createContext({STATE:{lines,readingEnglish:true,readingJapanese:false},listEl:list,lyricsToolsEl:null,document,
 editableLineText:line=>line.words.map(word=>word.text).join(''),readingPartsForFragment,englishReadingRanges,japaneseReadingRanges,mergeManualReadings,layoutManualLineReadings,readingSegmentProgressCss,setTimeout,clearTimeout,scheduleTrackingRealignment(){}});
 vm.runInContext(fs.readFileSync(new URL('../src/content/readings.js',import.meta.url),'utf8'),context);
 context.getEnglishReadings=async()=>dictionary;
 await context.refreshLyricsReadings();
 assert.deepEqual(row.children,originalSpans);
 assert.equal(row.children.map(span=>span.children[0].children[0].textContent).join(''),'love');
 assert.equal(row.children.map(span=>span.children[0].children[1].textContent).join(''),'ラブ');
 assert.equal(JSON.stringify(lines),before);
 context.STATE.readingEnglish=false;await context.refreshLyricsReadings();
 assert.equal(row.textContent,'love');assert.deepEqual(row.children,originalSpans);assert.equal(JSON.stringify(lines),before);
});

test('manual readings: replace overlapping automatic readings, hide ruby and preserve timed text', () => {
  const text = '今日 love';
  const automatic = [{start:0,end:2,reading:'きょう'},{start:3,end:7,reading:'ラブ'}];
  const manual = [{text,start:0,end:2,reading:'こんにち'},{text,start:3,end:7,reading:''}];
  const ranges = mergeManualReadings(text,automatic,manual);
  assert.deepEqual(ranges.map(r=>r.reading),['こんにち','']);
  const parts = [...readingPartsForFragment('今',0,ranges),...readingPartsForFragment('日 love',1,ranges)];
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.equal(parts.map(p=>p.reading).join(''),'こんにち');
  assert.deepEqual(mergeManualReadings('別の歌詞',[],manual),[]);
  assert.deepEqual(mergeManualReadings(text,[],manual,false,false),[]);
  assert.deepEqual(mergeManualReadings(text,automatic,[]),automatic);
});

test('manual readings: invalid saved ranges are ignored and overlapping corrections resolve deterministically', () => {
  const text='hello';
  const ranges=mergeManualReadings(text,[],[null,{text,start:-1,end:2,reading:'x'}, {text,start:0,end:9,reading:'x'},
    {text,start:0,end:5,reading:'ハロー'},{text,start:0,end:2,reading:'へ'}]);
  assert.deepEqual(ranges,[{text,start:0,end:2,reading:'へ'}]);
});

test('manual readings: local storage is isolated per track and read errors are surfaced', async () => {
  const data = {ytmls_manual_readings_songA:[{text:'love',start:0,end:4,reading:'ラヴ'}]};
  const chrome={runtime:{},storage:{local:{get(key,callback){callback(data);}}}};
  const context=vm.createContext({chrome,sendUserDataMutation:async message=>{if(chrome.runtime.lastError) throw Error('failed');return {entries:message.videoId==='songA'?data.ytmls_manual_readings_songA:[]};}});
  vm.runInContext(fs.readFileSync(new URL('../src/content/readings.js',import.meta.url),'utf8'),context);
  assert.equal((await context.loadManualReadings('songA'))[0].reading,'ラヴ');
  assert.equal((await context.loadManualReadings('songB')).length,0);
  chrome.runtime.lastError={message:'failed'};
  await assert.rejects(context.loadManualReadings('songA'),/failed/);
});

test('manual line readings: identical lyric lines can have separate readings and legacy entries remain usable', () => {
 const text='今日';
 const entries=[{text,lineIndex:0,start:0,end:2,reading:'きょう'},{text,lineIndex:1,start:0,end:2,reading:'こんにち'}];
 assert.equal(mergeManualReadings(text,[],entries,true,true,0)[0].reading,'きょう');
 assert.equal(mergeManualReadings(text,[],entries,true,true,1)[0].reading,'こんにち');
 assert.equal(mergeManualReadings(text,[],entries,true,true,2).length,0);
 assert.equal(mergeManualReadings(text,[],[{text,start:0,end:2,reading:'きょう'}],true,true,2)[0].reading,'きょう');
});

test('manual line layout: screenshot sentence aligns readings to kanji instead of a single centered ruby', () => {
 const text='戻って歩き出す 宝物を閉じ込める場所を探して';
 const reading='もどってあるきだす たからものをとじこめるばしょをさがして';
 const ranges=layoutManualLineReadings(text,[{text,start:0,end:text.length,lineIndex:0,reading}]);
 assert.deepEqual(ranges.map(r=>[text.slice(r.start,r.end),r.reading]),[['戻','もど'],['歩','ある'],['出','だ'],['宝物','たからもの'],['閉','と'],['込','こ'],['場所','ばしょ'],['探','さが']]);
 const parts=readingPartsForFragment(text,0,ranges);
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.equal(parts.map(p=>p.reading||p.text).join(''),reading);
});

test('manual line layout: English words, unmatched spelling and timed fragments preserve content', () => {
 const text='Hello world';
 const ranges=layoutManualLineReadings(text,[{start:0,end:11,lineIndex:0,reading:'ハロー ワールド'}]);
 assert.deepEqual(ranges,[{start:0,end:5,reading:'ハロー'},{start:6,end:11,reading:'ワールド'}]);
 const parts=[...readingPartsForFragment('Hel',0,ranges),...readingPartsForFragment('lo world',3,ranges)];
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.equal(parts.map(p=>p.reading).join(''),'ハローワールド');
 const fallback=layoutManualLineReadings(text,[{start:0,end:11,lineIndex:0,reading:'はろーわーるど'}]);
 assert.equal(fallback.map(r=>r.reading).join(''),'はろーわーるど');
 assert(fallback.every(r=>r.end-r.start===1));
 const hidden={start:0,end:11,lineIndex:0,reading:''};
 assert.deepEqual(layoutManualLineReadings(text,[hidden]),[hidden]);
});

test('manual layout: unknown English, adjacent kanji, separate language toggles and shifted rows',()=>{
 const text='君のYOLO夢',entry={text,lineIndex:0,occurrence:0,start:0,end:text.length,reading:'きみのYOLOゆめ'};
 const merged=mergeManualReadings(text,[],[entry],true,true,7,0);
 const result=layoutManualLineReadings(text,merged);
 assert.deepEqual(result.map(r=>[text.slice(r.start,r.end),r.reading]),[['君','きみ'],['YOLO',''],['夢','ゆめ']]);
 const mixed='I love 君', e={text:mixed,lineIndex:0,start:0,end:mixed.length,reading:'アイ ラブ きみ'};
 const english=layoutManualLineReadings(mixed,mergeManualReadings(mixed,[],[e],false,true,0),false,true);
 assert.deepEqual(english.map(r=>r.reading),['アイ','ラブ']);
 const japanese=layoutManualLineReadings(mixed,mergeManualReadings(mixed,[],[e],true,false,0),true,false);
 assert.deepEqual(japanese.map(r=>r.reading),['きみ']);
});

test('ruby tracking: each base and reading receives a sequential interval, including intervening kana',()=>{
 class Node {
  constructor(){this.children=[];this.dataset={};this.props={};this.style={setProperty:(k,v)=>this.props[k]=v};this.classList={contains:()=>false};}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);}
  setAttribute(){}
  replaceChildren(fragment){this.children=fragment.children;}
 }
 const document={createElement:()=>new Node(),createDocumentFragment:()=>new Node(),createTextNode:text=>({textContent:text})};
 const context=vm.createContext({document,readingPartsForFragment,readingSegmentProgressCss});
 vm.runInContext(fs.readFileSync(new URL('../src/content/readings.js',import.meta.url),'utf8'),context);
 const word=new Node();word.classList.contains=name=>name==='ytmls-word';
 context.putReadingParts(word,'君の夢',0,[{start:0,end:1,reading:'きみ'},{start:2,end:3,reading:'ゆめ'}]);
 assert.equal(word.children.length,3);assert.equal(word.dataset.readingParts,'true');
 const expressions=word.children.map(c=>c.props['--ytmls-part-progress']);
 function progress(css,percent){const m=css.match(/- ([\d.]+)%\) \* ([\d.]+)/);return Math.max(0,Math.min(100,(percent-Number(m[1]))*Number(m[2])));}
 assert.deepEqual(expressions.map(s=>Math.round(progress(s,20))),[60,0,0]);
 assert.deepEqual(expressions.map(s=>Math.round(progress(s,50))),[100,50,0]);
 assert.deepEqual(expressions.map(s=>Math.round(progress(s,80))),[100,100,40]);
 assert.deepEqual(expressions.map(s=>Math.round(progress(s,0))),[0,0,0]);
 assert.deepEqual(expressions.map(s=>Math.round(progress(s,100))),[100,100,100]);
 assert.equal(word.children[1].className,'ytmls-reading-plain');
});
