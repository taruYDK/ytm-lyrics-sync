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

test('shuffle and repeat show what they did: repeat mode on the button, a pulse and the button colour for shuffle', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /function repeatMode\(\)/);
  assert.match(shell, /\{off: 'リピート：オフ', all: 'リピート：すべて', one: 'リピート：1曲'\}/);
  assert.doesNotMatch(shell, /シャッフル：オン/, 'no banner for shuffle (the button\'s colour shows it)');
  assert.match(shell, /function shuffleOn\(\)/);
  const css = read('apple-shell.css');
  assert.match(shell, /mode === 'one' \? ICONS\.repeatOne : ICONS\.repeat/);
  assert.doesNotMatch(css, /\.ytmls-am-repeat\[data-mode="one"\]::after/);
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

test('leaving the Now Playing page: sidebar items, the now-playing display (again) and Esc close it', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /closePlayerPage\(\);\s*press\(item\.entry/);
  assert.match(shell, /info\.addEventListener\('click', togglePlayerPage\)/);
  assert.match(shell, /if \(event\.key !== 'Escape'\) return;[\s\S]*?closePlayerPage\(\);/);
});

test('曲/動画 switch looks unavailable (darker, no bead) when YouTube Music disables it', () => {
  const src = fs.readFileSync(new URL('../src/content/glass-segment.js', import.meta.url), 'utf8');
  assert.match(src, /function ytmAvDisabled\(toggle, button\)/);
  assert.match(src, /toggle\.classList\.toggle\('ytmls-av-unavailable'/);
  assert.match(read('liquid-glass.css'), /\.ytmls-av-unavailable \.ytmls-av-segment \{[^}]*cursor: not-allowed;/);
});

test('Up Next panel marks exactly one song as playing: the one whose video id is playing', () => {
  const shell = read('apple-shell.js');
  assert.match(shell, /queueThumbs\.findIndex\(info => info\?\.videoId === playingId\)/);
  assert.match(shell, /if \(currentIndex >= 0\) infos\[currentIndex\]\.current = true;/);
});

test('album, playlist, artist and search pages get Apple-style looks only in the Mac-style screen, without resizing', () => {
  const css = read('apple-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of ['ytmusic-responsive-header-renderer', 'ytmusic-immersive-header-renderer', 'ytmusic-card-shelf-renderer', 'yt-spec-button-shape-next--filled', 'ytmusic-playlist-shelf-renderer']) {
    const rules = css.match(new RegExp(`[^{}]*${part}[^{}]*\\{[^}]*\\}`, 'g')) || [];
    assert.ok(rules.length, part);
    for (const rule of rules) {
      for (const selector of rule.split('{')[0].split(/,(?![^()]*\))/)) assert.match(selector.trim(), /^html\.ytmls-am /, `${part} only in the Mac-style screen`);
      assert.doesNotMatch(rule, /(^|[;{\s])(width|height|display|position|margin|padding)\s*:/, `${part} keeps YouTube Music's sizes`);
    }
  }
  // Album and playlist rows: soft stripes, no dividers.
  assert.match(css, /ytmusic-responsive-list-item-renderer:nth-of-type\(even\)/);
  // Now Playing page: lyrics come up sooner in the Mac-style screen.
  const autoOpen = fs.readFileSync(new URL('../src/content/auto-open.js', import.meta.url), 'utf8');
  assert.match(autoOpen, /classList\.contains\('ytmls-am'\) \? AUTO_LYRICS_MAC_DELAY_MS : AUTO_LYRICS_IDLE_DELAY_MS/);
  // Not while the glass bead on the tabs is held.
  assert.match(autoOpen, /querySelector\('\.ytmls-tabs-segment\[data-dragging\]'\)\) \{\s*STATE\.lastUserInteractionAt = now;\s*return;/);
  assert.match(fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8'), /`headers=\$\{/);
});

test('Now Playing page opens out of and closes back into the toolbar, without YouTube Music\'s drop-down', () => {
  const css = read('apple-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const closed = css.match(/html\.ytmls-am\.ytmls-am\.ytmls-am ytmusic-app-layout:not\(\[is-mweb-modernization-enabled\]\):not\(\[player-fullscreened\]\) > ytmusic-player-page\[slot="player-page"\] \{([^}]*)\}/);
  assert.ok(closed, 'closed state');
  assert.match(closed[1], /transform-origin: 50% 0 !important;/, 'shrinks toward the now-playing display at the top');
  assert.match(closed[1], /opacity: 0 !important;[\s\S]*visibility: hidden !important;[\s\S]*pointer-events: none !important;/);
  assert.match(css, /\[player-page-open\] > ytmusic-player-page\[slot="player-page"\] \{\s*transform: none !important;/);
  assert.match(css, /ytmls-depth-animation-disabled ytmusic-app-layout > ytmusic-player-page\[slot="player-page"\],/, 'the animation setting still turns it off');
  assert.match(css, /ytmusic-app-layout\[no-animation\] > ytmusic-player-page/);
});

test('moving artwork background, Up Next history / autoplay, album capsules and playing-row bars are in place', () => {
  const js = read('apple-shell.js'), css = read('apple-shell.css');
  assert.match(js, /function updateAmbient\(\)/);
  assert.match(js, /function paintAmbientShape\(canvas, image/, 'each shape is blurred once per song into a canvas');
  assert.match(css, /\.ytmls-am-ambient-blobs canvas \{[^}]*will-change: transform;[^}]*animation-timing-function: steps\(560\) !important;/, 'only transform moves, in small steps');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.ytmls-am-ambient[^{]*\{[^}]*filter:/, 'no live blur on the moving background');
  assert.match(css, /html:is\(\.ytmls-lyrics-motion-lightweight, \.ytmls-extra-motion-disabled\) \.ytmls-am-ambient-blobs canvas \{ animation: none; \}/);
  assert.match(js, /data-view="history"/);
  assert.match(js, /function autoplayToggle\(\)/);
  assert.match(js, /index < currentIndex/, 'history is the songs before the playing one');
  assert.match(js, /function ensureAlbumActions\(\)/);
  assert.match(css, /html\.ytmls-am \.ytmls-am-native-hidden \{ display: none !important; \}/);
  assert.match(css, /@keyframes ytmls-am-list-bars/);
});

test('lyrics share card: a menu entry, up to four lines, copy and save', () => {
  const src = fs.readFileSync(new URL('../src/content/share-card.js', import.meta.url), 'utf8');
  assert.match(src, /SHARE_MAX_LINES = 4/);
  assert.match(src, /new ClipboardItem\(\{'image\/png': image\}\)/);
  assert.match(src, /image\.crossOrigin = 'anonymous'/, 'only a readable cover is drawn, so the card can always be exported');
  const order = JSON.parse(fs.readFileSync(new URL('../src/content-order.json', import.meta.url), 'utf8'));
  assert.ok(order.indexOf('share-card.js') > order.indexOf('side-lyrics.js'));
  assert.match(fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8'), /openShareCard\(\)/);
});

test('Now Playing page spans the window; the sidebar steps away and its button shows it over the page', () => {
  const js = read('apple-shell.js'), css = read('apple-shell.css');
  assert.match(js, /function fitPlayerPage\(\)/);
  assert.match(js, /attributeFilter: \['player-page-open', 'player-fullscreened'\]/, 'fitted before the page is drawn open');
  assert.match(css, /ytmusic-player-page\[style\*="--ytmls-am-page-shift"\] \{\s*margin-left: calc\(-1 \* var\(--ytmls-am-page-shift, 0px\)\) !important;/);
  assert.match(css, /\.ytmls-am-autohide:not\(\.ytmls-am-side-peek\) \.ytmls-am-sidebar \{\s*transform: translateX/, 'steps away unless shown over the page');
  assert.doesNotMatch(js, /button\('collapse'/, 'no sidebar button: the left edge shows it');
  assert.match(js, /document\.addEventListener\('pointermove', sidePeekPointer, \{passive: true\}\)/, 'the window\'s left edge shows it, by position');
  assert.doesNotMatch(js, /sidebar\.addEventListener\('pointerleave'/, 'no enter / leave flicker');
  assert.doesNotMatch(js, /if \(!open && root\.classList\.contains\('ytmls-am-side-peek'\)\) toggleSidePeek\(false\)/, 'pages without the Now Playing page open do not hide it on every refresh');
  assert.match(css, /html\.ytmls-am\.ytmls-am-side-peek \.ytmls-am-sidebar \{ display: flex; width: 226px; \}/, 'always the wide sidebar when shown over the page');
  assert.match(css, /html\.ytmls-am-compact:not\(\.ytmls-am-drawer-open\):not\(\.ytmls-am-side-peek\) \.ytmls-am-item-label/);
});

test('popovers share the readable glass; library, lyrics and mini player get their Apple touches', () => {
  const lg = read('liquid-glass.css'), css = read('apple-shell.css');
  assert.match(lg, /:root:not\(\[data-ytmls-theme="light"\]\) :is\(#ytmls-panel #ytmls-tools-pane, #ytmls-more > \.ytmls-more-menu, #ytmls-track-offset-popover, #ytmls-reload-notice\) \{/);
  assert.match(lg, /#ytmls-more \[data-icon="share"\]/);
  assert.match(css, /ytmusic-browse-response:has\(ytmusic-chip-cloud-renderer\):not\(:has\(ytmusic-carousel-shelf-renderer\)\) ytmusic-chip-cloud-renderer #chips \{/, 'library chips as one segmented bar');
  assert.match(css, /\.ytmls-line\.ytmls-aside-line \{ font-size: \.74em;/);
  const offset = fs.readFileSync(new URL('../src/content/timing-offset.js', import.meta.url), 'utf8');
  assert.match(offset, /div\.classList\.add\("ytmls-aside-line"\)/);
  const side = fs.readFileSync(new URL('../src/content/side-lyrics.js', import.meta.url), 'utf8');
  assert.match(side, /<div class="bg"><i><\/i><i><\/i><i><\/i><\/div>/, 'moving artwork background in the mini player');
  assert.match(side, /add\('lyrics', '歌詞を隠す'/);
  assert.match(side, /set\('\.remaining'/);
});

test('every page: the sidebar stays out of the way and comes over the page from the button or the left edge', () => {
  const js = read('apple-shell.js'), css = read('apple-shell.css');
  assert.match(css, /html\.ytmls-am\.ytmls-am-autohide:not\(\.ytmls-am-side-peek\) \.ytmls-am-sidebar \{/);
  assert.match(css, /html\.ytmls-am\.ytmls-am-autohide \.ytmls-am-toolbar \{ left: 0; \}/);
  assert.match(js, /options\.autohide && layout\.side >= 160 && !layoutEl\(\)\?\.hasAttribute\('player-page-open'\) && now - lastGuideNarrowAt > 4000/, 'YouTube Music\'s side menu kept narrow, at most every 4 s');
});

test('no banner when the song changes (only when the mini player cannot open)', () => {
  const js = read('apple-shell.js');
  assert.doesNotMatch(js, /lastToastTitle/);
  assert.equal((js.match(/showToast\(/g) || []).length, 2, 'the function and the mini player note');
});

test('settings: moving background, sidebar auto-hide and album buttons can each be switched off', () => {
  const html = read('popup.html'), popup = read('apple-shell-popup.js'), js = read('apple-shell.js');
  for (const [id, key] of [['appleAmbientToggle', 'appleAmbientEnabled'], ['appleSideAutohideToggle', 'appleSideAutohide'], ['appleAlbumButtonsToggle', 'appleAlbumButtons']]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(popup, new RegExp(`bind\\('${id}', '${key}'\\)`));
    assert.match(js, new RegExp(`${key}: true`));
  }
  assert.match(js, /if \(!options\.ambient\) \{ document\.querySelectorAll\('\.ytmls-am-ambient'\)\.forEach\(layer => layer\.remove\(\)\); return; \}/);
  assert.match(js, /root\.classList\.toggle\('ytmls-am-autohide', options\.autohide\)/);
});
