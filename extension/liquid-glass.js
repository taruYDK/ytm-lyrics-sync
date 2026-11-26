// Liquid Glass: SVG lens filters that bend the backdrop near the edges of glass surfaces.
// The CSS uses them only once html.ytmls-lg-lens is set, so a page without them keeps plain blur.
(() => {
  'use strict';
  if (window.__ytmlsLiquidGlass) return;
  window.__ytmlsLiquidGlass = true;
  try { if (!CSS.supports('backdrop-filter', 'url(#ytmls-lg-lens) blur(1px)')) return; } catch (_) { return; }
  // Red bends horizontally and green vertically; mid-grey (0.5) in the middle leaves the center untouched.
  const MAPS = {
    surface: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20100%20100%22%20preserveAspectRatio%3D%22none%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22x%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f00%22/%3E%3Cstop%20offset%3D%220.07%22%20stop-color%3D%22%23800000%22/%3E%3Cstop%20offset%3D%220.93%22%20stop-color%3D%22%23800000%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23000%22/%3E%3C/linearGradient%3E%3ClinearGradient%20id%3D%22y%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%230f0%22/%3E%3Cstop%20offset%3D%220.07%22%20stop-color%3D%22%23008000%22/%3E%3Cstop%20offset%3D%220.93%22%20stop-color%3D%22%23008000%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23000%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23x%29%22/%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23y%29%22%20style%3D%22mix-blend-mode%3Ascreen%22/%3E%3C/svg%3E',
    pill: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20100%20100%22%20preserveAspectRatio%3D%22none%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22x%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23f00%22/%3E%3Cstop%20offset%3D%220.22%22%20stop-color%3D%22%23800000%22/%3E%3Cstop%20offset%3D%220.78%22%20stop-color%3D%22%23800000%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23000%22/%3E%3C/linearGradient%3E%3ClinearGradient%20id%3D%22y%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%230f0%22/%3E%3Cstop%20offset%3D%220.34%22%20stop-color%3D%22%23008000%22/%3E%3Cstop%20offset%3D%220.66%22%20stop-color%3D%22%23008000%22/%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23000%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23x%29%22/%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22url%28%23y%29%22%20style%3D%22mix-blend-mode%3Ascreen%22/%3E%3C/svg%3E',
  };
  const NS = 'http://www.w3.org/2000/svg';
  function filter(id, map, scale) {
    const el = document.createElementNS(NS, 'filter');
    el.id = id;
    for (const [key, value] of Object.entries({x: '0', y: '0', width: '1', height: '1', primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB'})) el.setAttribute(key, value);
    const image = document.createElementNS(NS, 'feImage');
    for (const [key, value] of Object.entries({href: map, x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'map'})) image.setAttribute(key, value);
    const displace = document.createElementNS(NS, 'feDisplacementMap');
    for (const [key, value] of Object.entries({in: 'SourceGraphic', in2: 'map', scale: String(scale), xChannelSelector: 'R', yChannelSelector: 'G'})) displace.setAttribute(key, value);
    el.append(image, displace);
    return el;
  }
  function install() {
    if (document.getElementById('ytmls-lg-filters')) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'ytmls-lg-filters';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.append(filter('ytmls-lg-lens', MAPS.surface, 0.035), filter('ytmls-lg-lens-pill', MAPS.pill, 0.12));
    document.documentElement.append(svg);
    document.documentElement.classList.add('ytmls-lg-lens');
  }
  install();
  // YouTube Music rebuilds parts of the page; put the filters back if they are removed.
  new MutationObserver(() => { if (!document.getElementById('ytmls-lg-filters')) install(); })
    .observe(document.documentElement, {childList: true});
})();
