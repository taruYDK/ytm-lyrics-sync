import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/content/glass-morph.js', import.meta.url), 'utf8');
const rect = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height});

function morph({motion = true, linear = true} = {}) {
  const animations = [];
  const fakeAnimation = () => { let resolve; const a = {finished: new Promise(r => { resolve = r; }), cancel() { a.cancelled = true; resolve(); }, finish: () => resolve()}; animations.push(a); return a; };
  const child = () => ({animate: (k, o) => Object.assign(fakeAnimation(), {keyframes: k, options: o}), getAnimations: () => []});
  const el = {dataset: {}, children: [child(), child()], getBoundingClientRect: () => rect(1080, 175, 288, 520),
    animate(keyframes, options) { const a = fakeAnimation(); a.keyframes = keyframes; a.options = options; this.last = a; return a; }};
  const c = vm.createContext({playerFeedbackEnabled: () => motion, getComputedStyle: () => ({borderTopLeftRadius: '22px'}),
    CSS: {supports: (p, v) => linear || !String(v).startsWith('linear(')}});
  vm.runInContext(source, c);
  return {c, el, animations};
}

test('a surface below its button starts as the button capsule at its top edge', () => {
  const {c} = morph();
  const start = c.glassMorphStart(rect(1080, 175, 288, 520), rect(1290, 134, 78, 32));
  assert.equal(start.inset, 'inset(0px 0px 488px 210px round 16px)');
  assert.deepEqual([start.dx, start.dy], [0, -41]);
  const above = c.glassMorphStart(rect(286, 283, 330, 540), rect(390, 836, 120, 36));
  assert.match(above.inset, /^inset\(504px /, 'a popover above its button grows from its bottom edge');
});

test('opening grows from the button on a spring; contents fade in', async () => {
  const h = morph();
  const anchor = {isConnected: true, getBoundingClientRect: () => rect(1290, 134, 78, 32)};
  h.c.glassMorph(h.el, anchor);
  const a = h.el.last;
  assert.match(a.keyframes[0].clipPath, /round 16px\)$/);
  assert.equal(a.keyframes.at(-1).clipPath, 'inset(-48px -48px -48px -48px round 70px)', 'room for the shadow');
  assert.equal(a.keyframes[0].opacity, 0);
  assert.match(a.options.easing, /^linear\(0, .*, 1\)$/);
  assert.ok(a.options.easing.split(',').some(v => Number(v.replace(/[^\d.]/g, '')) > 1.02), 'overshoots a little');
  assert.equal(h.el.dataset.morphing, 'opening');
  a.finish(); await a.finished; await null;
  assert.equal(h.el.dataset.morphing, undefined);
});

test('closing shrinks back and only then runs the hide', async () => {
  const h = morph();
  const anchor = {isConnected: true, getBoundingClientRect: () => rect(1290, 134, 78, 32)};
  let hidden = false;
  h.c.glassMorph(h.el, anchor, {closing: true, onDone: () => { hidden = true; }});
  assert.equal(hidden, false);
  const last = h.el.last.keyframes.at(-1);
  assert.equal(last.clipPath, h.c.glassMorphStart(h.el.getBoundingClientRect(), anchor.getBoundingClientRect()).inset);
  assert.equal(last.opacity, 0, 'melts into the button');
  assert.match(h.el.last.keyframes[0].clipPath, /^inset\(-48px/, 'the shadow is not cut off when closing starts');
  assert.match(h.el.last.options.easing, /^cubic-bezier\(\.25, \.8/, 'fast first, then eases into the button');
  h.el.last.finish(); await h.el.last.finished; await null;
  assert.equal(hidden, true);
});

test('reopening during a close cancels the hide', async () => {
  const h = morph();
  const anchor = {isConnected: true, getBoundingClientRect: () => rect(1290, 134, 78, 32)};
  let hidden = false;
  h.c.glassMorph(h.el, anchor, {closing: true, onDone: () => { hidden = true; }});
  const closing = h.el.last;
  h.c.glassMorph(h.el, anchor);
  await closing.finished; await null;
  assert.equal(closing.cancelled, true);
  assert.equal(hidden, false);
});

test('without motion it opens and closes at once; old browsers get a cubic-bezier spring', () => {
  const still = morph({motion: false});
  let hidden = false;
  assert.equal(still.c.glassMorph(still.el, {isConnected: true, getBoundingClientRect: () => rect(0, 0, 10, 10)}, {closing: true, onDone: () => { hidden = true; }}), null);
  assert.equal(hidden, true);
  const old = morph({linear: false});
  assert.match(old.c.glassMorphEasing(), /^cubic-bezier/);
});
