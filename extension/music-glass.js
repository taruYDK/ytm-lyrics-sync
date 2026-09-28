(() => {
  'use strict';
  const defaults = { musicGlassEnabled: true, musicGlassArtwork: true, musicGlassIntensity: 65, musicGlassHideScrollbar: false, musicGlassHideDislike: false, musicGlassLightweight: false };
  const root = document.documentElement;
  let settings = { ...defaults };
  let backdrop;
  let timer;
  let generation = 0;
  let artworkRevision = 0;
  let lastArt = '';
  let artworkReady = false;
  const surfaces = new Map();
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
  function paintSurfaces(tabsOnly = false) {
    if (!settings.musicGlassEnabled) return;
    const width = globalThis.innerWidth, height = globalThis.innerHeight;
    if (!width || !height) return;
    const selectors = ['ytmusic-nav-bar', 'ytmusic-player-bar', 'ytmusic-player-page', 'ytmusic-browse-response ytmusic-tabs'];
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
      }
      // Layout coordinates do not move with the native opening transform.
      // Sampling a transitioning rectangle can crop outside the bitmap and cache
      // transparent/black strips until the next poll.
      let left = 0, top = 0;
      for (let node = host; node; node = node.offsetParent) {
        left += node.offsetLeft || 0;
        top += node.offsetTop || 0;
      }
      const isTabs = selector === 'ytmusic-browse-response ytmusic-tabs';
      const bounds = isTabs ? host.getBoundingClientRect() : {left, top, width:host.clientWidth, height:host.clientHeight};
      if (isTabs) { left = bounds.left; top = bounds.top; }
      if (!bounds.width || !bounds.height) continue;
      const sx = Math.max(0, Math.min(95, left / width * 96));
      const sy = Math.max(0, Math.min(95, top / height * 96));
      const sw = Math.max(1, Math.min(96 - sx, bounds.width / width * 96));
      const sh = Math.max(1, Math.min(96 - sy, bounds.height / height * 96));
      const signature = [artworkRevision, artworkReady, width, height, sx, sy, sw, sh].join(':');
      if (canvas.dataset.paint === signature) continue;
      canvas.dataset.paint = signature;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 192, 192);
      if (artworkReady && backdrop && bounds.width > 0 && bounds.height > 0) {
        context.drawImage(backdrop, sx, sy, sw, sh, 0, 0, 192, 192);
      }
    }
    for (const [host, canvas] of surfaces) if (!host.isConnected) { canvas.remove(); surfaces.delete(host); }
  }
  let tabsFrame = false;
  document.addEventListener('scroll', () => {
    if (tabsFrame || !settings.musicGlassEnabled || document.hidden || typeof requestAnimationFrame !== 'function') return;
    tabsFrame = true;
    requestAnimationFrame(() => { tabsFrame = false; paintSurfaces(true); });
  }, {capture:true, passive:true});
  globalThis.addEventListener?.('resize', paintSurfaces);
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
  function update() {
    if (document.hidden) return;
    watchArtwork();
    paintSurfaces();
    if (document.hidden || !settings.musicGlassEnabled || !settings.musicGlassArtwork || settings.musicGlassLightweight) return;
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
      // Keep the previous frame until the replacement image has decoded.
      const token = ++generation;
      const canvas = backdrop;
      const context = canvas.getContext('2d');
      if (art) {
        const image = new Image();
        image.onload = () => {
          if (token !== generation || backdrop !== canvas) return;
          // Bake blur into a tiny bitmap once per cover, not a viewport filter.
          const side = Math.min(image.naturalWidth, image.naturalHeight);
          if (!side) return;
          context.clearRect(0, 0, 96, 96);
          context.filter = 'blur(5px) saturate(1.55) brightness(.62)';
          context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, -12, -12, 120, 120);
          artworkReady = true;
          artworkRevision++;
          paintSurfaces();
        };
        image.src = art;
      }
    }
  }
  function schedule() {
    if (!timer && settings.musicGlassEnabled && settings.musicGlassArtwork && !settings.musicGlassLightweight) timer = setTimeout(() => { timer = null; update(); }, 0);
  }
  function trimGuideAtPlayer() {
    if (!settings.musicGlassEnabled) return;
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
      guide.style.setProperty('--mg-guide-top-clip', top + 'px');
      guide.style.setProperty('--mg-guide-bottom-clip', overlap + 'px');
    }
  }
  document.addEventListener('yt-navigate-finish', trimGuideAtPlayer);
  globalThis.addEventListener?.('resize', trimGuideAtPlayer);
  setInterval(trimGuideAtPlayer, 2000);
  let watchedMenu;
  let menuObserver;
  function syncExpandedControls() {
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
    if (settings.musicGlassEnabled && menu?.getClientRects && typeof getComputedStyle === 'function') {
      const style = getComputedStyle(menu);
      open = menu.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }
    root.classList.toggle('music-glass-controls-open', open);
  }
  setInterval(syncExpandedControls, 1000);
  document.addEventListener('yt-navigate-finish', syncExpandedControls);
  function apply() {
    root.classList.toggle('music-glass', settings.musicGlassEnabled);
    trimGuideAtPlayer();
    syncExpandedControls();
    root.classList.toggle('music-glass-hide-scrollbar', settings.musicGlassHideScrollbar === true);
    root.classList.toggle('music-glass-hide-dislike', settings.musicGlassHideDislike === true);
    root.style.setProperty('--mg-art-opacity', String(Math.max(0, Math.min(100, Number(settings.musicGlassIntensity) || 0)) / 100));
    if (!settings.musicGlassEnabled || !settings.musicGlassArtwork || settings.musicGlassLightweight) { generation++; artworkReady = false; backdrop?.remove(); backdrop = null; lastArt = ''; }
    else update();
    if (!settings.musicGlassEnabled) { for (const canvas of surfaces.values()) canvas.remove(); surfaces.clear(); }
    else paintSurfaces();
  }
  chrome.storage.local.get(defaults, stored => { settings = { ...defaults, ...stored }; apply(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(defaults).some(key => changes[key])) return;
    for (const key of Object.keys(defaults)) if (changes[key]) settings[key] = changes[key].newValue ?? defaults[key];
    apply();
  });
  // pointer-events:none lets clicks fall through to the native player.
  // Capture artwork activation before it reaches the player's handlers instead.
  function blockArtworkActivation(event) {
    if (!settings.musicGlassEnabled) return;
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
  setInterval(() => { if (!document.hidden && settings.musicGlassArtwork) update(); }, 2000);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('yt-navigate-finish', schedule);

})();

