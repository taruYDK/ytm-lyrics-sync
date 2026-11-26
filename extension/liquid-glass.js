// Liquid Glass: SVG lens filters that bend the backdrop near the edges of glass surfaces,
// like the rounded rim of a thick piece of glass. The CSS uses them only once
// html.ytmls-lg-lens is set, so a page without them keeps the plain blur.
(() => {
  'use strict';
  if (window.__ytmlsLiquidGlass) return;
  window.__ytmlsLiquidGlass = true;
  try { if (!CSS.supports('backdrop-filter', 'url(#ytmls-lg-lens) blur(1px)')) return; } catch (_) { return; }

  // Displacement map: red bends horizontally and green vertically. A full-range gradient
  // gives every edge its inward direction (corners included); a blurred mid-grey rounded
  // rectangle on top leaves the middle untouched, so the bend grows smoothly toward the rim.
  function lensMap(inset, radius, softness) {
    const size = 100 - inset * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
      `<defs><linearGradient id="x"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>` +
      `<linearGradient id="y" x2="0" y2="1"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#000"/></linearGradient>` +
      `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${softness}"/></filter></defs>` +
      `<rect width="100" height="100" fill="#000"/>` +
      `<rect width="100" height="100" fill="url(#x)"/>` +
      `<rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>` +
      `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="#808000" filter="url(#b)"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, children = []) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, String(value));
    node.append(...children);
    return node;
  }
  const displace = (scale, result) => el('feDisplacementMap', {in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result});
  const channel = (input, row, result) => el('feColorMatrix', {in: input, type: 'matrix', values: row, result});

  // spread > 0 bends red, green and blue by slightly different amounts: a faint color fringe at the rim.
  function lensFilter(id, map, scale, spread = 0) {
    const base = {id, x: 0, y: 0, width: 1, height: 1, primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB'};
    const image = el('feImage', {href: map, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'none', result: 'map'});
    if (!spread) return el('filter', base, [image, displace(scale)]);
    return el('filter', base, [
      image,
      displace(scale * (1 + spread), 'dr'), displace(scale, 'dg'), displace(scale * (1 - spread), 'db'),
      channel('dr', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r'),
      channel('dg', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g'),
      channel('db', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b'),
      el('feBlend', {in: 'r', in2: 'g', mode: 'screen', result: 'rg'}),
      el('feBlend', {in: 'rg', in2: 'b', mode: 'screen'}),
    ]);
  }

  function install() {
    if (document.getElementById('ytmls-lg-filters')) return;
    const svg = el('svg', {id: 'ytmls-lg-filters', 'aria-hidden': 'true', width: 0, height: 0}, [
      // Menus and panes: a narrow rim, so text in the middle stays straight.
      lensFilter('ytmls-lg-lens', lensMap(9, 14, 4), 0.07),
      // Buttons: the whole capsule acts as a lens, with a faint color fringe.
      lensFilter('ytmls-lg-lens-pill', lensMap(22, 30, 9), 0.34, 0.08),
    ]);
    svg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
    document.documentElement.append(svg);
    document.documentElement.classList.add('ytmls-lg-lens');
  }
  install();
  // YouTube Music rebuilds parts of the page; put the filters back if they are removed.
  new MutationObserver(() => { if (!document.getElementById('ytmls-lg-filters')) install(); })
    .observe(document.documentElement, {childList: true});
})();
