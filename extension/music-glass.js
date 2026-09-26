(() => {
  'use strict';
  const defaults = { musicGlassEnabled: true, musicGlassArtwork: true, musicGlassIntensity: 65, musicGlassHideScrollbar: false };
  const root = document.documentElement;
  let settings = { ...defaults };
  let backdrop;
  let timer;
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
    if (!settings.musicGlassEnabled) return;
    const page = document.body;
    if (!page) return;
    if (!backdrop || backdrop.parentNode !== page) {
      backdrop?.remove();
      backdrop = document.createElement('div');
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
      backdrop.style.backgroundImage = art ? `url(${JSON.stringify(art)})` : 'none';
      lastArt = art;
    }
  }
  function schedule() {
    if (!timer && settings.musicGlassEnabled) timer = setTimeout(() => { timer = null; update(); }, 180);
  }
  function apply() {
    root.classList.toggle('music-glass', settings.musicGlassEnabled);
    root.classList.toggle('music-glass-hide-scrollbar', settings.musicGlassHideScrollbar === true);
    root.style.setProperty('--mg-art-opacity', String(Math.max(0, Math.min(100, Number(settings.musicGlassIntensity) || 0)) / 100));
    if (!settings.musicGlassEnabled) { backdrop?.remove(); backdrop = null; lastArt = ''; }
    else update();
  }
  chrome.storage.local.get(defaults, stored => { settings = { ...defaults, ...stored }; apply(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(defaults).some(key => changes[key])) return;
    for (const key of Object.keys(defaults)) if (changes[key]) settings[key] = changes[key].newValue ?? defaults[key];
    apply();
  });
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  document.addEventListener('yt-navigate-finish', schedule);
  document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) schedule(); }, true);
})();
