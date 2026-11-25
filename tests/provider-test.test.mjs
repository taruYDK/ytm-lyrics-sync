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
