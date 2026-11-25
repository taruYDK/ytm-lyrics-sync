import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(pageOpen) {
  const handlers = {}, appended = [];
  const layout = {hasAttribute: name => pageOpen && name === 'player-page-open'};
  const document = {
    documentElement: {classList: {contains: () => false}},
    querySelector: selector => selector === 'ytmusic-app-layout' ? layout : null,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    createElement: () => ({style: {}, setAttribute() {}, animate: () => ({finished: Promise.resolve()}), remove() {}}),
    getElementById: () => null,
    body: {append: el => appended.push(el)},
    hidden: false,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../extension/extra-motion.js', import.meta.url), 'utf8'),
    {document, matchMedia: () => ({matches: false}), getComputedStyle: () => ({borderRadius: '0px'}), MutationObserver: class { observe() {} disconnect() {} }, setInterval() {}, setTimeout, clearTimeout, requestAnimationFrame() {}});
  const cover = src => ({matches: s => s === 'ytmusic-player #song-image img', currentSrc: src, src, getBoundingClientRect: () => ({left: 400, top: 200, width: 500, height: 500})});
  handlers.load({target: cover('https://i.ytimg.com/a.jpg')});
  handlers.load({target: cover('https://i.ytimg.com/b.jpg')});
  return appended;
}

test('cover cross-fade is drawn only while the player page is open', () => {
  assert.equal(harness(false).length, 0);
  assert.equal(harness(true).length, 1);
});
