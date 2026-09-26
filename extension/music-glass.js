(() => {
  'use strict';
  const defaults = { musicGlassEnabled: true, musicGlassArtwork: true, musicGlassIntensity: 65, musicGlassHideScrollbar: false, musicGlassLightweight: false };
  const root = document.documentElement;
  let settings = { ...defaults };
  let backdrop;
  let timer;
  let generation = 0;
  let lastArt = '';
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
    if (document.hidden || !settings.musicGlassEnabled || settings.musicGlassLightweight) return;
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
        art = safeImage(img?.currentSrc || img?.src || '');
        if (art) break;
      }
    }
    if (art !== lastArt) {
      lastArt = art;
      const token = ++generation;
      const canvas = backdrop;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 96, 96);
      if (art) {
        const image = new Image();
        image.onload = () => {
          if (token !== generation || backdrop !== canvas) return;
          // Bake blur into a tiny bitmap once per cover, not a viewport filter.
          const side = Math.min(image.naturalWidth, image.naturalHeight);
          if (!side) return;
          context.filter = 'blur(5px) saturate(1.55) brightness(.62)';
          context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, -12, -12, 120, 120);
        };
        image.src = art;
      }
    }
  }
  function schedule() {
    if (!timer && settings.musicGlassEnabled && !settings.musicGlassLightweight) timer = setTimeout(() => { timer = null; update(); }, 500);
  }
  function apply() {
    root.classList.toggle('music-glass', settings.musicGlassEnabled);
    root.classList.toggle('music-glass-hide-scrollbar', settings.musicGlassHideScrollbar === true);
    root.style.setProperty('--mg-art-opacity', String(Math.max(0, Math.min(100, Number(settings.musicGlassIntensity) || 0)) / 100));
    if (!settings.musicGlassEnabled || settings.musicGlassLightweight) { generation++; backdrop?.remove(); backdrop = null; lastArt = ''; }
    else update();
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
