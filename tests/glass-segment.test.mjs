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
    setPointerCapture(id) { this.captured = id; }, getBoundingClientRect: () => ({left: 0})};
  const c = vm.createContext({
    document: {createElement: () => ({style: {}, hidden: false, setAttribute() {}})},
    playerFeedbackEnabled: () => motion,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() { frames.length = 0; },
  });
  vm.runInContext(source, c);
  const api = c.attachGlassSegment(group);
  const settle = (ms = 16) => { for (let i = 0; i < 400 && frames.length; i++) { now += ms; frames.shift()(now); } };
  const fire = (type, extra = {}) => { const e = {pointerId: 1, button: 0, target: extra.target || buttons[1], isTrusted: true, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...extra}; listeners[type](e); return e; };
  const step = () => { if (frames.length) { now += 16; frames.shift()(now); } };
  const step32 = () => { if (frames.length) { now += 32; frames.shift()(now); } };
  return {api, context: c, group, buttons, clicks, timers, settle, step, step32, fire, translate: () => Number(/translateX\(([-\d.]+)px\)/.exec(api.thumb.style.transform)[1])};
}

test('glass bead starts on the chosen size', () => {
  const h = segment();
  assert.equal(h.translate(), 63);
  assert.equal(h.api.thumb.style.width, '60px');
  assert.ok(h.group.classList.contains('ytmls-glass-segment'));
});

test('pressing lifts the bead at once; sliding moves it centered under the pointer and release picks the size there', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  assert.equal(h.group.captured, 1, 'the pointer is captured right away');
  assert.equal(h.group.dataset.dragging, 'true', 'pressing lifts it at once, before any move (like iOS)');
  assert.equal(h.timers.filter(Boolean).length, 0, 'no hold timer');
  h.fire('pointermove', {clientX: 140});
  h.fire('pointermove', {clientX: 160});
  h.settle();
  assert.ok(h.translate() > 100, 'follows the pointer');
  assert.ok(h.buttons[2].classList.contains('ytmls-seg-under'), 'the label under the bead is lifted');
  h.fire('pointerup', {clientX: 160});
  assert.deepEqual(h.clicks, ['大']);
  assert.equal(h.group.dataset.dragging, undefined);
  assert.ok(h.fire('click', {target: h.group}).stopped, 'the native click after a drag is swallowed');
  h.settle();
  assert.equal(h.translate(), 123);
});

test('a tap picks the size it was released on; holding still and letting go changes nothing else', () => {
  const tap = segment();
  tap.fire('pointerdown', {clientX: 33, target: tap.buttons[0]});
  tap.fire('pointerup', {clientX: 33, target: tap.group});
  assert.deepEqual(tap.clicks, ['小'], 'chosen by the tap itself (the captured pointer would not click)');
  assert.ok(tap.fire('click', {target: tap.group}).stopped, 'no second, native click');
  tap.settle();
  assert.equal(tap.translate(), 3, 'the bead slides to the tapped size');

  const still = segment();
  still.fire('pointerdown', {clientX: 93});
  still.fire('pointerup', {clientX: 93});
  assert.deepEqual(still.clicks, [], 'a tap on the chosen size keeps it');

  const cancelled = segment();
  cancelled.fire('pointerdown', {clientX: 93});
  cancelled.fire('pointermove', {clientX: 104});
  cancelled.fire('pointercancel');
  assert.deepEqual(cancelled.clicks, [], 'a cancelled drag changes nothing');
});

test('pulled past an end, the bead stays inside the track and squashes against the wall', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  h.fire('pointermove', {clientX: 300}); // far past the right end (last slot starts at 123)
  h.settle();
  assert.equal(h.translate(), 123, 'does not leave the track');
  assert.ok(h.api.state.sq > .1, 'squashed against the wall');
  assert.equal(h.api.thumb.style.transformOrigin, 'right center', 'pressed to the right wall');
  const [sx, sy] = /scale\(([\d.]+), ([\d.]+)\)/.exec(h.api.thumb.style.transform).slice(1).map(Number);
  assert.ok(sx < 1 && sy > 1 && sy <= 1.1, `narrower and a little taller (${sx}, ${sy})`);
  h.fire('pointerup', {clientX: 300});
  assert.deepEqual(h.clicks, ['大']);
  h.settle();
  assert.equal(h.translate(), 123);
  assert.equal(h.api.state.sq, 0, 'and un-squashes');
  // The left wall works the same way.
  h.fire('pointerdown', {clientX: 153}); h.fire('pointermove', {clientX: -200});
  h.settle();
  assert.equal(h.translate(), 3);
  assert.equal(h.api.thumb.style.transformOrigin, 'left center');
  h.fire('pointerup', {clientX: -200});
  assert.deepEqual(h.clicks, ['大', '小']);
});

test('a fast move into an end bounces off the wall inside the track', () => {
  const h = segment();
  const xs = [], squash = [];
  h.fire('pointerdown', {clientX: 93, target: h.buttons[1]}); h.fire('pointerup', {clientX: 93, target: h.buttons[1]});
  h.buttons[2].click(); h.api.sync(); // e.g. a tap on Large: the bead flies right
  for (let i = 0; i < 160; i++) { h.step(); xs.push(h.translate()); squash.push(h.api.state.sq); }
  assert.ok(Math.max(...xs) <= 123, 'never past the wall');
  assert.ok(Math.max(...squash) > .02, 'squashes on impact');
  // The bounce can happen between two frames, so look for: close to the wall, then back off it.
  const hit = xs.findIndex(x => x >= 121.5);
  assert.ok(hit >= 0 && xs.slice(hit).some(x => x < xs[hit] - 1), 'rebounds from the wall');
  assert.equal(xs.at(-1), 123);
});

test('settling into an end bounces back from the wall (springy)', () => {
  const h = segment();
  const positions = [];
  h.fire('pointerdown', {clientX: 33, target: h.buttons[0]});
  h.fire('pointerup', {clientX: 33, target: h.buttons[0]});
  h.fire('click', {target: h.buttons[0]});
  // Step the animation and record where the bead goes.
  for (let i = 0; i < 120; i++) { h.step(); positions.push(h.translate()); }
  assert.ok(Math.min(...positions) >= 3, 'stays inside the track');
  const hit = positions.findIndex(x => x <= 4.5);
  assert.ok(hit >= 0 && positions.slice(hit).some(x => x > positions[hit] + 1), 'bounces off the left wall');
  assert.equal(positions.at(-1), 3, 'and comes to rest on it');
});

test('settling between the walls overshoots a little before resting', () => {
  const h = segment();
  h.buttons[0].attrs['aria-pressed'] = 'true'; h.buttons[1].attrs['aria-pressed'] = 'false';
  h.api.sync(false);
  h.buttons[1].click(); h.fire('click', {target: h.buttons[1]});
  const xs = [];
  for (let i = 0; i < 160; i++) { h.step(); xs.push(h.translate()); }
  assert.ok(Math.max(...xs) > 63 + 1, 'passes Medium once');
  assert.equal(xs.at(-1), 63);
});

test('the bead goes under the finger: release picks the size under the pointer, wherever the bead was grabbed', () => {
  const h = segment();
  // Grab Medium near its left edge and slide so the finger is over Large.
  h.fire('pointerdown', {clientX: 66});
  h.fire('pointermove', {clientX: 150});
  h.settle();
  assert.ok(Math.abs(h.translate() + 30 - 150) < 2, 'centered under the pointer');
  h.fire('pointerup', {clientX: 150});
  assert.deepEqual(h.clicks, ['大']);
});

test('holding still on slow frames: the bead stays under the finger (no drift or shake)', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  const positions = [];
  for (let i = 0; i < 40; i++) { h.step32(); positions.push(h.translate()); }
  for (const x of positions.slice(5)) assert.ok(Math.abs(x - 63) < 1, `stays at 63 (${x})`);
});

test('診断情報 reports what the last drag did with the drop', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93, pointerType: 'mouse'});
  const report = vm.runInContext('glassLensReport.lastDrag', h.context);
  assert.match(report, /^mouse: no drop \(not allowed here\)$/, report);
  const panel = fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /`Glass lens: \$\{typeof glassLensDiagnostics === "function" \? glassLensDiagnostics\(\) : "n\/a"\}`/);
});

test('at a wall the drop squashes against the wall like the bead, and the bead steps aside', () => {
  const source = fs.readFileSync(new URL('../src/content/glass-segment.js', import.meta.url), 'utf8');
  assert.match(source, /if \(side === 'left'\) left = rect\.left \+ state\.x;\s*else if \(side === 'right'\) left = rect\.left \+ state\.x \+ state\.w - width;/);
  assert.match(source, /placeLens\(sx, sy, side\);/);
  const css = fs.readFileSync(new URL('../extension/liquid-glass.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-lens="true"\] > \.ytmls-seg-thumb \{ opacity: 0;/);
});
