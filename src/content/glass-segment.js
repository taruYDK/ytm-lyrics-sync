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

function attachGlassSegment(group) {
 if (!group || group.glassSegment) return group?.glassSegment;
 const thumb = document.createElement('span');
 thumb.className = 'ytmls-seg-thumb';
 thumb.setAttribute('aria-hidden', 'true');
 group.prepend(thumb);
 group.classList.add('ytmls-glass-segment');

 const buttons = () => [...group.querySelectorAll(':scope > button')];
 const pressed = () => buttons().find(button => button.getAttribute('aria-pressed') === 'true');
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
 const state = {x: 0, w: 0, vx: 0, vw: 0, vs: 0, tx: 0, tw: 0, frame: 0, last: 0, placed: false, dragging: false, grab: 0, squash: 0, sq: 0, vsq: 0};
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
  const rect = groupRect(), track = Math.max(0, groupHeight() - 6);
  const {min, max} = bounds();
  const trackLeft = rect.left + min, trackRight = rect.left + max + state.w;
  const drawn = state.w * sx;
  // A little bigger than the bead (it lifts), never past the track's ends.
  const width = Math.min(trackRight - trackLeft, drawn * 1.05), height = track * 1.32 * sy;
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
  setTimeout(() => leaving.remove(), 240);
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
  const resting = Math.abs(state.tx - state.x) < .3 && Math.abs(state.vx) < 8 && Math.abs(state.tw - state.w) < .3 && Math.abs(state.vw) < 8 &&
   Math.abs(state.squash - state.sq) < .004 && Math.abs(state.vsq) < .05;
  if (resting && !state.dragging) {
   state.x = state.tx; state.w = state.tw; state.vx = state.vw = state.vs = 0; state.sq = state.squash; state.vsq = 0; state.last = 0;
   layout = null; // measured again for the next drag
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
  hideLens();
  delete group.dataset.dragging;
  markUnder(null);
  const target = nearest(state.tx + state.w / 2);
  if (target) {
   const s = slot(target);
   moveTo(s.x, s.w);
   if (commit && !target.disabled && target.getAttribute('aria-pressed') !== 'true') target.click();
   // Not taken (e.g. the song is still loading): go back to the size actually in use, so the
   // bead never shows a size the lyrics do not have.
   if (target.getAttribute('aria-pressed') !== 'true') sync();
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
  if (event.button !== 0 || buttons().every(button => button.disabled)) return;
  press = {id: event.pointerId, type: event.pointerType || 'pointer', startX: event.clientX, lastX: event.clientX, button: event.target.closest?.('button') || buttonAt(event.clientX)};
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
  const button = event.target.closest?.('button');
  if (button && !button.disabled && !state.dragging) { const s = slot(button); if (s.w) moveTo(s.x, s.w); }
 }, true);
 group.addEventListener('contextmenu', event => { if (press || state.dragging) event.preventDefault(); });

 // A scroll or resize during a drag moves the control: measure it again.
 const remeasure = () => { if (state.dragging) measure(); };
 if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('scroll', remeasure, {capture: true, passive: true});
  window.addEventListener('resize', remeasure, {passive: true});
 }

 // Follow the saved size (it changes after storage writes and in other tabs) and the layout.
 if (typeof MutationObserver === 'function') {
  new MutationObserver(() => sync()).observe(group, {subtree: true, attributes: true, attributeFilter: ['aria-pressed']});
 }
 if (typeof ResizeObserver === 'function') new ResizeObserver(() => sync(false)).observe(group);
 sync(false);
 group.glassSegment = {sync, state, thumb};
 return group.glassSegment;
}
