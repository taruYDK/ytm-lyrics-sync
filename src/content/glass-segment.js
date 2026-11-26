// Glass segmented control (Small / Medium / Large): a glass bead marks the chosen button.
// Press and hold (or drag the bead) to slide it left and right; it follows the pointer on a
// spring, stretches with its speed, lifts and magnifies the label under it, and snaps to the
// nearest button on release. A short tap still works as a normal button.
const GLASS_SEGMENT_HOLD_MS = 170;
const GLASS_SEGMENT_DRAG_PX = 6;

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
 const state = {x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0, frame: 0, last: 0, placed: false, dragging: false};

 function paint() {
  const speed = Math.min(1, Math.abs(state.vx) / 2400);
  const stretch = glassSegmentMotion() ? speed * .22 : 0;
  const lift = state.dragging ? 1.12 : 1;
  thumb.style.width = `${Math.max(0, state.w)}px`;
  thumb.style.transform = `translateX(${state.x}px) scale(${(lift * (1 + stretch)).toFixed(4)}, ${(lift * (1 - stretch * .45)).toFixed(4)})`;
 }
 function step(now) {
  state.frame = 0;
  const dt = Math.min(.032, Math.max(.001, (now - (state.last || now)) / 1000 || .016));
  state.last = now;
  // Snappier while dragging, a little bouncy when settling.
  const stiffness = state.dragging ? 900 : 520, damping = state.dragging ? 52 : 30;
  state.vx += ((state.tx - state.x) * stiffness - state.vx * damping) * dt;
  state.vw += ((state.tw - state.w) * stiffness - state.vw * damping) * dt;
  state.x += state.vx * dt; state.w += state.vw * dt;
  const resting = Math.abs(state.tx - state.x) < .3 && Math.abs(state.vx) < 8 && Math.abs(state.tw - state.w) < .3 && Math.abs(state.vw) < 8;
  if (resting && !state.dragging) {
   state.x = state.tx; state.w = state.tw; state.vx = state.vw = 0; state.last = 0;
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
   state.x = x; state.w = w; state.vx = state.vw = 0; state.placed = w > 0;
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

 // ---------- Press, hold and drag ----------
 let press = null, suppressClick = false;
 function beginDrag() {
  if (!press || state.dragging) return;
  clearTimeout(press.timer);
  state.dragging = true;
  group.dataset.dragging = 'true';
  thumb.hidden = false;
  try { group.setPointerCapture(press.id); } catch (_) {}
  const current = pressed() || press.button;
  if (current) { const s = slot(current); state.tw = s.w; if (!state.placed) moveTo(s.x, s.w, false); }
  follow(press.lastX);
 }
 function follow(clientX) {
  const rect = group.getBoundingClientRect();
  const first = buttons()[0], last = buttons().at(-1);
  if (!first || !last) return;
  const min = slot(first).x, max = slot(last).x + slot(last).w - state.tw;
  const x = Math.max(min, Math.min(max, clientX - rect.left - state.tw / 2));
  const under = nearest(x + state.tw / 2);
  if (under) state.tw = slot(under).w;
  markUnder(under);
  state.tx = x;
  if (!state.frame && typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(step);
 }
 function endDrag(commit) {
  const wasDragging = state.dragging;
  if (press) clearTimeout(press.timer);
  press = null;
  if (!wasDragging) return;
  state.dragging = false;
  delete group.dataset.dragging;
  markUnder(null);
  const target = nearest(state.x + state.w / 2);
  if (target) {
   const s = slot(target);
   moveTo(s.x, s.w);
   if (commit && !target.disabled && target.getAttribute('aria-pressed') !== 'true') target.click();
  }
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
 }
 group.addEventListener('pointerdown', event => {
  if (event.button !== 0 || buttons().every(button => button.disabled)) return;
  const button = event.target.closest?.('button');
  press = {id: event.pointerId, startX: event.clientX, lastX: event.clientX, button,
   onThumb: Boolean(pressed() && button === pressed()),
   timer: setTimeout(beginDrag, GLASS_SEGMENT_HOLD_MS)};
 });
 group.addEventListener('pointermove', event => {
  if (!press || event.pointerId !== press.id) return;
  press.lastX = event.clientX;
  if (state.dragging) { event.preventDefault(); follow(event.clientX); return; }
  // Dragging the bead itself starts at once; elsewhere it waits for the hold.
  if (press.onThumb && Math.abs(event.clientX - press.startX) > GLASS_SEGMENT_DRAG_PX) beginDrag();
 });
 group.addEventListener('pointerup', event => { if (press && event.pointerId === press.id) endDrag(true); });
 group.addEventListener('pointercancel', () => endDrag(false));
 group.addEventListener('lostpointercapture', () => { if (state.dragging) endDrag(true); });
 // The click after a drag is the drag itself; a plain tap moves the bead right away.
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
