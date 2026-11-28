import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('More menu uses available panel height instead of clipping at 480px', () => {
 const c = vm.createContext({
  window: { innerHeight: 900 },
  panelEl: { getBoundingClientRect: () => ({ bottom: 780 }) }
 });
 vm.runInContext(fs.readFileSync(new URL('../src/content/helpful-ui.js', import.meta.url), 'utf8'), c);
 const more = { open: true, getBoundingClientRect: () => ({ top: 120 }) };
 const menu = { offsetTop: 40, style: {} };
 c.fitMoreMenu(more, menu);
 assert.equal(menu.style.maxHeight, '612px');
 c.window.innerHeight = 550;
 c.fitMoreMenu(more, menu);
 assert.equal(menu.style.maxHeight, '382px');
});

test('helpful UI status distinguishes searching, source, unavailable and disabled',()=>{
 const STATE={enabled:true,lastTrackKey:'song',isSearching:true};const c=vm.createContext({STATE,syncLevelShortLabel:level=>({line:'行',word:'単語'})[level]});
 vm.runInContext(fs.readFileSync(new URL('../src/content/helpful-ui.js',import.meta.url),'utf8'),c);
 assert.equal(c.helpfulStatus(),'歌詞を検索中…');STATE.isSearching=false;assert.equal(c.helpfulStatus(),'同期歌詞が見つかりません');
 STATE.hasLyricsResult=true;STATE.hasSync=true;STATE.syncLevel='line';STATE.trackingEnabled=true;STATE.source='YouTube Music';assert.equal(c.helpfulStatus(),' · YouTube Music');
 STATE.trackingEnabled=false;assert.equal(c.helpfulStatus(),'読むモード · YouTube Music');STATE.trackingEnabled=true;
 STATE.enabled=false;assert.equal(c.helpfulStatus(),'拡張機能はOFFです');
});

test('size presets do not receive inline menu hints that distort the row',()=>{
 let removed=0,inserted=0;
 const c=vm.createContext({document:{createElement:()=>{inserted++;return {};}}});
 vm.runInContext(fs.readFileSync(new URL('../src/content/helpful-ui.js',import.meta.url),'utf8'),c);
 const existing={classList:{contains:name=>name==='ytmls-menu-hint'},remove:()=>removed++};
 c.updateHelpfulMenuHint({disabled:true,closest:selector=>selector==='.ytmls-size-presets',nextElementSibling:existing,after:()=>inserted++});
 assert.equal(removed,1);assert.equal(inserted,0);
 const regular={nextElementSibling:null,disabled:true,title:'使えません',after:hint=>{regular.hint=hint;}};
 c.updateHelpfulMenuHint(regular);assert.equal(regular.hint.textContent,'使えません');assert.equal(regular.hint.hidden,false);
});

test('grouped lyrics menu initializes the reading editor and candidate toolbar together', () => {
 const group = { buttons: [], append(button) { this.buttons.push(button); } };
 const addLyrics = { nextSibling: {} };
 const menu = {
  querySelector: () => addLyrics,
  insertBefore() { throw new Error('Reference belongs to the nested lyrics group'); }
 };
 const lyricsToolsEl = {
  querySelector(selector) {
   if (selector === '#ytmls-lyrics-menu') return group;
   if (selector === '.ytmls-more-menu') return menu;
   if (selector === '#ytmls-reading-edit') return group.buttons[0];
   return null;
  }
 };
 let helpfulUpdates = 0;
 const candidateButtonEl = {};
 const c = vm.createContext({
  STATE: { enabled: true, lyricCandidates: [{}] }, lyricsToolsEl, candidateButtonEl,
  exportLyricsButtonEl: null, editLyricsButtonEl: null, localLyricsButtonEl: null,
  document: { createElement: () => ({ addEventListener() {}, dataset: {} }) },
  diagnosticsSummaryEl: null, updateHelpfulUi() { helpfulUpdates++; }
 });
 for (const file of ['readings.js', 'lyrics-panel.js']) {
  vm.runInContext(fs.readFileSync(new URL('../src/content/' + file, import.meta.url), 'utf8'), c);
 }
 c.canEditLyricsReadings = () => true;
 c.updateLyricsToolsUi();
 c.updateLyricsToolsUi();
 assert.equal(group.buttons.length, 1);
 assert.equal(group.buttons[0].id, 'ytmls-reading-edit');
 assert.equal(candidateButtonEl.textContent, '歌詞候補 1');
 assert.equal(helpfulUpdates, 2);
});
