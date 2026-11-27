import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');

test('Mac Music-style screen loads on YouTube Music, before the glass styles', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const entry = manifest.content_scripts.find(item => item.css?.includes('apple-shell.css'));
  assert.ok(entry, 'apple-shell.css is loaded');
  assert.equal(entry.css.at(-1), 'liquid-glass.css');
  assert.ok(entry.js.includes('apple-shell.js'));
});

test('YouTube Music chrome keeps its space and is hidden only while the screen is on', () => {
  const css = read('apple-shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hide = css.match(/([^{}]+)\{\s*visibility:\s*hidden !important;\s*\}/);
  assert.ok(hide, 'hidden with visibility (layout unchanged), not display:none');
  for (const part of ['ytmusic-nav-bar', 'tp-yt-app-drawer#guide', 'ytmusic-player-bar']) assert.match(hide[1], new RegExp(`html\\.ytmls-am ${part.replace('#', '\\#')}`));
  assert.doesNotMatch(css, /ytmusic-[a-z-]+[^{}]*\{[^}]*display:\s*none/);
  assert.match(css, /#ytmls-am \{ display: none; \}/);
});

function runShell({nav = null, bar = null, stored = {}} = {}) {
  const classes = new Set();
  const props = {};
  const root = {
    classList: {add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c)},
    style: {setProperty: (k, v) => { props[k] = v; }},
  };
  const document = {
    readyState: 'complete', documentElement: root, hidden: false, fullscreenElement: null,
    querySelector: selector => selector === 'ytmusic-nav-bar' ? nav : selector === 'ytmusic-player-bar' ? bar : null,
    querySelectorAll: () => [], addEventListener() {},
    createElement: () => { throw new Error('built'); },
  };
  const chrome = {storage: {
    sync: {get: (d, cb) => cb({enabled: true})},
    local: {get: (d, cb) => cb({...d, ...stored})},
    onChanged: {addListener() {}},
  }};
  let built = false;
  try {
    vm.runInNewContext(read('apple-shell.js'), {document, chrome, location: {pathname: '/'}, setInterval() {}, setTimeout() {}, requestAnimationFrame: fn => fn(), addEventListener() {}, window: {addEventListener() {}}});
  } catch (error) { if (error.message === 'built') built = true; else throw error; }
  return {classes, props, built};
}

test('without YouTube Music\'s top bar or player bar the page is left alone', () => {
  const result = runShell();
  assert.equal(result.classes.has('ytmls-am'), false);
  assert.equal(result.built, false);
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  const onlyNav = runShell({nav: {getBoundingClientRect: () => rect}});
  assert.equal(onlyNav.classes.has('ytmls-am'), false);
});

test('switched off in settings: nothing is built', () => {
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  const result = runShell({nav: {getBoundingClientRect: () => rect}, bar: {}, stored: {appleShellEnabled: false}});
  assert.equal(result.built, false);
  assert.equal(result.classes.has('ytmls-am'), false);
});

test('settings page has the switch, saved as appleShellEnabled', () => {
  const html = read('popup.html');
  assert.match(html, /id="appleShellToggle"/);
  assert.match(html, /<script src="apple-shell-popup.js"><\/script>/);
  const writes = [];
  const toggle = {checked: false, disabled: false, addEventListener(name, fn) { this[name] = fn; }};
  const chrome = {runtime: {}, storage: {local: {get: (d, cb) => cb(d), set: (v, cb) => { writes.push(v); cb(); }}, onChanged: {addListener() {}}}};
  vm.runInNewContext(read('apple-shell-popup.js'), {chrome, document: {getElementById: id => id === 'appleShellToggle' ? toggle : {textContent: ''}}});
  assert.equal(toggle.checked, true, 'on by default');
  toggle.checked = false; toggle.change();
  assert.equal(JSON.stringify(writes), JSON.stringify([{appleShellEnabled: false}]));
});

test('with YouTube Music\'s top bar and player bar present, the screen is built', () => {
  const rect = {width: 1000, height: 64, right: 1000, left: 0, bottom: 64};
  assert.equal(runShell({nav: {getBoundingClientRect: () => rect}, bar: {}}).built, true);
});

test('the lyrics timing buttons move into the menu while YouTube Music\'s player bar is hidden', () => {
  const src = fs.readFileSync(new URL('../src/content/timing-offset.js', import.meta.url), 'utf8');
  assert.match(src, /classList\.contains\('ytmls-am'\)/);
});
