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
  return {api, group, buttons, clicks, timers, settle, fire, translate: () => Number(/translateX\(([-\d.]+)px\)/.exec(api.thumb.style.transform)[1])};
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

test('dragging the bead itself starts without waiting; a short tap stays a normal button', () => {
  const h = segment();
  h.fire('pointerdown', {clientX: 93});
  h.fire('pointermove', {clientX: 104});
  assert.equal(h.group.dataset.dragging, 'true', 'moving the bead drags at once');
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
