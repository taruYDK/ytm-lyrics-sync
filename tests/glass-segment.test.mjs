import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/content/glass-segment.js', import.meta.url), 'utf8');

function segment({motion = true} = {}) {
  const listeners = {}, timers = [], frames = []; let now = 0;
  const clicks = [];
  const classSet = () => { const s = new Set(); return {add: c => s.add(c), toggle: (c, on) => on ? s.add(c) : s.delete(c), contains: c => s.has(c)}; };
  const buttons = ['小', '中', '大'].map((label, i) => {
    const b = {label, offsetLeft: 3 + i * 60, offsetWidth: 60, disabled: false, attrs: {'aria-pressed': String(i === 1)}, classList: classSet(),
      getAttribute: k => b.attrs[k], closest: () => b, click() { clicks.push(label); for (const x of buttons) x.attrs['aria-pressed'] = String(x === b); }};
    return b;
  });
  const group = {dataset: {}, classList: classSet(), children: [], prepend(el) { this.thumb = el; },
    querySelectorAll: () => buttons, addEventListener: (type, fn) => { listeners[type] = fn; },
    setPointerCapture() {}, getBoundingClientRect: () => ({left: 0})};
  const c = vm.createContext({
    document: {createElement: () => ({style: {}, hidden: false, setAttribute() {}})},
    playerFeedbackEnabled: () => motion,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() { frames.length = 0; },
  });
  vm.runInContext(source, c);
  const api = c.attachGlassSegment(group);
  const settle = () => { for (let i = 0; i < 400 && frames.length; i++) { now += 16; frames.shift()(now); } };
  const fire = (type, extra = {}) => { const e = {pointerId: 1, button: 0, target: extra.target || buttons[1], isTrusted: true, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...extra}; listeners[type](e); return e; };
  const step = () => { if (frames.length) { now += 16; frames.shift()(now); } };
  return {api, group, buttons, clicks, timers, settle, step, fire, translate: () => Number(/translateX\(([-\d.]+)px\)/.exec(api.thumb.style.transform)[1])};
}

test('glass bead starts on the chosen size', () => {
  const h = segment();
  assert.equal(h.translate(), 63);
  assert.equal(h.api.thumb.style.width, '60px');
  assert.ok(h.group.classList.contains('ytmls-glass-segment'));
});

test('holding and sliding moves the bead with the pointer and picks the nearest size on release', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  h.timers.at(-1)(); // the hold elapses
  assert.equal(h.group.dataset.dragging, 'true');
  h.fire('pointermove', {clientX: 140});
  h.fire('pointermove', {clientX: 160});
  h.settle();
  assert.ok(h.translate() > 100, 'follows the pointer');
  assert.ok(h.buttons[2].classList.contains('ytmls-seg-under'), 'the label under the bead is lifted');
  h.fire('pointerup', {clientX: 160});
  assert.deepEqual(h.clicks, ['大']);
  assert.equal(h.group.dataset.dragging, undefined);
  assert.ok(h.fire('click', {target: h.buttons[2]}).stopped, 'the click after a drag is swallowed');
  h.settle();
  assert.equal(h.translate(), 123);
});

test('a light slide anywhere starts the drag at once; a short tap stays a normal button', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 33, target: h.buttons[0]});
  h.fire('pointermove', {clientX: 39});
  assert.equal(h.group.dataset.dragging, 'true', 'no hold needed, even away from the bead');
  h.fire('pointercancel');
  assert.deepEqual(h.clicks, [], 'a cancelled drag changes nothing');

  const tap = segment();
  tap.fire('pointerdown', {clientX: 33, target: tap.buttons[0]});
  tap.fire('pointerup', {clientX: 33, target: tap.buttons[0]});
  assert.equal(tap.group.dataset.dragging, undefined);
  assert.equal(tap.fire('click', {target: tap.buttons[0]}).stopped, undefined, 'the tap reaches the button');
  tap.settle();
  assert.equal(tap.translate(), 3, 'the bead slides to the tapped size');
});

test('without motion the bead jumps instead of springing', () => {
  const h = segment({motion: false});
  h.buttons[1].attrs['aria-pressed'] = 'false'; h.buttons[0].attrs['aria-pressed'] = 'true';
  h.api.sync();
  assert.equal(h.translate(), 3);
  assert.doesNotMatch(h.api.thumb.style.transform, /scale\(1\.0[1-9]/, 'no stretch');
});

test('pulling past an end stretches like rubber and squashes the bead, then it bounces back', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  h.fire('pointermove', {clientX: 300}); // far past the right end (last slot starts at 123)
  h.settle();
  const pulled = h.translate();
  assert.ok(pulled > 123 && pulled < 123 + 60 * .3 + .5, `moves past the end, but only a little (${pulled})`);
  assert.ok(h.api.state.sq > .1, 'squashed against the wall');
  const [sx, sy] = /scale\(([\d.]+), ([\d.]+)\)/.exec(h.api.thumb.style.transform).slice(1).map(Number);
  assert.ok(sy / sx > 1.1, 'narrower and taller');
  h.fire('pointerup', {clientX: 300});
  assert.deepEqual(h.clicks, ['大']);
  h.settle();
  assert.equal(h.translate(), 123, 'springs back onto Large');
  assert.equal(h.api.state.sq, 0, 'and un-squashes');
  // The left wall works the same way.
  h.fire('pointerdown', {clientX: 153}); h.fire('pointermove', {clientX: -200});
  h.settle();
  assert.ok(h.translate() < 3 && h.translate() > 3 - 60 * .3 - .5);
  h.fire('pointerup', {clientX: -200});
  assert.deepEqual(h.clicks, ['大', '小']);
  h.settle();
  assert.equal(h.translate(), 3);
  assert.equal(h.api.state.sq, 0);
});

test('settling overshoots a little before resting (springy)', () => {
  const h = segment();
  const positions = [];
  h.fire('pointerdown', {clientX: 33, target: h.buttons[0]});
  h.fire('pointerup', {clientX: 33, target: h.buttons[0]});
  h.fire('click', {target: h.buttons[0]});
  // Step the animation and record where the bead goes.
  for (let i = 0; i < 120; i++) { h.step(); positions.push(h.translate()); }
  assert.ok(Math.min(...positions) < 3 - 1, 'goes past the target');
  assert.equal(positions.at(-1), 3, 'and comes to rest on it');
});
