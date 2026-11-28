// Glass segmented control (Small / Medium / Large): a glass bead marks the chosen button.
// Pressing lifts it at once (like iOS): it becomes a clear lens and goes under the finger. Slide
// to move it: it follows the pointer on a spring,
// stretches with its speed and magnifies the label under it. It never leaves the track: pulled
// past an end it squashes against the wall, and it bounces off the walls inside the track.
// A short tap still works as a normal button.

// Rubber band past the ends: moves less and less the further it is pulled (at most `limit`).
function glassSegmentRubber(over, limit) {
 if (!over || limit <= 0) return 0;
 return Math.sign(over) * limit * (1 - 1 / (Math.abs(over) / limit + 1));
}

// What the last drag did, for 診断情報 (to find out why the drop does not show on a device).
const glassLensReport = {lastDrag: 'none', lastEnd: 'none'};
function glassLensDiagnostics() {
 const root = document.documentElement;
 let supports = false, reduced = false;
 try { supports = CSS.supports('backdrop-filter', 'url(#ytmls-lg-lens) blur(1px)'); } catch (_) {}
 try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
 return `lensClass=${root.classList.contains('ytmls-lg-lens')} supports=${supports} filters=${Boolean(document.getElementById('ytmls-lg-filters'))}` +
  ` lightweight=${root.classList.contains('ytmls-lyrics-motion-lightweight')} reducedMotion=${reduced} lastDrag=${glassLensReport.lastDrag} lastEnd=${glassLensReport.lastEnd}`;
}

function glassSegmentMotion() {
 return typeof playerFeedbackEnabled !== 'function' || playerFeedbackEnabled();
}

// opts (all optional) let it run on controls that are not buttons, such as YouTube Music's tabs:
// items() lists the choices, isSelected / isDisabled read them, activate picks one, watch names the
// attributes that change when the choice changes, settleMs waits for a page that selects later, and
// enabled() can switch the whole behavior off.
function attachGlassSegment(group, opts = {}) {
 if (!group || group.glassSegment) return group?.glassSegment;
 const isSelected = opts.isSelected || (item => item.getAttribute('aria-pressed') === 'true');
 const isDisabled = opts.isDisabled || (item => Boolean(item.disabled));
 const activate = opts.activate || (item => item.click());
 const enabled = opts.enabled || (() => true);
 // canPress(): may a press start now (YouTube Music's tabs stay in the page, invisible, while the
 // Now Playing page is closed; a press there must not lift a drop over the home page).
 const canPress = opts.canPress || (() => true);
 const settleMs = opts.settleMs || 0;
 const thumb = document.createElement('span');
 thumb.className = 'ytmls-seg-thumb';
 thumb.setAttribute('aria-hidden', 'true');
 group.prepend(thumb);
 group.classList.add('ytmls-glass-segment');

 const buttons = opts.items || (() => [...group.querySelectorAll(':scope > button')]);
 const pressed = () => buttons().find(isSelected);
 // The choice an event happened on (its target may be a label inside it).
 const itemOf = node => buttons().find(item => item === node || item.contains?.(node)) || null;
 // Layout is measured once when a drag starts and reused for every frame: reading positions right
 // after writing styles would make the browser lay out the (large) page again on each frame.
 let layout = null;
 function measure() {
  const list = buttons(), rect = group.getBoundingClientRect();
  layout = {left: rect.left, top: rect.top, height: group.offsetHeight, list, slots: list.map(button => ({x: button.offsetLeft, w: button.offsetWidth}))};
  return layout;
 }
 const slot = button => {
  const index = layout ? layout.list.indexOf(button) : -1;
  return index >= 0 ? layout.slots[index] : {x: button.offsetLeft, w: button.offsetWidth};
 };
 const groupRect = () => layout || group.getBoundingClientRect();
 const groupHeight = () => layout ? layout.height : group.offsetHeight;
 // Spring state: position and width follow their targets; a smoothed velocity drives the stretch.
 const state = {x: 0, w: 0, vx: 0, vw: 0, vs: 0, tx: 0, tw: 0, frame: 0, last: 0, placed: false, dragging: false, grab: 0, squash: 0, sq: 0, vsq: 0,
  // How lifted the drop is: 0 = the size of the bead, 1 = lifted. One spring carries it up on press
  // (a little past, a pop) and down on release (a little under: a short squash as it lands).
  lift: 0, vlift: 0, liftTarget: 0};
 let drawnWidth = -1, lensSize = '';

 // ---------- The drop: a real lens while dragging ----------
 // Inside the glass menu a backdrop filter would only see the menu itself, so while dragging a
 // clear drop is shown above the page (fixed, at the bead's place) and bends everything under it:
 // the labels, the track and the menu glass, with colors split at its rim like the iOS tab bar.
 let lens = null;
 const lensAllowed = () => Boolean(document.documentElement?.classList?.contains('ytmls-lg-lens')) &&
  !document.documentElement.classList.contains('ytmls-lyrics-motion-lightweight') &&
  typeof group.getBoundingClientRect === 'function' && Boolean(document.documentElement);
 // The drop covers the bead exactly as it is drawn: same anchor at a wall (it squashes against the
 // wall like the bead, instead of shrinking toward its own middle and leaving the wall).
 function placeLens(sx = 1, sy = 1, side = 'center') {
  if (!lens) return;
  if (!canPress()) { hideLens(); return; }
  const rect = groupRect(), track = Math.max(0, groupHeight() - 6);
  const {min, max} = bounds();
  const trackLeft = rect.left + min, trackRight = rect.left + max + state.w;
  const drawn = state.w * sx, lift = state.lift;
  // Lifted it is a little bigger than the bead; landing (lift below 0) it is briefly wider and
  // flatter, then settles to exactly the bead. Never past the track's ends.
  let wide = 1 + .05 * lift, tall = 1 + .32 * lift;
  if (lift < 0) { wide = 1 - lift * .34; tall = 1 + lift * .26; }
  const width = Math.min(trackRight - trackLeft, drawn * wide), height = track * tall * sy;
  lens.style.setProperty('--lift', Math.max(0, Math.min(1, lift)).toFixed(3));
  let left;
  if (side === 'left') left = rect.left + state.x;
  else if (side === 'right') left = rect.left + state.x + state.w - width;
  else left = rect.left + state.x + state.w / 2 - width / 2;
  left = Math.max(trackLeft, Math.min(trackRight - width, left));
  // Moved with the translate property (no layout); resized only when the size really changes.
  lens.style.translate = `${left.toFixed(1)}px ${(rect.top + groupHeight() / 2 - height / 2).toFixed(1)}px`;
  const size = `${width.toFixed(1)}|${height.toFixed(1)}`;
  if (size !== lensSize) { lensSize = size; lens.style.width = `${width.toFixed(1)}px`; lens.style.height = `${height.toFixed(1)}px`; }
 }
 function showLens() {
  const kind = press?.type || 'unknown';
  if (lens) return;
  if (!lensAllowed()) { glassLensReport.lastDrag = `${kind}: no drop (not allowed here)`; return; }
  lens = document.createElement('div');
  lens.className = 'ytmls-seg-lens';
  lens.setAttribute('aria-hidden', 'true');
  lensSize = '';
  // On the root, not in <body>: a transform or filter on the page's body would move or clip it.
  document.documentElement.append(lens);
  group.dataset.lens = 'true';
  placeLens();
  const shown = lens;
  glassLensReport.lastDrag = `${kind}: drop created`;
  setTimeout(() => {
   if (!shown.isConnected) return;
   const style = getComputedStyle(shown), rect = shown.getBoundingClientRect();
   glassLensReport.lastDrag = `${kind}: drop ${Math.round(rect.width)}x${Math.round(rect.height)} at ${Math.round(rect.left)},${Math.round(rect.top)}` +
    ` display=${style.display} opacity=${style.opacity} backdrop=${style.backdropFilter || style.webkitBackdropFilter || 'none'}`;
  }, 150);
 }
 function hideLens() {
  if (!lens) return;
  const leaving = lens;
  lens = null;
  delete group.dataset.lens;
  leaving.classList.add('ytmls-seg-lens-out');
  setTimeout(() => leaving.remove(), 200);
 }

 // The bead's travel inside the track for its current width.
 function bounds(width = state.w) {
  const list = buttons(), first = list[0], last = list.at(-1);
  if (!first || !last) return {min: 0, max: 0};
  return {min: slot(first).x, max: slot(last).x + slot(last).w - width};
 }
 function paint() {
  const motion = glassSegmentMotion();
  const speed = Math.min(1, Math.abs(state.vs) / 2400);
  const stretch = motion ? speed * .22 : 0;
  // Squash against a wall: narrower and a little taller, pressed to the wall it touches.
  const squash = motion ? Math.max(0, Math.min(.35, state.sq)) : 0;
  const {min, max} = bounds();
  const side = state.x <= min + .5 ? 'left' : state.x >= max - .5 ? 'right' : 'center';
  let sx = (1 + stretch) * (1 - squash * .6);
  const sy = Math.min(1.1, (1 - stretch * .4) * (1 + squash * .3));
  // Touching a wall it grows only away from it, so it never pokes out of the track.
  if (side !== 'center') sx = Math.min(1, sx);
  const width = Math.max(0, Math.round(state.w * 4) / 4);
  if (width !== drawnWidth) { drawnWidth = width; thumb.style.width = `${width}px`; }
  thumb.style.transformOrigin = side === 'center' ? 'center' : `${side} center`;
  thumb.style.transform = `translateX(${Number(state.x.toFixed(3))}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  placeLens(sx, sy, side);
 }
 function step(now) {
  state.frame = 0;
  const dt = Math.min(.05, Math.max(.001, (now - (state.last || now)) / 1000 || .016));
  state.last = now;
  // Close behind the pointer while dragging; springy (overshoots and wobbles) when settling.
  // Integrated in small fixed steps: a stiff spring over a long frame (the lens is heavy, frames
  // can take 30 ms or more) would otherwise blow up and make the bead drift or shake.
  // Dragging: critically damped (right behind the finger, no overshoot, no wobble).
  const stiffness = state.dragging ? 6000 : 420, damping = state.dragging ? 155 : 17;
  const {min, max} = bounds();
  for (let left = dt; left > 1e-6; left -= .004) {
   const h = Math.min(.004, left);
   state.vx += ((state.tx - state.x) * stiffness - state.vx * damping) * h;
   state.vw += ((state.tw - state.w) * stiffness - state.vw * damping) * h;
   // The squash springs back on its own, so a release from the wall wobbles too.
   state.vsq += ((state.squash - state.sq) * 700 - state.vsq * 16) * h;
   state.x += state.vx * h; state.w += state.vw * h; state.sq += state.vsq * h;
   state.vlift += ((state.liftTarget - state.lift) * 380 - state.vlift * 17) * h;
   state.lift += state.vlift * h;
   // Walls: the bead stays inside the track and bounces off, squashing with the hit.
   if (max >= min && (state.x < min || state.x > max)) {
    state.x = state.x < min ? min : max;
    if (glassSegmentMotion()) state.vsq += Math.min(14, Math.abs(state.vx) / 90);
    state.vx = -state.vx * .35;
   }
  }
  if (state.sq < 0) { state.sq = 0; state.vsq = Math.abs(state.vsq) * .3; }
  // The stretch follows a smoothed speed, so uneven pointer events do not make it flicker.
  state.vs += (state.vx - state.vs) * Math.min(1, dt * 14);
  // Landed to the eye (the last wobble is below a pixel): swap the heavy drop for the bead now.
  if (lens && !state.dragging && state.liftTarget === 0 && Math.abs(state.lift) < .03 && Math.abs(state.vlift) < .4 &&
   Math.abs(state.tx - state.x) < .5 && Math.abs(state.vx) < 15) { paint(); hideLens(); }
  const resting = Math.abs(state.tx - state.x) < .3 && Math.abs(state.vx) < 8 && Math.abs(state.tw - state.w) < .3 && Math.abs(state.vw) < 8 &&
   Math.abs(state.squash - state.sq) < .004 && Math.abs(state.vsq) < .05 &&
   Math.abs(state.liftTarget - state.lift) < .006 && Math.abs(state.vlift) < .06;
  if (resting && !state.dragging) {
   state.x = state.tx; state.w = state.tw; state.vx = state.vw = state.vs = 0; state.sq = state.squash; state.vsq = 0; state.last = 0;
   state.lift = state.liftTarget; state.vlift = 0;
   paint();
   // Landed: the drop is now exactly the bead, so they swap with a short cross-fade.
   hideLens();
   layout = null; // measured again for the next drag
   return;
  } else {
   state.frame = requestAnimationFrame(step);
  }
  paint();
 }
 function moveTo(x, w, animate = true) {
  state.tx = x; state.tw = w;
  if (!animate || !state.placed || !glassSegmentMotion() || typeof requestAnimationFrame !== 'function') {
   if (state.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
   state.frame = 0; state.last = 0;
   state.x = x; state.w = w; state.vx = state.vw = 0; state.sq = state.squash = state.vsq = 0; state.placed = w > 0;
   // The animation that would have put the drop away is cancelled here, so put it away now (else
   // it stayed on the old tab, looking like a second chosen one).
   if (!state.dragging) { state.lift = state.liftTarget = 0; state.vlift = 0; hideLens(); }
   paint();
   return;
  }
  if (!state.frame) state.frame = requestAnimationFrame(step);
 }
 function sync(animate = true) {
  if (state.dragging) return;
  layout = null;
  const button = pressed();
  thumb.hidden = !button;
  if (!button) return;
  const target = slot(button);
  if (!target.w) return; // menu closed: placed again when it opens
  moveTo(target.x, target.w, animate);
 }
 function nearest(centerX) {
  let best = null, distance = Infinity;
  for (const button of buttons()) {
   const s = slot(button), d = Math.abs(s.x + s.w / 2 - centerX);
   if (d < distance) { distance = d; best = button; }
  }
  return best;
 }
 function markUnder(button) {
  for (const item of buttons()) item.classList.toggle('ytmls-seg-under', item === button);
 }

 // ---------- Press and drag ----------
 // Like iOS: pressing lifts the bead at once (it turns into the lens, even before moving) and it
 // stays centered under the pointer; releasing picks the size under the pointer. A quick tap is
 // the same lift and release. The pointer is captured on press so every move reaches the control,
 // and the browser's own click is swallowed (the release has already chosen).
 let press = null, suppressClick = false;
 function swallowNextClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
 }
 function beginDrag() {
  if (!press || state.dragging) return;
  measure();
  state.dragging = true;
  group.dataset.dragging = 'true';
  showLens();
  state.liftTarget = 1;
  if (!glassSegmentMotion()) { state.lift = 1; state.vlift = 0; }
  thumb.hidden = false;
  const current = pressed() || press.button;
  if (current) { const s = slot(current); state.tw = s.w; if (!state.placed) moveTo(s.x, s.w, false); }
  // Centered under the pointer, so the size chosen on release is the one under the finger.
  state.grab = state.tw / 2;
  follow(press.lastX);
 }
 function follow(clientX) {
  const rect = groupRect();
  const first = buttons()[0], last = buttons().at(-1);
  if (!first || !last) return;
  const min = slot(first).x, max = slot(last).x + slot(last).w - state.tw;
  const raw = clientX - rect.left - state.grab;
  const x = Math.max(min, Math.min(max, raw));
  // Past an end the bead stays put and squashes harder the further it is pulled.
  const band = glassSegmentRubber(raw - x, state.tw * .35);
  const under = nearest(x + state.tw / 2);
  if (under) state.tw = slot(under).w;
  markUnder(under);
  state.tx = x;
  state.squash = state.tw ? Math.abs(band) / state.tw : 0;
  if (!state.frame && typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(step);
 }
 function endDrag(commit) {
  const wasDragging = state.dragging;
  press = null;
  if (!wasDragging) return;
  state.dragging = false;
  state.squash = 0;
  // The drop is not dropped here: it glides to the chosen size and shrinks into the bead there.
  state.liftTarget = 0;
  if (!glassSegmentMotion()) { state.lift = 0; state.vlift = 0; hideLens(); }
  delete group.dataset.dragging;
  markUnder(null);
  const target = nearest(state.tx + state.w / 2);
  if (!state.frame && typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(step);
  if (target) {
   const s = slot(target);
   moveTo(s.x, s.w);
   if (commit && !isDisabled(target) && !isSelected(target)) activate(target);
   // Not taken (e.g. the song is still loading): go back to the size actually in use, so the
   // bead never shows a size the lyrics do not have.
   const check = () => { if (!isSelected(target)) sync(); };
   if (settleMs) setTimeout(check, settleMs); else check();
  }
  swallowNextClick();
 }
 // The button under a point (with the pointer captured, events report the group as their target).
 function buttonAt(clientX) {
  const x = clientX - groupRect().left;
  return buttons().find(button => { const s = slot(button); return x >= s.x && x < s.x + s.w; }) || null;
 }
 // While a drag runs, the whole window is watched (capture phase), not only this control: if the
 // page captures the pointer for itself, or capture is lost, the drag still follows the pointer and
 // ends where it is released.
 const watched = ['pointermove', 'pointerup', 'pointercancel'];
 function onWindowPointer(event) {
  if (!press || event.pointerId !== press.id) return;
  if (event.type === 'pointermove') {
   if (!state.dragging) return;
   press.lastX = event.clientX;
   follow(event.clientX);
   return;
  }
  if (event.type === 'pointerup') { noteEnd('pointerup'); follow(event.clientX); }
  else if (!state.dragging) { stopWatching(); press = null; return; }
  else noteEnd('pointercancel');
  // The browser taking a drag over (selection, native drag, touch scroll) still picks the size the
  // bead was slid to, instead of sending it back.
  stopWatching();
  endDrag(true);
 }
 function startWatching() { for (const type of watched) window.addEventListener(type, onWindowPointer, true); }
 function stopWatching() { for (const type of watched) window.removeEventListener(type, onWindowPointer, true); }
 function noteEnd(how) {
  const from = press ? Math.round(press.startX) : '?', to = press ? Math.round(press.lastX) : '?';
  glassLensReport.lastEnd = `${how} ${from}->${to}`;
 }
 group.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !enabled() || !canPress() || buttons().every(isDisabled)) return;
  press = {id: event.pointerId, type: event.pointerType || 'pointer', startX: event.clientX, lastX: event.clientX, button: itemOf(event.target) || buttonAt(event.clientX)};
  try { group.setPointerCapture(event.pointerId); } catch (_) {}
  startWatching();
  beginDrag();
 });
 // Losing the capture does not end the drag (the window still reports the pointer).
 group.addEventListener('lostpointercapture', () => { if (state.dragging && press) glassLensReport.lastEnd = 'capture lost (still following)'; });
 // Keep the browser from starting its own selection or drag from the labels.
 group.addEventListener('dragstart', event => event.preventDefault());
 group.addEventListener('selectstart', event => event.preventDefault());
 // Pointer clicks were handled above; keyboard clicks (Enter, Space) still move the bead.
 group.addEventListener('click', event => {
  if (event.isTrusted && suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
  const button = itemOf(event.target);
  if (button && !isDisabled(button) && !state.dragging) { const s = slot(button); if (s.w) moveTo(s.x, s.w); }
 }, true);
 // The page's own press handling (YouTube Music selects a tab on its own tap) must not also act on
 // a press this control is handling: the release already chose.
 for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend']) {
  group.addEventListener(type, event => { if ((press || state.dragging || suppressClick) && event.isTrusted) event.stopPropagation(); }, true);
 }
 group.addEventListener('contextmenu', event => { if (press || state.dragging) event.preventDefault(); });

 // A scroll or resize during a drag moves the control: measure it again.
 const remeasure = () => { if (state.dragging) measure(); };
 if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('scroll', remeasure, {capture: true, passive: true});
  window.addEventListener('resize', remeasure, {passive: true});
 }

 // Follow the saved size (it changes after storage writes and in other tabs) and the layout.
 if (typeof MutationObserver === 'function') {
  // This control's own marker class (the label under the drop) is not a change of choice.
  const own = value => String(value || '').split(/\s+/).filter(name => name && name !== 'ytmls-seg-under').sort().join(' ');
  new MutationObserver(records => {
   if (records.every(r => r.attributeName === 'class' && own(r.oldValue) === own(r.target.getAttribute('class')))) return;
   sync();
  }).observe(group, {subtree: true, attributes: true, attributeOldValue: true, attributeFilter: opts.watch || ['aria-pressed']});
 }
 if (typeof ResizeObserver === 'function') new ResizeObserver(() => sync(false)).observe(group);
 sync(false);
 group.glassSegment = {sync, state, thumb};
 return group.glassSegment;
}

// ---------- YouTube Music's player-page tabs (次のコンテンツ / 歌詞 / コメント / 関連) ----------
// The same draggable glass bead as the size control, on the tabs restyled as a segmented control
// (liquid-glass.css). Only while the theme is on (html.music-glass); otherwise the tabs are untouched.
function ytmTabSelected(tab) {
 if (ytmExternalLyricsOpen() && tab.parentElement?.querySelector(':scope > .ytmls-external-native-label')) return ytmExternalLyricsTab(tab);
 return tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('iron-selected');
}
function ytmTabDisabled(tab) {
 if (ytmExternalLyricsTab(tab)) return false;
 return tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true';
}
// YouTube Music selects a tab on a click (its tap gesture); a plain tap event is the fallback.
// A song without YouTube Music lyrics: its 歌詞 tab is disabled and the extension shows its own lyrics
// in its place (external-tab.js marks that tab .ytmls-external-native-label). The bead treats it as a
// normal tab: chosen while those lyrics are open, and choosing it opens them.
function ytmExternalLyricsTab(tab) {
 return tab.classList.contains('ytmls-external-native-label');
}
function ytmExternalLyricsOpen() {
 return document.documentElement.classList.contains('ytmls-external-lyrics-open');
}
function activateYtmTab(tab) {
 if (ytmExternalLyricsTab(tab)) {
  if (typeof openExternalLyrics === 'function') openExternalLyrics();
  return;
 }
 if (ytmExternalLyricsOpen() && typeof closeExternalLyrics === 'function') { closeExternalLyrics(); if (typeof ensureLyricsMount === 'function') ensureLyricsMount(); }
 try { tab.click(); } catch (_) {}
 if (!ytmTabSelected(tab)) {
  try { tab.dispatchEvent(new CustomEvent('tap', {bubbles: true, cancelable: true, composed: true})); } catch (_) {}
 }
}
// YouTube Music's Now Playing controls can be pressed only while that page is open and they show.
function ytmPlayerControlShown(el) {
 const layout = document.querySelector('ytmusic-app-layout');
 if (layout && (!layout.hasAttribute('player-page-open') && !layout.hasAttribute('player-fullscreened'))) return false;
 if (typeof el?.checkVisibility === 'function' && !el.checkVisibility({opacityProperty: true, visibilityProperty: true})) return false;
 const rect = el?.getBoundingClientRect?.();
 return !rect || (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < (window.innerHeight || Infinity));
}
function ensureYtmTabGlassSegment() {
 const root = document.documentElement;
 if (!root?.classList.contains('music-glass')) return null;
 // YouTube Music can leave an old tab bar in the page next to a new one: use the one that shows.
 const all = [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-tabs')];
 const tabs = all.find(el => typeof el.checkVisibility !== 'function' || el.checkVisibility()) || all[0];
 if (!tabs) return null;
 // The tabs sit in #tabsContent inside paper-tabs (the bead must share their offset parent).
 const first = tabs.querySelector('tp-yt-paper-tab');
 const group = first?.parentElement;
 // A bead left from an earlier set of tabs (YouTube Music can rebuild them in place) stays where
 // it was and looks like a second chosen tab: only the current group keeps one.
 for (const stale of document.querySelectorAll('ytmusic-player-page .ytmls-seg-thumb')) {
  const owner = stale.parentElement;
  if (owner !== group && owner?.classList.contains('ytmls-tabs-segment')) stale.remove();
 }
 if (group?.glassSegment) {
  // A tab chosen without a change the observer sees (YouTube Music swapping a tab's node, or a
  // switch while the page was hidden): bring the bead to the chosen tab on the regular tick.
  const segment = group.glassSegment;
  const chosen = [...group.children].find(el => el.localName === 'tp-yt-paper-tab' && !el.classList.contains('ytmls-tab-hidden') && ytmTabSelected(el));
  if (chosen && !segment.state.dragging && segment.lastChosen !== chosen) { segment.lastChosen = chosen; segment.sync(); }
  return segment;
 }
 if (!group) return null;
 tabs.classList.add('ytmls-tabs-glass');
 group.classList.add('ytmls-tabs-segment');
 return attachGlassSegment(group, {
  items: () => [...group.children].filter(el => el.localName === 'tp-yt-paper-tab' && !el.classList.contains('ytmls-tab-hidden')),
  isSelected: ytmTabSelected,
  isDisabled: ytmTabDisabled,
  activate: activateYtmTab,
  watch: ['aria-selected', 'class'],
  settleMs: 300,
  enabled: () => document.documentElement.classList.contains('music-glass'),
  canPress: () => ytmPlayerControlShown(group),
 });
}

// ---------- YouTube Music's 曲 / 動画 switch (ytmusic-av-toggle) ----------
// Restyled as the same segmented control as the tabs (liquid-glass.css), with the draggable bead.
// The chosen side comes from the toggle's playback-mode (ATV = song, OMV = video); without it,
// from a pressed/selected mark on the buttons.
function ytmAvSelected(button) {
 const toggle = button.closest('ytmusic-av-toggle');
 const mode = String(toggle?.getAttribute('playback-mode') || '').toUpperCase();
 if (mode.startsWith('ATV') || mode.startsWith('OMV')) return button.classList.contains('song-button') ? mode.startsWith('ATV') : mode.startsWith('OMV');
 return button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-selected') === 'true' ||
  button.classList.contains('selected') || button.classList.contains('active') || button.hasAttribute('selected');
}
// Unavailable (a song without a video, for example): YouTube Music marks the toggle or its buttons.
function ytmAvDisabled(toggle, button) {
 const off = el => Boolean(el && (el.disabled || el.hasAttribute?.('disabled') || el.getAttribute?.('aria-disabled') === 'true'));
 return Boolean(toggle?.hasAttribute('toggle-disabled') || toggle?.hasAttribute('disabled') || off(button));
}
function ensureYtmAvToggleGlass() {
 if (!document.documentElement?.classList.contains('music-glass')) return null;
 const toggle = document.querySelector('ytmusic-player-page ytmusic-av-toggle');
 const song = toggle?.querySelector('.song-button');
 const video = toggle?.querySelector('.video-button');
 const group = song?.parentElement;
 if (!group || !video || video.parentElement !== group) return null;
 // The chosen side's label is white (marked here: playback-mode may be missing or named differently).
 for (const button of [song, video]) button.classList.toggle('ytmls-av-on', ytmAvSelected(button));
 // The whole switch looks unavailable when neither side can be chosen.
 toggle.classList.toggle('ytmls-av-unavailable', ytmAvDisabled(toggle, song) && ytmAvDisabled(toggle, video) || ytmAvDisabled(toggle, video) && ytmAvSelected(song) || ytmAvDisabled(toggle, song) && ytmAvSelected(video));
 if (group.glassSegment) return group.glassSegment;
 toggle.classList.add('ytmls-av-glass');
 group.classList.add('ytmls-av-segment');
 const segment = attachGlassSegment(group, {
  items: () => [...group.children].filter(el => el.classList.contains('song-button') || el.classList.contains('video-button')),
  isSelected: ytmAvSelected,
  isDisabled: button => ytmAvDisabled(toggle, button),
  activate: button => button.click(),
  watch: ['class', 'aria-pressed', 'aria-selected', 'selected', 'disabled'],
  settleMs: 400,
  enabled: () => document.documentElement.classList.contains('music-glass'),
  canPress: () => ytmPlayerControlShown(group),
 });
 // playback-mode lives on the toggle, above the group the segment watches.
 if (typeof MutationObserver === 'function') {
  new MutationObserver(() => segment.sync()).observe(toggle, {attributes: true, attributeFilter: ['playback-mode', 'toggle-disabled']});
 }
 return segment;
}
