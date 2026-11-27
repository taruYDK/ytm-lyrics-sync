import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');

test('Mac Music-style screen loads on YouTube Music, before the glass styles', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const entry = manifest.content_scripts.find(item => item.css?.includes('apple-shell.css'));
  assert.ok(entry, 'apple-shell.css is loaded');
  assert.equal(entry.css.at(-1), 'liquid-glass.css');
  assert.ok(entry.js.includes('apple-shell.js'));
});

test('YouTube Music chrome keeps its space and is hidden only while the screen is on', () => {
  const css = read('apple-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hide = css.match(/([^{}]+)\{\s*visibility:\s*hidden !important;\s*\}/);
  assert.ok(hide, 'hidden with visibility (layout unchanged), not display:none');
  for (const part of ['ytmusic-nav-bar', 'tp-yt-app-drawer#guide', 'ytmusic-player-bar']) assert.match(hide[1], new RegExp(`html\\.ytmls-am ${part.replace('#', '\\#')}`));
  assert.doesNotMatch(css.replace(/[^{}]*ytmls-(?:tab|comments)-hidden[^{}]*\{[^}]*\}/g, ''), /ytmusic-[a-z-]+[^{}]*\{[^}]*display:\s*none/);
  assert.match(css, /#ytmls-am \{ display: none; \}/);
});

function runShell({nav = null, bar = null, stored = {}} = {}) {
  const classes = new Set();
  const props = {};
  const root = {
    classList: {add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c)},
    style: {setProperty: (k, v) => { props[k] = v; }},
  };
  const document = {
    readyState: 'complete', documentElement: root, hidden: false, fullscreenElement: null,
    querySelector: selector => selector === 'ytmusic-nav-bar' ? nav : selector === 'ytmusic-player-bar' ? bar : null,
    querySelectorAll: () => [], addEventListener() {},
    createElement: () => { throw new Error('built'); },
  };
  const chrome = {storage: {
    sync: {get: (d, cb) => cb({enabled: true})},
    local: {get: (d, cb) => cb({...d, ...stored})},
    onChanged: {addListener() {}},
  }};
  let built = false;
  try {
    vm.runInNewContext(read('apple-shell.js'), {document, chrome, performance: {now: () => 0}, navigator: {platform: 'Win32'}, location: {pathname: '/'}, setInterval() {}, setTimeout() {}, requestAnimationFrame: fn => fn(), addEventListener() {}, window: {addEventListener() {}}});
  } catch (error) { if (error.message === 'built') built = true; else throw error; }
  return {classes, props, built};
}

test('without YouTube Music\'s top bar or player bar the page is left alone', () => {
  const result = runShell();
  assert.equal(result.classes.has('ytmls-am'), false);
  assert.equal(result.built, false);
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  const onlyNav = runShell({nav: {getBoundingClientRect: () => rect}});
  assert.equal(onlyNav.classes.has('ytmls-am'), false);
});

test('switched off in settings: nothing is built', () => {
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  const result = runShell({nav: {getBoundingClientRect: () => rect}, bar: {}, stored: {appleShellEnabled: false}});
  assert.equal(result.built, false);
  assert.equal(result.classes.has('ytmls-am'), false);
});

test('settings page has the switch, saved as appleShellEnabled', () => {
  const html = read('popup.html');
  assert.match(html, /id="appleShellToggle"/);
  assert.match(html, /<script src="apple-shell-popup.js"><\/script>/);
  const writes = [];
  const toggle = {checked: false, disabled: false, addEventListener(name, fn) { this[name] = fn; }};
  const chrome = {runtime: {}, storage: {local: {get: (d, cb) => cb(d), set: (v, cb) => { writes.push(v); cb(); }}, onChanged: {addListener() {}}}};
  vm.runInNewContext(read('apple-shell-popup.js'), {chrome, document: {getElementById: id => id === 'appleShellToggle' ? toggle : null}});
  assert.equal(toggle.checked, true, 'on by default');
  toggle.checked = false; toggle.change();
  assert.equal(JSON.stringify(writes), JSON.stringify([{appleShellEnabled: false}]));
});

test('with YouTube Music\'s top bar and player bar present, the screen is built', () => {
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  assert.equal(runShell({nav: {getBoundingClientRect: () => rect}, bar: {}}).built, true);
});

test('the lyrics timing buttons move into the menu while YouTube Music\'s player bar is hidden', () => {
  const src = fs.readFileSync(new URL('../src/content/timing-offset.js', import.meta.url), 'utf8');
  assert.match(src, /classList\.contains\('ytmls-am'\)/);
});

function classList() {
  const set = new Set();
  return {set, add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, on) => on ? set.add(c) : set.delete(c)};
}
function runComments({tabs = [], panels = [], stored = {}} = {}) {
  let listener;
  const page = {contains: () => true};
  const document = {
    hidden: false,
    querySelectorAll: selector => selector.includes('tp-yt-paper-tab') ? tabs : panels.filter(el => el.classList.contains('ytmls-comments-hidden')),
    querySelector: selector => selector === 'ytmusic-player-page' ? page : null,
    createTreeWalker: (root, what, filter) => {
      const list = panels.filter(el => filter.acceptNode(el) === 1);
      let i = 0;
      return {nextNode: () => list[i++] || null};
    },
    addEventListener() {},
  };
  const chrome = {storage: {local: {get: (d, cb) => cb({...d, ...stored})}, onChanged: {addListener: fn => { listener = fn; }}}};
  vm.runInNewContext(read('comments-toggle.js'), {document, chrome, setInterval() {}, NodeFilter: {SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3}});
  return change => listener(change, 'local');
}
const tab = (text, selected = false) => ({textContent: text, classList: classList(), clicked: 0, getAttribute: name => name === 'aria-selected' ? String(selected) : null, hasAttribute: () => false, click() { this.clicked++; }});

test('comments: the comments tab is hidden by default and the lyrics tab is opened instead', () => {
  const tabs = [tab('次のコンテンツ'), tab('歌詞'), tab(' コメント 1.2万 ', true), tab('関連')];
  const change = runComments({tabs});
  assert.equal(tabs[2].classList.contains('ytmls-tab-hidden'), true);
  assert.equal(tabs.filter(t => t.classList.contains('ytmls-tab-hidden')).length, 1);
  assert.equal(tabs[1].clicked, 1);
  change({hideYtmComments: {newValue: false}});
  assert.equal(tabs[2].classList.contains('ytmls-tab-hidden'), false);
});

test('comments: a comments panel (tag or id says comment) is hidden, outermost only; switch shows it again', () => {
  const make = (localName, id = '', parent = null) => ({localName, id, classList: classList(), parentElement: parent ? {closest: () => parent.classList.contains('ytmls-comments-hidden') ? parent : null} : null});
  const outer = make('ytmusic-comments-section-renderer');
  const inner = make('div', 'comment-list', outer);
  const other = make('div', 'related');
  const change = runComments({panels: [outer, inner, other]});
  assert.equal(outer.classList.contains('ytmls-comments-hidden'), true);
  assert.equal(inner.classList.contains('ytmls-comments-hidden'), false);
  assert.equal(other.classList.contains('ytmls-comments-hidden'), false);
  change({hideYtmComments: {newValue: false}});
  assert.equal(outer.classList.contains('ytmls-comments-hidden'), false);
});

test('comments: the setting is on the settings page and loads on YouTube Music', () => {
  assert.match(read('popup.html'), /id="ytmCommentsToggle"/);
  assert.match(read('apple-shell-popup.js'), /bind\('ytmCommentsToggle', 'hideYtmComments', true\)/);
  assert.ok(JSON.parse(read('manifest.json')).content_scripts.some(item => item.js?.includes('comments-toggle.js')));
  assert.match(fs.readFileSync(new URL('../src/content/glass-segment.js', import.meta.url), 'utf8'), /!el\.classList\.contains\('ytmls-tab-hidden'\)/);
});

test('volume goes through the player itself (bridge set-volume / toggle-mute), snapshots carry it', () => {
  const bridge = read('player-bridge.js');
  assert.match(bridge, /message\.type === 'set-volume' \|\| message\.type === 'toggle-mute'/);
  assert.match(bridge, /player\.setVolume\(value\)/);
  assert.match(bridge, /volume,\s*\n\s*muted,/);
  const shell = read('apple-shell.js');
  assert.match(shell, /bridge\.send\(\{type: 'set-volume', payload: \{volume\}\}\)/);
  assert.match(shell, /globalThis\.ytmlsAppleControls = Object\.freeze/);
});

test('the favourite star follows YouTube Music\'s like state', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /getAttribute\('like-status'\) === 'LIKE'/);
  assert.match(shell, /button\('star', 'お気に入り（高評価）'/);
});

test('fullscreen lyrics use the Mac Now Playing layout (artwork, position, buttons and volume on the left)', () => {
  const order = JSON.parse(fs.readFileSync(new URL('../src/content-order.json', import.meta.url), 'utf8'));
  assert.ok(order.indexOf('fullscreen-now.js') > order.indexOf('practice.js'));
  const practice = fs.readFileSync(new URL('../src/content/practice.js', import.meta.url), 'utf8');
  assert.match(practice, /if\(typeof buildFullscreenNowPlaying==='function'\)buildFullscreenNowPlaying\(box\);/);
  assert.match(practice, /cancelAnimationFrame\(box\.nowFrame\|\|0\)/);
  const now = fs.readFileSync(new URL('../src/content/fullscreen-now.js', import.meta.url), 'utf8');
  for (const part of ['ytmls-full-now', 'ytmls-full-progress', 'ytmls-full-transport', "createVolumeControl?.('ytmls-full-volume')", 'requestPlayerSeek(id']) assert.ok(now.includes(part), part);
  const css = read('apple-shell.css');
  assert.match(css, /#ytmls-fullscreen\.ytmls-full-mac \{[^}]*display: grid;/);
});

test('lyrics panel on the right and mini player follow the lyrics on their own', () => {
  const order = JSON.parse(fs.readFileSync(new URL('../src/content-order.json', import.meta.url), 'utf8'));
  assert.ok(order.includes('side-lyrics.js') && order.indexOf('side-lyrics.js') < order.indexOf('main.js'));
  const src = fs.readFileSync(new URL('../src/content/side-lyrics.js', import.meta.url), 'utf8');
  assert.match(src, /findCurrentLineIndex\(adjusted\)/, 'current line worked out from the playback time and timing offset');
  assert.match(src, /documentPictureInPicture\.requestWindow/);
  assert.match(src, /win\.requestAnimationFrame\(frame\)/, 'the mini player animates in its own window (keeps going while YouTube Music is hidden)');
  assert.match(src, /globalThis\.ytmlsSideLyrics = Object\.freeze/);
  assert.match(src, /globalThis\.ytmlsMiniPlayer = Object\.freeze/);
  const shell = read('apple-shell.js');
  assert.match(shell, /button\('lyrics', '歌詞', 'lyrics', toggleLyricsView\)/);
  assert.match(shell, /button\('miniplayer', 'ミニプレーヤー', 'miniplayer', toggleMiniPlayer\)/);
});

test('Mac-style shortcuts: Ctrl (⌘ on Mac) with arrows, F, Shift+L and Shift+P; arrows stay with text fields', () => {
  const shell = read('apple-shell.js');
  for (const key of ["e.key === 'ArrowRight'", "e.key === 'ArrowLeft'", "e.key === 'ArrowUp'", "e.key === 'ArrowDown'", "e.code === 'KeyF'", "e.shiftKey && e.code === 'KeyL'", "e.shiftKey && e.code === 'KeyP'"]) assert.ok(shell.includes(key), key);
  assert.match(shell, /if \(!shortcut\.text && editableTarget\(event\)\) return;/);
  assert.match(shell, /isMac \? event\.metaKey && !event\.ctrlKey : event\.ctrlKey && !event\.metaKey/);
});

test('toolbar playback buttons: nothing of YouTube Music\'s hidden chrome can take their clicks; play goes through the player', () => {
  const css = read('apple-shell.css');
  assert.match(css, /html\.ytmls-am ytmusic-nav-bar \*,[\s\S]*?\{\s*visibility: hidden !important;/);
  assert.match(css, /html\.ytmls-am ytmusic-player-bar \* \{\s*pointer-events: none !important;/);
  const shell = read('apple-shell.js');
  assert.match(shell, /bridge\.send\(\{type: 'toggle-playback', payload: \{videoId: lastSnapshot\.videoId\}\}\)/);
  assert.match(shell, /new CustomEvent\('tap'/, 'falls back to the button\'s tap event when the click did nothing');
  assert.match(fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8'), /`Mac toolbar: \$\{macToolbarDiagnostics\(\)\}`/);
});

test('shuffle and repeat show what they did: repeat mode on the button, a pulse and a note for shuffle', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /function repeatMode\(\)/);
  assert.match(shell, /\{off: 'リピート：オフ', all: 'リピート：すべて', one: 'リピート：1曲'\}/);
  assert.match(shell, /showToast\(wasOn \? 'シャッフル：オフ' : 'シャッフル：オン'/);
  assert.match(shell, /function shuffleOn\(\)/);
  const css = read('apple-shell.css');
  assert.match(css, /\.ytmls-am-repeat\[data-mode="one"\]::after \{\s*content: "1";/);
  assert.match(css, /\.ytmls-am-btn\.is-flash \{ animation: ytmls-am-flash/);
});

test('sidebar switch (wide / icons) presses YouTube Music\'s hidden ≡ button', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /q\('ytmusic-nav-bar #guide-button'\)/);
  assert.match(shell, /sideToggle\.addEventListener\('click', \(\) => \{\s*press\(guideButton\(\)\);/);
  assert.match(read('liquid-glass.css'), /\.ytmls-av-on \{ color: #fff !important; \}/);
});

test('Up Next panel reads YouTube Music\'s queue and plays an item by pressing it; it and the lyrics panel take turns', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /querySelectorAll\('ytmusic-player-queue-item'\)/);
  assert.match(shell, /bridge\.send\(\{type: 'queue-info'\}\)/, 'pictures asked from the player (the hidden queue does not load them)');
  assert.match(read('player-bridge.js'), /message\.type === 'queue-info'/);
  assert.match(read('player-bridge.js'), /querySelectorAll\('ytmusic-player-queue-item'\)/);
  assert.match(shell, /button\('queue', '次に再生', 'queue', toggleQueueView\)/);
  assert.match(shell, /globalThis\.ytmlsSideLyrics\?\.toggle\(false\);/);
  assert.match(shell, /if \(side\.toggle\(\)\) toggleQueuePanel\(false\);/);
  assert.match(shell, /e\.shiftKey && e\.code === 'KeyU'/);
});

test('home shelves and song menus get Apple-style looks only in the Mac-style screen, without resizing YouTube Music\'s parts', () => {
  const css = read('apple-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of ['ytmusic-carousel-shelf-basic-header-renderer', 'ytmusic-two-row-item-renderer', 'ytmusic-chip-cloud-chip-renderer', 'ytmusic-menu-popup-renderer']) {
    const rules = css.match(new RegExp(`[^{}]*${part}[^{}]*\\{[^}]*\\}`, 'g')) || [];
    assert.ok(rules.length, part);
    for (const rule of rules) {
      assert.match(rule.split('{')[0], /html(\.ytmls-lyrics-motion-lightweight)?\.ytmls-am /, `${part} only in the Mac-style screen`);
      assert.doesNotMatch(rule, /(^|[;{\s])(width|height|display|position|margin)\s*:/, `${part} keeps YouTube Music's sizes`);
    }
  }
  assert.match(fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8'), /`Mac pages: \$\{macPagesDiagnostics\(\)\}`/);
});

test('song artwork: the play button shows only under the pointer (or while that song plays)', () => {
  const css = read('apple-shell.css');
  assert.match(css, /ytmusic-play-button-renderer:not\(\[play-button-state="playing"\]\)[^{]*\{\s*opacity: 0 !important;/);
  assert.match(css, /:is\(:hover, :focus-within\) ytmusic-item-thumbnail-overlay-renderer ytmusic-play-button-renderer[^{]*\{\s*opacity: 1 !important;/);
});
