// ---------- Mac 風：右側の歌詞パネルとミニプレーヤー ----------
// Both read the lyrics already loaded (STATE.lines) and work out the current line themselves, so
// they keep going whether or not YouTube Music's Now Playing page (and its lyrics tab) is open.
// apple-shell.js opens them (toolbar buttons and shortcuts) through globalThis.ytmlsSideLyrics /
// globalThis.ytmlsMiniPlayer.

function liveLyricsIndex() {
 if (!STATE.enabled || !STATE.hasSync || !STATE.lines.length) return -1;
 const id = getAuthoritativeVideoId();
 if (STATE.displayedVideoId && id && STATE.displayedVideoId !== id) return -1;
 const media = getVideoElement();
 const time = getAuthoritativePlaybackTime(media);
 if (!Number.isFinite(time)) return -1;
 const adjusted = Math.max(0, time + timingOffsetSeconds(time, getAuthoritativeDuration(media)));
 return findCurrentLineIndex(adjusted);
}
function liveLyricsCurrent() {
 const id = getAuthoritativeVideoId();
 return Boolean(STATE.lines.length && (!STATE.displayedVideoId || !id || STATE.displayedVideoId === id));
}
function seekLyricsLine(index) {
 if (!liveLyricsCurrent()) return;
 if (listEl?.children[index] && typeof practiceSeek === 'function') { practiceSeek(index); return; }
 const line = STATE.lines[index];
 const id = getAuthoritativeVideoId();
 if (!line || line.time == null || !id) return;
 const duration = getAuthoritativeDuration(getVideoElement());
 requestPlayerSeek(id, Math.max(0, line.time - timingOffsetSeconds(line.time, duration)));
}
function lyricsLineText(index) {
 return String(STATE.lines[index]?.text || '').replace(/\s+/g, ' ').trim();
}
function sideLyricsMessage() {
 if (!STATE.enabled) return '歌詞シンクロはオフです';
 if (STATE.isSearching) return '歌詞を探しています…';
 if (!STATE.lines.length) return '歌詞はありません';
 return '';
}

// ---- right-hand lyrics panel ----
let sideLyricsEl = null;
let sideLyricsSignature = '';
let sideLyricsIndex = -2;
let sideLyricsFrame = 0;
let sideLyricsManualUntil = 0;

function sideLyricsOpen() {
 return Boolean(sideLyricsEl && !sideLyricsEl.hidden);
}
function buildSideLyrics() {
 if (sideLyricsEl) return sideLyricsEl;
 const pane = document.createElement('aside');
 pane.id = 'ytmls-side-lyrics';
 pane.setAttribute('aria-label', '歌詞');
 pane.hidden = true;
 const head = document.createElement('div');
 head.className = 'ytmls-side-head';
 const title = document.createElement('span');
 title.className = 'ytmls-side-title';
 title.textContent = '歌詞';
 const close = document.createElement('button');
 close.type = 'button';
 close.className = 'ytmls-side-close';
 close.title = '歌詞を閉じる';
 close.setAttribute('aria-label', '歌詞を閉じる');
 close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
 close.addEventListener('click', () => toggleSideLyrics(false));
 head.append(title, close);
 const list = document.createElement('div');
 list.className = 'ytmls-side-list';
 const pause = () => { sideLyricsManualUntil = performance.now() + (STATE.manualScrollReturnMs || 3500); };
 list.addEventListener('wheel', pause, {passive: true});
 list.addEventListener('touchmove', pause, {passive: true});
 const message = document.createElement('p');
 message.className = 'ytmls-side-message';
 pane.append(head, message, list);
 pane.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); toggleSideLyrics(false); } });
 document.body.append(pane);
 sideLyricsEl = pane;
 return pane;
}
function renderSideLyrics() {
 const pane = sideLyricsEl;
 if (!pane) return;
 const list = pane.querySelector('.ytmls-side-list');
 const message = sideLyricsMessage();
 const messageEl = pane.querySelector('.ytmls-side-message');
 if (messageEl.textContent !== message) messageEl.textContent = message;
 messageEl.hidden = !message;
 const title = pane.querySelector('.ytmls-side-title');
 const titleText = STATE.lastDisplayedTitle || '歌詞';
 if (title.textContent !== titleText) title.textContent = titleText;
 const signature = [STATE.displayedVideoId, STATE.activeCandidateId, STATE.lines.length, listEl?.children.length || 0,
  typeof practiceExtrasGeneration === 'undefined' ? 0 : practiceExtrasGeneration].join(':');
 if (signature !== sideLyricsSignature) {
  sideLyricsSignature = signature;
  sideLyricsIndex = -2;
  list.replaceChildren();
  if (!message) {
   for (let i = 0; i < STATE.lines.length; i++) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ytmls-side-line';
    // Same content as the lyrics panel (readings included) when it is there, else the plain text.
    const source = listEl?.children[i];
    if (source && listEl.children.length === STATE.lines.length) row.append(...[...source.childNodes].filter(node => !node.classList?.contains?.('ytmls-extra')).map(node => node.cloneNode(true)));
    if (!row.childNodes.length) row.textContent = STATE.lines[i].text || '♪';
    row.addEventListener('click', () => { sideLyricsManualUntil = 0; sideLyricsIndex = -2; seekLyricsLine(i); });
    list.append(row);
   }
  }
  pane.dataset.synced = STATE.hasSync ? 'true' : 'false';
 }
}
function followSideLyrics(...args) {
 const started = typeof performance === 'object' ? performance.now() : 0;
 try { return followSideLyricsMeasured(...args); } finally { if (started) globalThis.ytmlsPerfAdd?.('right lyrics panel frames', performance.now() - started); }
}
function followSideLyricsMeasured() {
 sideLyricsFrame = 0;
 if (!sideLyricsOpen()) return;
 if (!document.documentElement.classList.contains('ytmls-am')) { toggleSideLyrics(false); return; }
 renderSideLyrics();
 const list = sideLyricsEl.querySelector('.ytmls-side-list');
 const index = liveLyricsIndex();
 if (index !== sideLyricsIndex) {
  const first = sideLyricsIndex === -2;
  sideLyricsIndex = index;
  [...list.children].forEach((row, i) => {
   const distance = index >= 0 ? Math.abs(i - index) : 999;
   row.classList.toggle('is-current', i === index);
   row.classList.toggle('is-near', distance === 1);
   row.classList.toggle('is-past', index >= 0 && i < index);
  });
  const row = list.children[index];
  if (row && performance.now() >= sideLyricsManualUntil) {
   const top = row.offsetTop - list.clientHeight * 0.32;
   const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('ytmls-lyrics-motion-lightweight');
   list.scrollTo({top: Math.max(0, top), behavior: first || reduce ? 'instant' : 'smooth'});
  }
 } else if (index >= 0 && sideLyricsManualUntil && performance.now() >= sideLyricsManualUntil) {
  sideLyricsManualUntil = 0;
  sideLyricsIndex = -3; // scroll back to the current line on the next frame
 }
 sideLyricsFrame = requestAnimationFrame(followSideLyrics);
}
function toggleSideLyrics(force) {
 const pane = buildSideLyrics();
 const open = typeof force === 'boolean' ? force : pane.hidden;
 pane.hidden = !open;
 document.documentElement.classList.toggle('ytmls-side-lyrics-open', open);
 if (open) {
  sideLyricsSignature = '';
  sideLyricsManualUntil = 0;
  if (!sideLyricsFrame) sideLyricsFrame = requestAnimationFrame(followSideLyrics);
 } else {
  cancelAnimationFrame(sideLyricsFrame);
  sideLyricsFrame = 0;
 }
 return open;
}

// ---- mini player (a small always-on-top window: Document Picture-in-Picture) ----
let miniPlayerWindow = null;
const MINI_PLAYER_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #1c1c1f; color: #fff;
 font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; user-select: none; }
/* Moving artwork background, like the big screens: three soft shapes of the cover drifting slowly
   (a small window, so the live blur is cheap). */
.bg { position: fixed; inset: -30px; overflow: hidden; filter: blur(26px) saturate(170%) brightness(.6); background: #1c1c1f; }
.bg i { position: absolute; width: 90%; aspect-ratio: 1; border-radius: 50%; background: var(--art) center / cover no-repeat; animation: drift 40s steps(400) infinite alternate; }
.bg i:nth-child(1) { left: -20%; top: -40%; }
.bg i:nth-child(2) { right: -25%; top: -10%; background-position: 80% 20%; animation-duration: 52s; animation-direction: alternate-reverse; }
.bg i:nth-child(3) { left: 20%; bottom: -60%; background-position: 20% 80%; animation-duration: 46s; }
@keyframes drift { from { transform: translate(0, 0) rotate(0deg) scale(1); } to { transform: translate(18%, 14%) rotate(150deg) scale(1.2); } }
@media (prefers-reduced-motion: reduce) { .bg i { animation: none; } }
.bg::after { content: ""; position: absolute; inset: 0; background: rgb(0 0 0 / .18); }
.app { position: relative; height: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; gap: 10px 14px; padding: 14px; }
.art { grid-row: 1 / 3; height: 100%; max-height: calc(100vh - 28px); aspect-ratio: 1; border-radius: 10px; object-fit: cover; background: #ffffff14; box-shadow: 0 10px 26px #0007, inset 0 0 0 1px #ffffff22; }
.info { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.meta { min-width: 0; }
.title, .artist, .line, .next { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title { font-size: 13px; font-weight: 650; }
.artist { font-size: 12px; color: #ffffffa0; }
.line { font-size: clamp(14px, 4.6vw, 21px); font-weight: 800; line-height: 1.25; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; transition: opacity .25s; }
.next { font-size: clamp(12px, 3.6vw, 16px); font-weight: 700; color: #ffffff70; }
.line:empty, .next:empty { display: none; }
/* Buttons on one line (lyrics at the right end), the progress with its times on the next. */
.bottom { display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; min-width: 0; }
.controls-end { margin-left: auto; }
.seek { flex: 1 0 100%; display: flex; align-items: center; gap: 8px; min-width: 0; }
.controls { display: flex; align-items: center; gap: 2px; }
button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #fffe; cursor: pointer; }
button:hover { background: #ffffff1c; }
button:active { transform: scale(.9); }
button svg { width: 20px; height: 20px; display: block; }
button.play svg { width: 26px; height: 26px; }
.progress { flex: 1; height: 4px; border-radius: 999px; background: #ffffff2e; overflow: hidden; cursor: pointer; transition: height .15s; }
.progress:hover { height: 6px; }
.time { font-size: 10.5px; font-variant-numeric: tabular-nums; color: #ffffff90; min-width: 32px; text-align: center; }
.seek .elapsed { text-align: left; } .seek .remaining { text-align: right; }
.controls-end { display: flex; align-items: center; gap: 2px; }
button.lyrics[aria-pressed="true"] { color: #fff; background: #ffffff26; }
button.lyrics svg { width: 18px; height: 18px; }
/* Lyrics off: the title and artist take the space, larger. */
body:not(.show-lyrics) .line, body:not(.show-lyrics) .next { display: none; }
body:not(.show-lyrics) .title { font-size: clamp(14px, 5vw, 20px); font-weight: 750; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
body:not(.show-lyrics) .artist { font-size: clamp(12px, 3.6vw, 15px); margin-top: 3px; }
.fill { height: 100%; background: #ffffffd0; transform-origin: left; transform: scaleX(var(--p, 0)); }
@media (max-height: 195px) { .next { display: none; } }
@media (max-height: 130px) { .time { display: none; } }
@media (max-width: 300px) { .art { display: none; } .app { grid-template-columns: minmax(0, 1fr); } }
`;
function miniPlayerSupported() {
 return typeof window.documentPictureInPicture?.requestWindow === 'function';
}
function miniPlayerIcon(name) {
 const icons = globalThis.ytmlsAppleControls?.icons;
 if (icons?.[name]) return icons[name];
 return typeof fullscreenNowIcon === 'function' ? fullscreenNowIcon(name) : '';
}
async function toggleMiniPlayer(force) {
 const open = typeof force === 'boolean' ? force : !miniPlayerWindow;
 if (!open) { miniPlayerWindow?.close(); miniPlayerWindow = null; return false; }
 if (miniPlayerWindow) { miniPlayerWindow.focus(); return true; }
 if (!miniPlayerSupported()) return false;
 let win;
 try { win = await window.documentPictureInPicture.requestWindow({width: 420, height: 210}); } catch (_) { return false; }
 miniPlayerWindow = win;
 const doc = win.document;
 doc.title = 'ミニプレーヤー';
 const style = doc.createElement('style');
 style.textContent = MINI_PLAYER_CSS;
 doc.head.append(style);
 doc.body.innerHTML = '<div class="bg"><i></i><i></i><i></i></div><div class="app"><img class="art" alt=""><div class="info"><div class="meta"><div class="title"></div><div class="artist"></div></div><div class="line"></div><div class="next"></div></div><div class="bottom"><div class="controls"></div><div class="controls-end"></div><div class="seek"><span class="time elapsed"></span><div class="progress"><div class="fill"></div></div><span class="time remaining"></span></div></div></div>';
 doc.body.classList.add('show-lyrics');
 const controls = doc.querySelector('.controls');
 const add = (name, label, fn) => {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = name;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = miniPlayerIcon(name);
  button.addEventListener('click', fn);
  (name === 'lyrics' ? doc.querySelector('.controls-end') : controls).append(button);
  return button;
 };
 const transport = name => () => {
  const apple = globalThis.ytmlsAppleControls;
  if (apple) apple.transport[name]();
  else if (name === 'play') { const media = getVideoElement(); if (media) media.paused ? media.play() : media.pause(); }
 };
 add('prev', '前へ', transport('prev'));
 const play = add('play', '再生', transport('play'));
 add('next', '次へ', transport('next'));
 // Lyrics on / off, like the Mac mini player's lyrics button.
 const lyricsButton = add('lyrics', '歌詞を隠す', () => {
  const on = !doc.body.classList.contains('show-lyrics');
  doc.body.classList.toggle('show-lyrics', on);
  lyricsButton.setAttribute('aria-pressed', String(on));
  lyricsButton.title = on ? '歌詞を隠す' : '歌詞を表示';
  lyricsButton.setAttribute('aria-label', lyricsButton.title);
 });
 lyricsButton.setAttribute('aria-pressed', 'true');
 doc.querySelector('.progress').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  const media = getVideoElement(), duration = getAuthoritativeDuration(media), id = getAuthoritativeVideoId();
  if (id && Number.isFinite(duration) && duration > 0) requestPlayerSeek(id, Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration);
 });
 win.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); transport('play')(); }
 });
 win.addEventListener('pagehide', () => { if (miniPlayerWindow === win) miniPlayerWindow = null; });
 let shown = {};
 const set = (selector, value, prop = 'textContent') => {
  if (shown[selector] === value) return;
  shown[selector] = value;
  const el = doc.querySelector(selector);
  if (prop === 'src') { if (value) el.src = value; else el.removeAttribute('src'); }
  else if (prop === 'bg') el.style.setProperty('--art', value ? `url("${value.replace(/"/g, '%22')}")` : 'none');
  else el.textContent = value;
 };
 const frame = () => {
  if (miniPlayerWindow !== win || win.closed) return;
  const image = document.querySelector('ytmusic-player-bar .thumbnail-image-wrapper img,ytmusic-player-bar img.image,ytmusic-player #song-image img');
  const art = image?.currentSrc || image?.src || '';
  set('.art', art, 'src');
  set('.bg', art, 'bg');
  set('.title', STATE.lastDisplayedTitle || document.querySelector('ytmusic-player-bar .title')?.textContent.trim() || '');
  set('.artist', STATE.lastDisplayedArtist || '');
  const index = liveLyricsIndex();
  const current = liveLyricsCurrent();
  set('.line', current ? (index >= 0 ? lyricsLineText(index) || '♪' : (STATE.hasSync ? '♪' : '')) : '');
  set('.next', current && index + 1 < STATE.lines.length ? lyricsLineText(index + 1) : '');
  const media = getVideoElement();
  const duration = getAuthoritativeDuration(media), time = getAuthoritativePlaybackTime(media);
  doc.querySelector('.fill').style.setProperty('--p', String(Number.isFinite(duration) && duration > 0 && Number.isFinite(time) ? Math.min(1, time / duration) : 0));
  const clock = seconds => { const t = Math.max(0, Math.floor(seconds)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const known = Number.isFinite(duration) && duration > 0 && Number.isFinite(time);
  set('.elapsed', known ? clock(time) : '');
  set('.remaining', known ? `-${clock(duration - time)}` : '');
  const playing = Boolean(media && !media.paused);
  if (shown.playing !== playing) {
   shown.playing = playing;
   play.innerHTML = miniPlayerIcon(playing ? 'pause' : 'play');
   play.title = playing ? '一時停止' : '再生';
   play.setAttribute('aria-label', play.title);
  }
  win.requestAnimationFrame(frame);
 };
 win.requestAnimationFrame(frame);
 return true;
}

globalThis.ytmlsSideLyrics = Object.freeze({toggle: toggleSideLyrics, isOpen: sideLyricsOpen});
globalThis.ytmlsMiniPlayer = Object.freeze({toggle: toggleMiniPlayer, isOpen: () => Boolean(miniPlayerWindow), supported: miniPlayerSupported});
