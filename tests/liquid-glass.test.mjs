import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8');

function lensHarness(supported) {
  const byId = {}; const classes = new Set(); let observer;
  const node = tag => ({tag, attrs: {}, children: [], style: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, set id(v) { this._id = v; }, get id() { return this._id; }});
  const documentElement = {classList: {add: c => classes.add(c)}, append(el) { byId[el.id] = el; }};
  const document = {documentElement, createElementNS: (ns, tag) => node(tag), getElementById: id => byId[id] || null};
  const window = {};
  vm.runInNewContext(read('liquid-glass.js'), {window, document, CSS: {supports: () => supported},
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }});
  return {byId, classes, reinstall: () => { delete byId['ytmls-lg-filters']; observer(); }};
}

test('Liquid Glass installs the lens filters once and puts them back when the page removes them', () => {
  const h = lensHarness(true);
  const svg = h.byId['ytmls-lg-filters'];
  assert.ok(svg);
  assert.deepEqual(svg.children.map(f => f.id), ['ytmls-lg-lens', 'ytmls-lg-lens-pill']);
  for (const filter of svg.children) {
    assert.equal(filter.attrs.primitiveUnits, 'objectBoundingBox');
    assert.deepEqual(filter.children.map(c => c.tag), ['feImage', 'feDisplacementMap']);
    assert.match(filter.children[0].attrs.href, /^data:image\/svg\+xml,/);
  }
  assert.ok(h.classes.has('ytmls-lg-lens'));
  h.reinstall();
  assert.ok(h.byId['ytmls-lg-filters'], 'reinstalled');
  const unsupported = lensHarness(false);
  assert.equal(unsupported.byId['ytmls-lg-filters'], undefined);
  assert.equal(unsupported.classes.size, 0, 'plain blur stays when the browser cannot use the lens');
});

test('Liquid Glass styles load last and fall back to solid surfaces', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const last = manifest.content_scripts.at(-1);
  assert.equal(last.css.at(-1), 'liquid-glass.css');
  assert.ok(last.js.includes('liquid-glass.js'));
  const css = read('liquid-glass.css');
  const lensRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => body.includes('url(#ytmls-lg-lens'));
  assert.equal(lensRules.length, 2);
  for (const [, selector] of lensRules) assert.match(selector.trim(), /^html\.ytmls-lg-lens /, 'lens only after the filters exist');
  assert.match(css, /html\.ytmls-lyrics-motion-lightweight :is\([^{]+\{\s*--lg-fill: var\(--lg-fill-solid\);\s*-webkit-backdrop-filter: none !important; backdrop-filter: none !important;/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /#ytmls-reading-edit/, 'that id is the menu button, not a surface');
});

test('settings and backup pages use the shared glass and keep switches readable', () => {
  for (const [page, before] of [['popup.html', 'popup-apple.css'], ['backup.html', 'backup-apple.css']]) {
    const html = read(page);
    assert.ok(html.indexOf('pages-glass.css') > html.indexOf(before), `${page} loads the glass after ${before}`);
  }
  const css = read('pages-glass.css');
  assert.match(css, /input:checked \+ \.slider \{ background: var\(--accent\) !important;/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
});
