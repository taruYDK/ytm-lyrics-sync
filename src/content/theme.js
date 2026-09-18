  let lastThemeCheck = 0;
  const observedThemeRoots = new WeakSet();
  let themeRefreshPending = false;
  function scheduleLyricsThemeRefresh() {
    if (themeRefreshPending) return;
    themeRefreshPending = true;
    requestAnimationFrame(() => {
      themeRefreshPending = false;
      updateLyricsTheme(true);
    });
  }
  const lyricsThemeObserver = new MutationObserver(scheduleLyricsThemeRefresh);
  const lyricsThemeMedia = matchMedia('(prefers-color-scheme: light)');
  lyricsThemeMedia.addEventListener('change', scheduleLyricsThemeRefresh);
  function updateLyricsTheme(force = false) {
    const roots = [document.querySelector('ytmusic-player-page'), document.querySelector('ytmusic-app'), document.body, document.documentElement];
    for (const root of roots) {
      if (!root || observedThemeRoots.has(root)) continue;
      observedThemeRoots.add(root);
      lyricsThemeObserver.observe(root, {attributes:true, attributeFilter:['class','style','dark','theme','data-theme','is-dark-theme','color-scheme']});
      force = true;
    }
    const now = performance.now();
    if (!force && now - lastThemeCheck < 1000) return;
    lastThemeCheck = now;
    // Read the site's rendered surface, not the extension's own colors.
    // No dependency on undocumented theme class names.
    let light;
    for (const el of roots) {
      if (!el) continue;
      const color = getComputedStyle(el).backgroundColor;
      const parts = color.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3 || (parts.length > 3 && parts[3] < .95)) continue;
      const channels = parts.slice(0,3).map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
      light = .2126*channels[0]+.7152*channels[1]+.0722*channels[2] > .45;
      break;
    }
    if (light === undefined) {
      const root = document.documentElement;
      light = root.hasAttribute('dark') ? false : root.getAttribute('data-theme') === 'light' ? true : matchMedia('(prefers-color-scheme: light)').matches;
    }
    const value = light ? 'light' : 'dark';
    if (document.documentElement.dataset.ytmlsTheme !== value) document.documentElement.dataset.ytmlsTheme = value;
  }
