// Glass segmented control (Small / Medium / Large): a glass bead marks the chosen button.
// Press anywhere and slide to move it: it follows the pointer on a spring,
// stretches with its speed and magnifies the label under it. It never leaves the track: pulled
// past an end it squashes against the wall, and it bounces off the walls inside the track.
// A short tap still works as a normal button.
const GLASS_SEGMENT_DRAG_PX = 3;

// Rubber band past the ends: moves less and less the further it is pulled (at most `limit`).
function glassSegmentRubber(over, limit) {
 if (!over || limit <= 0) return 0;
 return Math.sign(over) * limit * (1 - 1 / (Math.abs(over) / limit + 1));
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
 const slot = button => ({x: button.offsetLeft, w: button.offsetWidth});
 // Spring state: position and width follow their targets; velocity drives the stretch.
 const state = {x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, frame: 0, last: 0, placed: false, dragging: false, grab: 0, squash: 0, sq: 0, vsq: 0};

 // ---------- The drop: a real lens while dragging ----------
 // Inside the glass menu a backdrop filter would only see the menu itself, so while dragging a
 // clear drop is shown above the page (fixed, at the bead's place) and bends everything under it:
 // the labels, the track and the menu glass, with colors split at its rim like the iOS tab bar.
 let lens = null;
 const lensAllowed = () => Boolean(document.documentElement?.classList?.contains('ytmls-lg-lens')) &&
  !document.documentElement.classList.contains('ytmls-lyrics-motion-lightweight') &&
  typeof group.getBoundingClientRect === 'function' && Boolean(document.body);
 function placeLens(sx = 1, sy = 1) {
  if (!lens) return;
  const rect = group.getBoundingClientRect(), track = Math.max(0, group.offsetHeight - 6);
  const {min, max} = bounds();
  // Bigger than the bead (it lifts), but never wider past the track's ends.
  const room = (max + state.w) - min;
  const width = Math.min(room + 8, state.w * 1.14 * sx), height = track * 1.6 * sy;
  let left = rect.left + state.x + state.w / 2 - width / 2;
  left = Math.max(rect.left + min - 4, Math.min(rect.left + max + state.w + 4 - width, left));
  lens.style.left = `${left.toFixed(1)}px`;
  lens.style.top = `${(rect.top + group.offsetHeight / 2 - height / 2).toFixed(1)}px`;
  lens.style.width = `${width.toFixed(1)}px`;
  lens.style.height = `${height.toFixed(1)}px`;
 }
 function showLens() {
  if (lens || !lensAllowed()) return;
  lens = document.createElement('div');
  lens.className = 'ytmls-seg-lens';
  lens.setAttribute('aria-hidden', 'true');
  document.body.append(lens);
  group.dataset.lens = 'true';
  placeLens();
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
  const speed = Math.min(1, Math.abs(state.vx) / 2400);
  const stretch = motion ? speed * .22 : 0;
  // Squash against a wall: narrower and a little taller, pressed to the wall it touches.
  const squash = motion ? Math.max(0, Math.min(.35, state.sq)) : 0;
  const {min, max} = bounds();
  const side = state.x <= min + .5 ? 'left' : state.x >= max - .5 ? 'right' : 'center';
  let sx = (1 + stretch) * (1 - squash * .6);
  const sy = Math.min(1.1, (1 - stretch * .4) * (1 + squash * .3));
  // Touching a wall it grows only away from it, so it never pokes out of the track.
  if (side !== 'center') sx = Math.min(1, sx);
  thumb.style.width = `${Math.max(0, state.w)}px`;
  thumb.style.transformOrigin = side === 'center' ? 'center' : `${side} center`;
  thumb.style.transform = `translateX(${state.x}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  placeLens(sx, sy);
 }
 function step(now) {
  state.frame = 0;
  const dt = Math.min(.032, Math.max(.001, (now - (state.last || now)) / 1000 || .016));
  state.last = now;
  // Close behind the pointer while dragging; springy (overshoots and wobbles) when settling.
  const stiffness = state.dragging ? 2000 : 420, damping = state.dragging ? 64 : 17;
  state.vx += ((state.tx - state.x) * stiffness - state.vx * damping) * dt;
  state.vw += ((state.tw - state.w) * stiffness - state.vw * damping) * dt;
  // The squash springs back on its own, so a release from the wall wobbles too.
  state.vsq += ((state.squash - state.sq) * 700 - state.vsq * 16) * dt;
  state.x += state.vx * dt; state.w += state.vw * dt; state.sq += state.vsq * dt;
  // Walls: the bead stays inside the track and bounces off, squashing with the hit.
  const {min, max} = bounds();
  if (max >= min && (state.x < min || state.x > max)) {
   state.x = state.x < min ? min : max;
   if (glassSegmentMotion()) state.vsq += Math.min(14, Math.abs(state.vx) / 90);
   state.vx = -state.vx * .35;
  }
  if (state.sq < 0) { state.sq = 0; state.vsq = Math.abs(state.vsq) * .3; }
  const resting = Math.abs(state.tx - state.x) < .3 && Math.abs(state.vx) < 8 && Math.abs(state.tw - state.w) < .3 && Math.abs(state.vw) < 8 &&
   Math.abs(state.squash - state.sq) < .004 && Math.abs(state.vsq) < .05;
  if (resting && !state.dragging) {
   state.x = state.tx; state.w = state.tw; state.vx = state.vw = 0; state.sq = state.squash; state.vsq = 0; state.last = 0;
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
 // The pointer is captured as soon as it goes down, so every move reaches the control (even off
 // it). A slide of a few pixels starts the drag at once; releasing without sliding is a tap,
 // handled here too (with the pointer captured the browser would not click the button).
 let press = null, suppressClick = false;
 function swallowNextClick() {
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
 }
 function beginDrag() {
  if (!press || state.dragging) return;
  state.dragging = true;
  group.dataset.dragging = 'true';
  showLens();
  thumb.hidden = false;
  const current = pressed() || press.button;
  if (current) { const s = slot(current); state.tw = s.w; if (!state.placed) moveTo(s.x, s.w, false); }
  // Keep the spot that was grabbed under the pointer; pressing elsewhere centers the bead there.
  const rect = group.getBoundingClientRect(), local = press.startX - rect.left;
  state.grab = local >= state.x && local <= state.x + state.w ? local - state.x : state.tw / 2;
  follow(press.lastX);
 }
 function follow(clientX) {
  const rect = group.getBoundingClientRect();
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
  }
  swallowNextClick();
 }
 // The button under a point (with the pointer captured, events report the group as their target).
 function buttonAt(clientX) {
  const rect = group.getBoundingClientRect();
  const x = clientX - rect.left;
  return buttons().find(button => { const s = slot(button); return x >= s.x && x < s.x + s.w; }) || null;
 }
 group.addEventListener('pointerdown', event => {
  if (event.button !== 0 || buttons().every(button => button.disabled)) return;
  press = {id: event.pointerId, startX: event.clientX, lastX: event.clientX, button: event.target.closest?.('button') || buttonAt(event.clientX)};
  try { group.setPointerCapture(event.pointerId); } catch (_) {}
 });
 group.addEventListener('pointermove', event => {
  if (!press || event.pointerId !== press.id) return;
  press.lastX = event.clientX;
  if (state.dragging) { event.preventDefault(); follow(event.clientX); return; }
  if (Math.abs(event.clientX - press.startX) > GLASS_SEGMENT_DRAG_PX) beginDrag();
 });
 group.addEventListener('pointerup', event => {
  if (!press || event.pointerId !== press.id) return;
  if (state.dragging) { endDrag(true); return; }
  // A tap: choose the button it was released on.
  const tapped = buttonAt(event.clientX) || press.button;
  press = null;
  swallowNextClick();
  if (tapped && !tapped.disabled) {
   const s = slot(tapped);
   if (s.w) moveTo(s.x, s.w);
   if (tapped.getAttribute('aria-pressed') !== 'true') tapped.click();
  }
 });
 group.addEventListener('pointercancel', () => endDrag(false));
 group.addEventListener('lostpointercapture', () => { if (state.dragging) endDrag(true); else press = null; });
 // Pointer clicks were handled above; keyboard clicks (Enter, Space) still move the bead.
 group.addEventListener('click', event => {
  if (event.isTrusted && suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
  const button = event.target.closest?.('button');
  if (button && !button.disabled && !state.dragging) { const s = slot(button); if (s.w) moveTo(s.x, s.w); }
 }, true);
 group.addEventListener('contextmenu', event => { if (press || state.dragging) event.preventDefault(); });

 // Follow the saved size (it changes after storage writes and in other tabs) and the layout.
 if (typeof MutationObserver === 'function') {
  new MutationObserver(() => sync()).observe(group, {subtree: true, attributes: true, attributeFilter: ['aria-pressed']});
 }
 if (typeof ResizeObserver === 'function') new ResizeObserver(() => sync(false)).observe(group);
 sync(false);
 group.glassSegment = {sync, state, thumb};
 return group.glassSegment;
}
