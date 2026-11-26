import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../extension/details-motion.js', import.meta.url), 'utf8');

function page({protocol = 'chrome-extension:', reduced = false, lightweight = false, id = ''} = {}) {
  let click; const animations = [];
  const anim = (target, keyframes, options) => {
    let resolve, reject; const a = {target, keyframes, options, finished: new Promise((r, j) => { resolve = r; reject = j; })};
    a.finished.catch(() => {});
    a.finish = () => resolve(); a.cancel = () => { a.cancelled = true; reject(new Error('cancel')); };
    animations.push(a); return a;
  };
  const summary = {getBoundingClientRect: () => ({height: 44})};
  const body = {animate: (k, o) => anim(body, k, o), getAnimations: () => animations.filter(a => a.target === body && !a.cancelled)};
  const details = {tagName: 'DETAILS', open: false, dataset: {}, style: {removeProperty(k) { delete this[k]; }}, children: [summary, body], id,
    getBoundingClientRect() { return {height: this.open ? 160 : 46}; },
    querySelector: () => summary, matches: sel => sel === '#ytmls-more' ? id === 'ytmls-more' : true,
    animate: (k, o) => anim(details, k, o)};
  summary.parentElement = details;
  summary.closest = () => summary;
  const context = {location: {protocol}, matchMedia: () => ({matches: reduced}), getComputedStyle: () => ({paddingTop: '0', paddingBottom: '0', borderTopWidth: '1px', borderBottomWidth: '1px'}),
    document: {documentElement: {classList: {contains: c => lightweight && c === 'ytmls-lyrics-motion-lightweight'}}, addEventListener: (type, fn) => { click = fn; }}};
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const press = () => { const e = {target: summary, prevented: false, preventDefault() { this.prevented = true; }}; click(e); return e; };
  return {details, body, animations, press};
}

test('a section grows open from its summary and its contents fade in', async () => {
  const h = page();
  assert.ok(h.press().prevented);
  assert.equal(h.details.open, true);
  const fold = h.animations[0];
  assert.deepEqual([...fold.keyframes.height], ['46px', '160px']);
  assert.equal(h.details.style.overflow, 'hidden');
  assert.equal(h.animations[1].target, h.body);
  fold.finish(); await fold.finished; await null;
  assert.equal(h.details.style.overflow, undefined);
});

test('closing folds to the summary first and only then closes; the marker turns at once', async () => {
  const h = page(); h.details.open = true;
  h.press();
  assert.equal(h.details.open, true, 'stays open while folding');
  assert.equal(h.details.dataset.closing, 'true');
  const fold = h.animations[0];
  assert.deepEqual([...fold.keyframes.height], ['160px', '46px'], 'summary 44px + borders');
  fold.finish(); await fold.finished; await null;
  assert.equal(h.details.open, false);
  assert.equal(h.details.dataset.closing, undefined);
});

test('a click during the motion reverses it and the contents are not left hidden', async () => {
  const h = page(); h.details.open = true;
  h.press(); // start closing
  const closingFade = h.animations[1];
  h.press(); // reverse
  assert.equal(h.animations[0].cancelled, true);
  assert.equal(closingFade.cancelled, true, 'the closing fade is dropped');
  assert.equal(h.details.open, true);
  assert.equal(h.details.dataset.closing, undefined);
});

test('the その他 menu, reduced motion and lightweight mode keep the plain toggle', () => {
  assert.equal(page({protocol: 'https:', id: 'ytmls-more'}).press().prevented, false);
  assert.equal(page({reduced: true}).press().prevented, false);
  assert.equal(page({protocol: 'https:', lightweight: true}).press().prevented, false);
});

test('loaded on YouTube Music and on both extension pages', () => {
  const read = name => fs.readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8');
  assert.ok(JSON.parse(read('manifest.json')).content_scripts.some(entry => entry.js?.includes('details-motion.js')));
  for (const page of ['popup.html', 'backup.html']) assert.match(read(page), /<script src="details-motion\.js"><\/script>/);
});
