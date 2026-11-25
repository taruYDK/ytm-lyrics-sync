import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('provider test classifies answers, missing lyrics, outages and HTTP errors', async () => {
  const responses = {
    'lyrics-api.boidu.dev': {ok: true, status: 200, data: {ttml: '<tt><p>x</p></tt>'}},
    'lyrics.api.dacubeking.com': {ok: true, status: 200, data: {}},
    'lrclib.net': {ok: false, status: 404, data: null},
    'unison.boidu.dev': {ok: false, status: 0, data: null},
    'lrc.red': {ok: false, status: 503, data: null},
    'www.karalyr.com': {ok: true, status: 200, data: {syncedLyrics: '[00:01.00]a'}},
  };
  let handler, rendered = [];
  const el = () => ({textContent: '', dataset: {}, className: '', append(...c) { this.children = c; }});
  const list = {replaceChildren: (...rows) => { rendered = rows; }};
  const button = {disabled: false, addEventListener: (type, fn) => { handler = fn; }};
  const chrome = {
    runtime: {sendMessage: async message => responses[new URL(message.url).hostname]},
    tabs: {query: async () => [], sendMessage: async () => ({state: 'found'})},
  };
  vm.runInNewContext(fs.readFileSync(new URL('../extension/provider-check.js', import.meta.url), 'utf8'),
    {chrome, performance: {now: () => 0}, URL, document: {getElementById: id => ({providerTestButton: button, providerTestResults: list})[id], createElement: el}});
  await handler();
  const states = Object.fromEntries(rendered.map(row => [row.children[0].textContent, [row.dataset.state, row.children[1].textContent]]));
  assert.deepEqual(states['YouTube Music（再生中の曲）'], ['notab', 'YouTube Musicを開いてください']);
  assert.equal(states['Better Lyrics'][0], 'found');
  assert.equal(states['Better Lyrics（統合API）'][0], 'notfound');
  assert.equal(states.LRCLIB[0], 'notfound');
  assert.equal(states.Unison[0], 'offline');
  assert.deepEqual(states.BiniLyrics, ['error', 'エラー（HTTP 503）・0.0秒']);
  assert.equal(states.Karalyr[0], 'found');
  assert.equal(button.disabled, false);
});

function ytmProbe(tabs, answers) {
  let handler, rendered = []; const asked = [];
  const el = () => ({textContent: '', dataset: {}, className: '', append(...c) { this.children = c; }});
  const chrome = {
    runtime: {sendMessage: async () => ({ok: false, status: 0})},
    tabs: {query: async () => tabs, sendMessage: async id => { asked.push(id); const a = answers[id]; if (a instanceof Error) throw a; return a; }},
  };
  vm.runInNewContext(fs.readFileSync(new URL('../extension/provider-check.js', import.meta.url), 'utf8'),
    {chrome, performance: {now: () => 0}, URL, document: {getElementById: id => ({providerTestButton: {addEventListener: (t, fn) => { handler = fn; }}, providerTestResults: {replaceChildren: (...rows) => { rendered = rows; }}})[id], createElement: el}});
  return {asked, run: async () => { await handler(); return [rendered[0].dataset.state, rendered[0].children[1].textContent]; }};
}

test('YouTube Music check asks the playing tab first and tells apart a tab that does not answer', async () => {
  const playing = ytmProbe([{id: 1, active: false}, {id: 2, audible: true}], {1: {state: 'nosong'}, 2: {state: 'found'}});
  assert.equal((await playing.run())[0], 'found');
  assert.deepEqual(playing.asked, [2]);
  const idleFirst = ytmProbe([{id: 1}, {id: 2}], {1: {state: 'nosong'}, 2: {state: 'notfound'}});
  assert.equal((await idleFirst.run())[0], 'notfound', 'keeps asking after a tab with no song');
  const orphaned = ytmProbe([{id: 1}], {1: new Error('Receiving end does not exist')});
  assert.deepEqual(await orphaned.run(), ['reload', 'YouTube Musicのページを再読み込みしてください']);
  const noSong = ytmProbe([{id: 1}], {1: {state: 'nosong'}});
  assert.equal((await noSong.run())[0], 'nosong');
});
