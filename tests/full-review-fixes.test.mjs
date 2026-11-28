import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('TTML: the space between word spans stays with the words', () => {
  const Node = {ELEMENT_NODE: 1, TEXT_NODE: 3};
  const span = (text, begin) => ({nodeType: 1, localName: 'span', textContent: text, children: [], childNodes: [],
    getAttribute: name => name === 'begin' ? begin : name === 'end' ? String(Number(begin) + .5) : null});
  const textNode = value => ({nodeType: 3, nodeValue: value});
  const c = vm.createContext({Node});
  vm.runInContext(read('src/content/lyrics-parser.js'), c);
  const p = {childNodes: [span('Hello', '1'), textNode(' '), span('world', '1.5'), textNode('  \n ')]};
  const words = [];
  c.collectTimedSpans(p, false, words);
  assert.deepEqual(words.map(w => w.text), ['Hello ', 'world ']);
  assert.equal(words.map(w => w.text).join('').trim(), 'Hello world');
  // Syllables written next to each other stay joined.
  const syllables = [];
  c.collectTimedSpans({childNodes: [span('beau', '1'), span('ti', '1.2'), span('ful', '1.4')]}, false, syllables);
  assert.equal(syllables.map(w => w.text).join(''), 'beautiful');
});

test('lyrics cache keeps the candidate id that saved edits are stored under', () => {
  const c = vm.createContext({STATE: {lyricsCache: new Map()}, setTimeout: () => 1, clearTimeout() {}, chrome: {storage: {local: {set() {}}}},
    providerConfigSignature: () => 'sig', lyricCandidateIdentity: () => 'rebuilt'});
  vm.runInContext(read('src/content/lyrics-storage.js'), c);
  c.rememberLyricsInCache('song', {lines: [{time: 1, text: 'a'}], syncLevel: 'line', _candidateId: 'raw-id'});
  assert.equal(c.STATE.lyricsCache.get('song')._candidateId, 'raw-id');
  c.rememberLyricsInCache('other', {lines: [{time: 1, text: 'b'}], syncLevel: 'line'});
  assert.equal(c.STATE.lyricsCache.get('other')._candidateId, 'rebuilt');
});

test('lyrics cache takes in other tabs\' additions and removals', () => {
  const c = vm.createContext({STATE: {lyricsCache: new Map([['mine', {lines: [{}], ts: 5}], ['gone', {lines: [{}], ts: 1}]])}, setTimeout: () => 1, clearTimeout() {}, chrome: {storage: {local: {set() {}}}}});
  vm.runInContext(read('src/content/lyrics-storage.js'), c);
  c.mergeLyricsCacheChange({oldValue: {gone: {lines: [{}]}, mine: {lines: [{}], ts: 5}}, newValue: {mine: {lines: [{}], ts: 2}, theirs: {lines: [{}], ts: 9}}});
  assert.deepEqual([...c.STATE.lyricsCache.keys()].sort(), ['mine', 'theirs']);
  assert.equal(c.STATE.lyricsCache.get('mine').ts, 5, 'a newer entry of this tab is kept');
});

test('Better Lyrics SSE: multi-line data is joined per the spec, keeping spaces inside values', () => {
  const synced = [];
  const c = vm.createContext({STATE: {}, URLSearchParams, parseLRC: text => { synced.push(text); return [{time: 1, text}]; },
    parseTTML: () => ({lines: [], syncLevel: 'none'}), parseInlineTimedLrc: () => ({lines: [], syncLevel: 'none'}),
    lyricsLanguageFit: () => 0, inferTrackLanguage: () => 'en', setStatus() {}, refreshSearchingSubtext() {}});
  vm.runInContext(read('src/content/providers.js'), c);
  // One event split over three data lines, the last one without the optional space.
  const raw = 'event: provider\ndata: {"provider":"lrclib",\ndata:   "results": {"synced": "[00:01.00]  a  b  "}\ndata:}\n\n';
  const result = c.parseBetterLyricsSse(raw, 200, {title: 't', artist: 'a'});
  assert.ok(result, 'the event is read');
  assert.deepEqual(synced, ['[00:01.00]  a  b  ']);
});

test('lyric edits from another tab apply to the song shown here', () => {
  const source = read('src/content/settings.js');
  assert.match(source, /editsForShownChanged && lyricsToolsPaneMode !== "edit"/);
  assert.match(source, /applyLyricsResult\(candidate\.result, info, STATE\.lastTrackKey, STATE\.searchGeneration\)/);
  assert.match(source, /mergeLyricsCacheChange\(changes\[LYRICS_CACHE_STORAGE_KEY\]\)/);
});
