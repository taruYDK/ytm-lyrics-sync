import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8');

function lensHarness(supported) {
  const byId = {}; const classes = new Set(); let observer;
  const node = tag => ({tag, attrs: {}, children: [], style: {}, setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; }, append(...c) { this.children.push(...c); }});
  const documentElement = {classList: {add: c => classes.add(c), contains: c => classes.has(c)}, append(el) { byId[el.id] = el; }};
  const document = {documentElement, createElementNS: (ns, tag) => node(tag), getElementById: id => byId[id] || null};
  const window = {};
  vm.runInNewContext(read('liquid-glass.js'), {window, document, CSS: {supports: () => supported},
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }});
  return {byId, classes, reinstall: () => { delete byId['ytmls-lg-filters']; observer(); }, pageRewritesClasses: () => { classes.clear(); observer(); }};
}

test('Liquid Glass installs the lens filters once and puts them back when the page removes them', () => {
  const h = lensHarness(true);
  const svg = h.byId['ytmls-lg-filters'];
  assert.ok(svg);
  assert.deepEqual(svg.children.map(f => f.id), ['ytmls-lg-lens', 'ytmls-lg-lens-pill', 'ytmls-lg-lens-drop']);
  for (const filter of svg.children) {
    assert.equal(filter.attrs.primitiveUnits, 'objectBoundingBox');
    assert.equal(filter.children[0].tag, 'feImage');
    assert.match(filter.children[0].attrs.href, /^data:image\/svg\+xml,/);
    assert.ok(filter.children.some(c => c.tag === 'feDisplacementMap'));
  }
  const [surface, pill, drop] = svg.children;
  assert.equal(drop.children.filter(c => c.tag === 'feDisplacementMap').length, 3, 'the drag drop splits colors at its rim');
  assert.equal(surface.children.length, 2, 'menus bend once: cheap over large areas');
  assert.equal(pill.children.filter(c => c.tag === 'feDisplacementMap').length, 3, 'buttons get a faint color fringe');
  const map = decodeURIComponent(surface.children[0].attrs.href);
  assert.match(map, /fill="#808000" fill-opacity="1" filter="url\(#b\)"/, 'the middle stays straight');
  const dropMap = decodeURIComponent(drop.children[0].attrs.href);
  assert.doesNotMatch(dropMap, /#808000/, 'the drop magnifies evenly (no flat middle, so nothing smears)');
  assert.match(dropMap, /stop-color="#00b900"/, 'with a weaker vertical bend for its wide shape');
  assert.ok(h.classes.has('ytmls-lg-lens'));
  h.reinstall();
  assert.ok(h.byId['ytmls-lg-filters'], 'reinstalled');
  h.pageRewritesClasses();
  assert.ok(h.classes.has('ytmls-lg-lens'), 'the class comes back when the page rewrites <html> classes');
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
  assert.ok(lensRules.length >= 2);
  for (const [, selector] of lensRules) assert.match(selector.trim(), /^html\.ytmls-lg-lens /, 'lens only after the filters exist');
  assert.match(css, /html\.ytmls-lyrics-motion-lightweight :is\([^{]+\{\s*--lg-fill: var\(--lg-fill-solid\);\s*--lg-fill-pill: var\(--lg-fill-solid\);\s*--lg-pill-fill: linear-gradient\(var\(--lg-fill-solid\), var\(--lg-fill-solid\)\);\s*-webkit-backdrop-filter: none !important; backdrop-filter: none !important;/);
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

test('header pills: one thin rim, a drawn chevron that turns over, and the count as a badge', () => {
  const css = read('liquid-glass.css');
  assert.match(css, /background: var\(--lg-pill-fill\) padding-box !important;/, 'clear fill only');
  assert.match(css, /::before \{\s*content: ""; position: absolute; inset: -1px; padding: 1px;[^}]*background: var\(--lg-pill-rim\);[^}]*mask:/, 'the rim is a masked ring, so glints never show through');
  assert.match(css, /--lg-pill-rim: var\(--lg-glint\);/);
  assert.match(css, /--lg-glint: conic-gradient\(/, 'two glints: top-left and bottom-right');
  assert.match(css, /#ytmls-more > summary\.ytmls-tool-button::after \{\s*content: "" !important;[^}]*mask:/);
  assert.match(css, /#ytmls-more\[open\]:not\(\[data-closing="true"\]\) > summary\.ytmls-tool-button::after \{ transform: rotate\(180deg\); \}/);
  assert.match(css, /#ytmls-tools \.ytmls-count \{/);
  const panel = fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /candidateButtonEl\.replaceChildren\("歌詞候補 ", badge\);/);
  assert.match(panel, /setAttribute\("aria-label", `歌詞候補 \$\{count\}件`\)/);
});

test('the その他 button is a header pill, not a chip inside the menu (same glass as 歌詞候補)', () => {
  const css = read('liquid-glass.css');
  // The chip rules for controls inside the menu match .ytmls-tool-button; the summary is excluded.
  const chip = '.ytmls-tool-button:not(.ytmls-menu-group > .ytmls-tool-button):not(.ytmls-reading-primary):not(.ytmls-size-presets > *)';
  assert.equal(css.split(chip).length - 1, css.split(chip + ':not(summary)').length - 1);
  assert.equal(css.split(chip + ':not(summary)').length - 1, 2);
  assert.ok(css.includes('.ytmls-tools-close, .ytmls-tool-button:not(summary), .ytmls-candidate-pin,'));
});

test('その他 menu: rim on the menu, a scrolling body inside, regular rows with line icons', () => {
  const css = read('liquid-glass.css');
  assert.match(css, /#ytmls-more > \.ytmls-more-menu::before \{[^}]*background: var\(--lg-glint\);[^}]*mask:/);
  assert.match(css, /#ytmls-more \.ytmls-more-body \{[^}]*overflow-y: auto;/);
  assert.match(css, /font-weight: 500 !important;/);
  for (const name of ['sliders', 'expand', 'book', 'clock', 'search', 'plus', 'pencil', 'ruby', 'download', 'info']) assert.ok(css.includes(`[data-icon="${name}"]`), name);
  const panel = fs.readFileSync(new URL('../src/content/lyrics-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /menuBody\.className = "ytmls-more-body";\s*menuBody\.append\(displayGroup, playbackGroup, lyricsGroup, storageGroup\);\s*menu\.append\(menuBody\);/);
});
