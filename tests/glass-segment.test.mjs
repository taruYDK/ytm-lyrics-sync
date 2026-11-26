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
  assert.ok(xs.some((x, i) => i > 0 && x < xs[i - 1] && xs[i - 1] === 123), 'rebounds from the wall');
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
  assert.ok(positions.some((x, i) => i > 0 && x > positions[i - 1] && positions[i - 1] === 3), 'bounces off the left wall');
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
