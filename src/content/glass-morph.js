// Glass surfaces grow out of the button that opens them and shrink back into it when closed,
// like Liquid Glass: the window starts as the button's capsule, then stretches to full size on
// a spring while its contents fade in. Used by the "その他" menu, the timing popover and the
// lyrics tool pane. Without motion (lightweight mode, reduced motion) they open as before.
const GLASS_MORPH_OPEN_MS = 460;
const GLASS_MORPH_CLOSE_MS = 300;
// Room around the surface so the clip never cuts off its shadow.
const GLASS_MORPH_SHADOW_ROOM = 48;
let glassMorphSpringEasing = null;

// A soft spring (about 10% overshoot) as a CSS linear() curve; cubic-bezier where unsupported.
function glassMorphEasing() {
 if (glassMorphSpringEasing) return glassMorphSpringEasing;
 const points = [];
 const stiffness = 170, damping = 17, steps = 40;
 let x = 0, v = 0;
 const dt = 1 / 60;
 const frames = Math.round(GLASS_MORPH_OPEN_MS / 1000 / dt);
 for (let i = 0; i <= frames; i++) {
  if (i % Math.max(1, Math.round(frames / steps)) === 0 || i === frames) points.push(i === frames ? 1 : Number(x.toFixed(4)));
  v += ((1 - x) * stiffness - v * damping) * dt;
  x += v * dt;
 }
 const curve = `linear(${points.join(', ')})`;
 let supported = false;
 try { supported = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', curve); } catch (_) {}
 glassMorphSpringEasing = supported ? curve : 'cubic-bezier(.34, 1.4, .64, 1)';
 return glassMorphSpringEasing;
}

function glassMorphAllowed(el) {
 return Boolean(el?.animate) && (typeof playerFeedbackEnabled !== 'function' || playerFeedbackEnabled());
}

// The button's rectangle expressed on the surface: where on the surface the capsule starts
// (the side nearest the button), and how far the surface must shift to sit on the button.
function glassMorphStart(surface, anchor) {
 const w = surface.width, h = surface.height;
 const aw = Math.min(anchor.width, w), ah = Math.min(anchor.height, h);
 const cx = Math.max(0, Math.min(w - aw, anchor.left - surface.left));
 let cy;
 if (anchor.top + anchor.height / 2 <= surface.top) cy = 0;
 else if (anchor.top + anchor.height / 2 >= surface.bottom) cy = h - ah;
 else cy = Math.max(0, Math.min(h - ah, anchor.top - surface.top));
 return {
  inset: `inset(${cy}px ${w - cx - aw}px ${h - cy - ah}px ${cx}px round ${ah / 2}px)`,
  dx: anchor.left - (surface.left + cx), dy: anchor.top - (surface.top + cy),
 };
}

// Stops a running morph on el: its animation and its own content fades (never other
// animations, such as CSS ones on the children), and runs its onCancel cleanup.
function stopGlassMorph(el) {
 const run = el?.glassMorphRun;
 if (!run) return false;
 el.glassMorphRun = null;
 el.glassMorph = null;
 delete el.dataset.morphing;
 run.animation.cancel();
 for (const fade of run.fades) fade.cancel();
 if (run.onCancel) run.onCancel();
 return true;
}

// onDone runs when the morph completes (or at once without motion); onCancel runs instead
// when another morph or stopGlassMorph interrupts it, so callers can undo their temporary state.
function glassMorph(el, anchorEl, {closing = false, onDone, onCancel} = {}) {
 const done = () => { if (onDone) onDone(); };
 if (!el || !anchorEl?.isConnected || !glassMorphAllowed(el)) { stopGlassMorph(el); done(); return null; }
 // Stop the previous morph before measuring: its transform would shift the rectangle.
 stopGlassMorph(el);
 const surface = el.getBoundingClientRect(), anchor = anchorEl.getBoundingClientRect();
 if (!surface.width || !surface.height || !anchor.width || !anchor.height) { done(); return null; }
 const start = glassMorphStart(surface, anchor);
 const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22;
 const room = GLASS_MORPH_SHADOW_ROOM;
 const capsule = {clipPath: start.inset, transform: `translate(${start.dx}px, ${start.dy}px)`};
 // Fully open, the clip reaches past the edges (with matching rounded corners) so the shadow stays.
 const open = {clipPath: `inset(${-room}px ${-room}px ${-room}px ${-room}px round ${radius + room}px)`, transform: 'translate(0px, 0px)'};
 // Opening: the capsule fades in from the button. Closing: it moves fast at first, then eases
 // into the button and melts into it instead of vanishing.
 const keyframes = closing
  ? [{...open, opacity: 1}, {opacity: 1, offset: .55}, {...capsule, opacity: 0}]
  : [{...capsule, opacity: 0}, {opacity: 1, offset: .12}, {...open, opacity: 1}];
 const animation = el.animate(keyframes, {
  duration: closing ? GLASS_MORPH_CLOSE_MS : GLASS_MORPH_OPEN_MS,
  easing: closing ? 'cubic-bezier(.25, .8, .25, 1)' : glassMorphEasing(),
 });
 // Contents fade in once the glass has room, and out first when it shrinks back.
 const fades = [];
 for (const child of el.children) {
  fades.push(child.animate(closing ? [{opacity: 1}, {opacity: 0}] : [{opacity: 0}, {opacity: 0, offset: .25}, {opacity: 1}], {
   duration: closing ? GLASS_MORPH_CLOSE_MS * .4 : GLASS_MORPH_OPEN_MS * .7, easing: 'ease-out', fill: closing ? 'forwards' : 'none',
  }));
 }
 const run = {animation, fades, onCancel};
 el.glassMorphRun = run;
 el.glassMorph = animation;
 el.dataset.morphing = closing ? 'closing' : 'opening';
 animation.finished.then(() => {
  if (el.glassMorphRun !== run) return;
  el.glassMorphRun = null;
  el.glassMorph = null;
  delete el.dataset.morphing;
  if (closing) for (const fade of fades) fade.cancel();
  done();
 }, () => {});
 return animation;
}
