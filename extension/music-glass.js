(() => {
  'use strict';
  const defaults = { musicGlassEnabled: true, musicGlassArtwork: true, musicGlassIntensity: 65, musicGlassHideScrollbar: false, musicGlassHideDislike: false, musicGlassLightweight: false };
  const root = document.documentElement;
  let settings = { ...defaults };
  let extensionEnabled = true;
  const themeEnabled = () => extensionEnabled && settings.musicGlassEnabled;
  let backdrop;
  let timer;
  let generation = 0;
  let artworkRevision = 0;
  let lastArt = '';
  let artworkReady = false;
  const surfaces = new Map();
  let surfaceFrame = 0;
  function scheduleSurfacePaint() {
    if (!themeEnabled() || document.hidden || surfaceFrame) return;
    if (typeof requestAnimationFrame !== 'function') { paintSurfaces(); return; }
    surfaceFrame = requestAnimationFrame(() => { surfaceFrame = 0; paintSurfaces(); });
  }
  const surfaceResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleSurfacePaint) : null;
  let artworkHost;
  let artworkObserver;
  function artworkLoaded(event) {
    if (event.target?.tagName === 'IMG') update();
  }
  function watchArtwork() {
    const host = document.querySelector?.('ytmusic-player-bar');
    if (!host?.addEventListener || host === artworkHost || typeof MutationObserver === 'undefined') return;
    artworkObserver?.disconnect();
    artworkHost?.removeEventListener('load', artworkLoaded, true);
    artworkHost = host;
    host.addEventListener('load', artworkLoaded, true);
    artworkObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' && record.target.tagName === 'IMG' ||
          record.type === 'childList' && [...record.addedNodes].some(node => node.tagName === 'IMG' || node.querySelector?.('img')))) update();
    });
    // Observe only the player bar, never the scrolling home or lyrics tree.
    artworkObserver.observe(host, {subtree:true, childList:true, attributes:true, attributeFilter:['src','srcset']});
  }
  function fadeOldCanvas(canvas, host, backdropSurface = false) {
    if (!canvas?.cloneNode || !host?.appendChild || !canvas.width || !canvas.height || !canvas.dataset?.paint) return;
    if (root.classList.contains('ytmls-extra-motion-disabled') || root.classList.contains('ytmls-lyrics-motion-lightweight') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const old = canvas.cloneNode(false); old.removeAttribute('id');old.setAttribute('aria-hidden','true');
    if (backdropSurface) Object.assign(old.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'-1',pointerEvents:'none'});
    const ctx=old.getContext('2d');if(!ctx||!old.animate)return;
    ctx.drawImage(canvas,0,0);host.appendChild(old);
    const animation=old.animate([{opacity:Math.max(0,Math.min(100,Number(settings.musicGlassIntensity)||0))/100},{opacity:0}],{duration:260,easing:'ease-out'});
    animation.finished.catch(()=>{}).finally(()=>old.remove());
  }
  function paintSurfaces(tabsOnly = false) {
    if (!themeEnabled()) return;
    const width = globalThis.innerWidth, height = globalThis.innerHeight;
    if (!width || !height) return;
    const selectors = ['ytmusic-nav-bar', 'ytmusic-player-bar', 'ytmusic-player-page', 'ytmusic-browse-response ytmusic-tabs', ':is(ytmusic-search-page, ytmusic-tabbed-search-results-renderer) ytmusic-tabs'];
    for (const selector of tabsOnly === true ? selectors.slice(3) : selectors) {
      const host = document.querySelector(selector);
      if (!host?.prepend || !host.getBoundingClientRect) continue;
      let canvas = surfaces.get(host);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'music-glass-surface';
        canvas.width = 192; canvas.height = 192;
        canvas.setAttribute('aria-hidden', 'true');
        host.prepend(canvas); surfaces.set(host, canvas);
        surfaceResizeObserver?.observe(host);
      }
      // Layout coordinates do not move with the native opening transform.
      // Sampling a transitioning rectangle can crop outside the bitmap and cache
      // transparent/black strips until the next poll.
      let left = 0, top = 0;
      for (let node = host; node; node = node.offsetParent) {
        left += node.offsetLeft || 0;
        top += node.offsetTop || 0;
      }
      const isTabs = selector === 'ytmusic-browse-response ytmusic-tabs' || selector === ':is(ytmusic-search-page, ytmusic-tabbed-search-results-renderer) ytmusic-tabs';
      const bounds = isTabs ? host.getBoundingClientRect() : {left, top, width:host.clientWidth, height:host.clientHeight};
      if (isTabs) { left = bounds.left; top = bounds.top; }
      if (!bounds.width || !bounds.height) continue;
      const sx = Math.max(0, Math.min(95, left / width * 96));
      const sy = Math.max(0, Math.min(95, top / height * 96));
      const sw = Math.max(1, Math.min(96 - sx, bounds.width / width * 96));
      const sh = Math.max(1, Math.min(96 - sy, bounds.height / height * 96));
      const signature = [artworkRevision, artworkReady, width, height, sx, sy, sw, sh].join(':');
      if (canvas.dataset.paint === signature) continue;
      if (canvas.dataset.artworkRevision && canvas.dataset.artworkRevision !== String(artworkRevision)) fadeOldCanvas(canvas, host);
      canvas.dataset.paint = signature;
      canvas.dataset.artworkRevision = String(artworkRevision);
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 192, 192);
      if (artworkReady && backdrop && bounds.width > 0 && bounds.height > 0) {
        context.drawImage(backdrop, sx, sy, sw, sh, 0, 0, 192, 192);
      }
    }
    for (const [host, canvas] of surfaces) if (!host.isConnected) { surfaceResizeObserver?.unobserve(host); canvas.remove(); surfaces.delete(host); }
    if (tabsOnly !== true) ensureAurora();
  }
  let tabsFrame = false;
  document.addEventListener('scroll', event => {
    if (tabsFrame || !themeEnabled() || document.hidden || typeof requestAnimationFrame !== 'function') return;
    // Only scrolling of a page that has these tabs matters. The lyrics scroll by themselves on every
    // line while a song plays: measuring the tabs on each of those frames made the browser lay the
    // page out every frame (the main reason playing felt heavier than paused).
    const target = event.target?.nodeType === 1 ? event.target : null;
    if (target?.closest?.('ytmusic-player-page, [id^="ytmls-"], ytmusic-player-bar')) return;
    if (document.querySelector('ytmusic-app-layout[player-page-open]')) return;
    tabsFrame = true;
    requestAnimationFrame(() => { tabsFrame = false; paintSurfaces(true); });
  }, {capture:true, passive:true});
  globalThis.addEventListener?.('resize', scheduleSurfacePaint);
  document.addEventListener('transitionend', event => {
    if (event.target?.matches?.('ytmusic-app-layout, ytmusic-player-page, ytmusic-nav-bar, #guide-wrapper, #mini-guide-background')) scheduleSurfacePaint();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSurfacePaint(); });
  document.addEventListener('yt-navigate-finish', paintSurfaces);
  const artSelectors = [
    'ytmusic-player-bar .thumbnail-image-wrapper img',
    'ytmusic-player-bar img.image',
    'ytmusic-player-bar img',
    'ytmusic-player #song-image img'
  ];
  function safeImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  // Three soft colors (top-left, center, bottom-right of the cover) for the drifting haze.
  function setAuroraPalette(pixels) {
    const region = (x0, y0, x1, y1) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = (y * 96 + x) * 4; r += pixels[i]; g += pixels[i+1]; b += pixels[i+2]; n++;
      }
      const avg = [r / n, g / n, b / n], mean = (avg[0] + avg[1] + avg[2]) / 3;
      // Slightly more saturated and a little darker, so the haze tints rather than brightens.
      return avg.map(v => Math.max(0, Math.min(255, Math.round((mean + (v - mean) * 1.5) * 0.8)))).join(' ');
    };
    root.style.setProperty('--mg-aurora-1', region(0, 0, 40, 40));
    root.style.setProperty('--mg-aurora-2', region(28, 28, 68, 68));
    root.style.setProperty('--mg-aurora-3', region(56, 56, 96, 96));
  }
  // Without readable pixels (or artwork), fall back to the neutral haze instead of the last song's colors.
  function clearAuroraPalette() {
    for (const key of ['--mg-aurora-1', '--mg-aurora-2', '--mg-aurora-3']) root.style.removeProperty(key);
  }
  // The haze lives in the player page, above its surface bitmap and below the content.
  let aurora;
  function ensureAurora() {
    const page = document.querySelector?.('ytmusic-player-page');
    if (!themeEnabled() || settings.musicGlassLightweight || !page?.prepend) { aurora?.remove(); aurora = null; return; }
    if (!aurora) {
      aurora = document.createElement('div');
      aurora.className = 'music-glass-aurora';
      aurora.setAttribute('aria-hidden', 'true');
    }
    if (aurora.parentNode !== page) {
      const surface = surfaces.get(page);
      if (surface?.after) surface.after(aurora); else page.prepend(aurora);
    }
  }
  // Mean luminance above the target is reduced with a light black layer (at most 25%).
  function backdropShadeAlpha(pixels) {
    let sum = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 16) { sum += (0.2126*pixels[i] + 0.7152*pixels[i+1] + 0.0722*pixels[i+2]) / 255; count++; }
    const luma = count ? sum / count : 0;
    const target = 0.4;
    return luma > target ? Math.min(0.25, 1 - target / luma) : 0;
  }
  function update() {
    if (document.hidden) return;
    watchArtwork();
    paintSurfaces();
    if (document.hidden || !themeEnabled() || !settings.musicGlassArtwork || settings.musicGlassLightweight) return;
    const page = document.body;
    if (!page) return;
    if (!backdrop || backdrop.parentNode !== page) {
      backdrop?.remove();
      backdrop = document.createElement('canvas');
      backdrop.width = 96; backdrop.height = 96;
      backdrop.id = 'music-glass-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      page.prepend(backdrop);
      lastArt = '';
    }
    let art = '';
    if (settings.musicGlassArtwork) {
      for (const selector of artSelectors) {
        const img = document.querySelector(selector);
        art = safeImage((img?.srcset ? img.currentSrc : img?.src) || img?.currentSrc || '');
        if (art) break;
      }
    }
    if (art !== lastArt) {
      lastArt = art;
      root.style.removeProperty("--ytmls-art-accent");
      // Keep the previous frame until the replacement image has decoded.
      const token = ++generation;
      const canvas = backdrop;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (art) {
        function loadArtwork(cors) {
        const image = new Image();
        if (cors) image.crossOrigin = "anonymous";
        image.onerror = () => { if (token !== generation || backdrop !== canvas) return; root.style.removeProperty("--ytmls-art-accent"); if (cors) loadArtwork(false); };
        image.onload = () => {
          if (token !== generation || backdrop !== canvas) return;
          // Bake blur into a tiny bitmap once per cover, not a viewport filter.
          const side = Math.min(image.naturalWidth, image.naturalHeight);
          if (!side) return;
          if (artworkReady) { canvas.dataset.paint = '1'; fadeOldCanvas(canvas, page, true); }
          canvas.width = 96; canvas.height = 96;
          context.clearRect(0, 0, 96, 96);
          context.filter = 'blur(5px) saturate(1.55) brightness(.62)';
          context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, -12, -12, 120, 120);
          try {
            const pixels = context.getImageData(0, 0, 96, 96).data;
            let best = null, score = 0;
            for (let i=0; i<pixels.length; i+=64) {
              const r=pixels[i], g=pixels[i+1], b=pixels[i+2], hi=Math.max(r,g,b), lo=Math.min(r,g,b);
              const weight=(hi-lo)*Math.min(hi,180); if (weight>score) {score=weight;best=[r,g,b];}
            }
            if (!best) root.style.removeProperty("--ytmls-art-accent");
            if (best) document.documentElement.style.setProperty('--ytmls-art-accent', best.map(n=>Math.min(255,Math.round(n*.55+140))).join(' '));
            setAuroraPalette(pixels);
            // Bright covers make white lyrics hard to read: darken only those, toward a fixed brightness.
            const shade = backdropShadeAlpha(pixels);
            if (shade > 0) { context.filter = 'none'; context.fillStyle = `rgba(0,0,0,${shade})`; context.fillRect(0, 0, 96, 96); }
          } catch (_) { document.documentElement.style.removeProperty('--ytmls-art-accent'); clearAuroraPalette(); }
          artworkReady = true;
          artworkRevision++;
          paintSurfaces();
          document.dispatchEvent?.(new Event("ytmls-glass-artwork-painted"));
        };
        image.src = art;
        }
        loadArtwork(true);
      }
    }
  }
  function schedule() {
    if (!timer && themeEnabled() && settings.musicGlassArtwork && !settings.musicGlassLightweight) timer = setTimeout(() => { timer = null; update(); }, 0);
  }
  function trimGuideAtPlayer() {
    if (document.hidden || !themeEnabled()) return;
    const player = document.querySelector?.('ytmusic-player-bar');
    if (!player?.getBoundingClientRect) return;
    const edge = player.getBoundingClientRect();
    const nav = document.querySelector('ytmusic-nav-bar');
    const navBounds = nav?.getBoundingClientRect?.();
    // Only trim the stationary guide. The scrolling content must use native clipping.
    for (const selector of ['ytmusic-app-layout #guide-wrapper', 'ytmusic-app-layout #mini-guide-background', 'ytmusic-mini-guide-renderer']) {
      const guide = document.querySelector(selector);
      if (!guide?.getBoundingClientRect) continue;
      const bounds = guide.getBoundingClientRect();
      const overlap = edge.height > 0 ? Math.max(0, Math.min(bounds.height, bounds.bottom - edge.top)) : 0;
      const top = navBounds?.height > 0 ? Math.max(0, Math.min(bounds.height - overlap, navBounds.bottom - bounds.top)) : 0;
      const topValue = top + 'px', bottomValue = overlap + 'px';
      if (guide.style.getPropertyValue('--mg-guide-top-clip') !== topValue) guide.style.setProperty('--mg-guide-top-clip', topValue);
      if (guide.style.getPropertyValue('--mg-guide-bottom-clip') !== bottomValue) guide.style.setProperty('--mg-guide-bottom-clip', bottomValue);
    }
  }
  document.addEventListener('yt-navigate-finish', trimGuideAtPlayer);
  globalThis.addEventListener?.('resize', trimGuideAtPlayer);
  // A fallback only (resize and page changes call it): each run measures the page.
  setInterval(trimGuideAtPlayer, 10000);
  let watchedMenu;
  let menuObserver;
  function syncExpandedControls() {
    if (document.hidden) return;
    const menu = document.querySelector?.('ytmusic-player-expanding-menu#expanding-menu');
    if (menu !== watchedMenu) {
      menuObserver?.disconnect();
      watchedMenu = menu;
      if (menu && typeof MutationObserver !== 'undefined') {
        menuObserver = new MutationObserver(syncExpandedControls);
        menuObserver.observe(menu, {attributes:true, attributeFilter:['style','class','aria-hidden','hidden','opened']});
      }
    }
    let open = false;
    if (themeEnabled() && menu?.getClientRects && typeof getComputedStyle === 'function') {
      const style = getComputedStyle(menu);
      open = menu.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }
    root.classList.toggle('music-glass-controls-open', open);
  }
  // The menu's own attribute changes call it at once; this is only a fallback (it reads styles).
  setInterval(syncExpandedControls, 5000);
  document.addEventListener('yt-navigate-finish', syncExpandedControls);
  function apply() {
    root.classList.toggle('music-glass', themeEnabled());
    trimGuideAtPlayer();
    syncExpandedControls();
    root.classList.toggle('music-glass-hide-scrollbar', extensionEnabled && settings.musicGlassHideScrollbar === true);
    root.classList.toggle('music-glass-hide-dislike', extensionEnabled && settings.musicGlassHideDislike === true);
    root.style.setProperty('--mg-art-opacity', String(Math.max(0, Math.min(100, Number(settings.musicGlassIntensity) || 0)) / 100));
    if (!themeEnabled() || !settings.musicGlassArtwork || settings.musicGlassLightweight) { root.style.removeProperty('--ytmls-art-accent'); clearAuroraPalette(); generation++; artworkReady = false; backdrop?.remove(); backdrop = null; lastArt = ''; }
    else update();
    if (!themeEnabled()) { surfaceResizeObserver?.disconnect(); for (const canvas of surfaces.values()) canvas.remove(); surfaces.clear(); }
    else paintSurfaces();
    ensureAurora();
  }
  chrome.storage.sync?.get({enabled:true}, stored => { extensionEnabled = stored.enabled !== false; apply(); });
  chrome.storage.local.get(defaults, stored => { settings = { ...defaults, ...stored }; apply(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) { extensionEnabled = changes.enabled.newValue !== false; apply(); return; }
    if (area !== 'local' || !Object.keys(defaults).some(key => changes[key])) return;
    for (const key of Object.keys(defaults)) if (changes[key]) settings[key] = changes[key].newValue ?? defaults[key];
    apply();
  });
  // pointer-events:none lets clicks fall through to the native player.
  // Capture artwork activation before it reaches the player's handlers instead.
  function blockArtworkActivation(event) {
    if (!themeEnabled()) return;
    const path = event.composedPath?.() || [event.target];
    if (!path.some(node => node?.matches?.('ytmusic-player #song-image'))) return;
    if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown']) {
    document.addEventListener(type, blockArtworkActivation, true);
  }
  // A bounded check avoids observing every lyrics/list DOM mutation.
  // The player bar's picture is watched (load events, src changes); this is only a fallback, and each
  // run measures where the glass surfaces sit.
  setInterval(() => { if (!document.hidden && settings.musicGlassArtwork) update(); }, 8000);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('yt-navigate-finish', schedule);

})();





