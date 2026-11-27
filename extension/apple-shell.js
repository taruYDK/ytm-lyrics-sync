// Mac Music-style screen over YouTube Music.
// YouTube Music's own top bar, side menu and player bar stay where they are (hidden),
// so the page keeps its layout. Our own sidebar and toolbar are laid over exactly
// the space they take up, measured from the page. Buttons press YouTube Music's
// own hidden buttons, so playback keeps working the way YouTube Music expects.
(() => {
  'use strict';
  const root = document.documentElement;
  const defaults = {appleShellEnabled: true};
  let wanted = true;
  let settingsLoaded = false; // stay off until the saved switch is known (no flash when it is off)
  let extensionEnabled = true;
  let shell = null;
  const ui = {};
  let guideSignature = '';
  let lastLayout = '';
  let progressFrame = 0;
  let seeking = false;
  let video = null;

  const svg = (body, filled = false) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
  const ICONS = {
    home: svg('<path d="M4 11 12 4.5 20 11v8a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
    explore: svg('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z"/>'),
    library: svg('<path d="M5 4.5v15M9 4.5v15M13 5l4.5 14.5"/>'),
    samples: svg('<rect x="5.5" y="3.5" width="13" height="17" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>'),
    upgrade: svg('<path d="M12 3.5 14.4 9l5.6.5-4.3 3.7 1.3 5.6L12 15.9l-5 2.9 1.3-5.6L4 9.5 9.6 9z"/>'),
    liked: svg('<path d="M12 19.5s-7.5-4.4-7.5-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.2c0 5.3-7.5 9.7-7.5 9.7z"/>'),
    playlist: svg('<path d="M4.5 6.5h11M4.5 11h11M4.5 15.5h6"/><circle cx="16.5" cy="17" r="2"/><path d="M18.5 17V9.5l2-.8"/>'),
    item: svg('<circle cx="12" cy="12" r="3"/>'),
    search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>'),
    menu: svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'),
    play: svg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8A.8.8 0 0 0 8 5.2z"/>', true),
    pause: svg('<rect x="6.5" y="5" width="3.8" height="14" rx="1"/><rect x="13.7" y="5" width="3.8" height="14" rx="1"/>', true),
    prev: svg('<path d="M11.5 6.3v11.4a.6.6 0 0 1-1 .5L3.8 12.5a.6.6 0 0 1 0-1l6.7-5.7a.6.6 0 0 1 1 .5zm9 0v11.4a.6.6 0 0 1-1 .5l-6.7-5.7a.6.6 0 0 1 0-1l6.7-5.7a.6.6 0 0 1 1 .5z"/>', true),
    next: svg('<path d="M12.5 6.3v11.4a.6.6 0 0 0 1 .5l6.7-5.7a.6.6 0 0 0 0-1l-6.7-5.7a.6.6 0 0 0-1 .5zm-9 0v11.4a.6.6 0 0 0 1 .5l6.7-5.7a.6.6 0 0 0 0-1L4.5 5.8a.6.6 0 0 0-1 .5z"/>', true),
    shuffle: svg('<path d="M3.5 7h3.2c2 0 3.2 1 4.3 2.6l2 3c1 1.5 2.2 2.4 4.2 2.4h3.3M3.5 17h3.2c1.4 0 2.4-.5 3.3-1.4M14 8.4c.9-.9 1.9-1.4 3.2-1.4h3.3M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>'),
    repeat: svg('<path d="M4.5 11V9.5a2.5 2.5 0 0 1 2.5-2.5h12.5M17 4.5 19.5 7 17 9.5M19.5 13v1.5A2.5 2.5 0 0 1 17 17H4.5M7 19.5 4.5 17 7 14.5"/>'),
    lyrics: svg('<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8.5 10h1M8.5 12.8h1M12 10h3.5M12 12.8h3.5"/>'),
    queue: svg('<path d="M4.5 6.5h15M4.5 11h15M4.5 15.5h8"/><path d="m15.5 14 4 2.5-4 2.5z"/>'),
    note: svg('<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
    account: svg('<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/>'),
  };

  function iconFor(title, sectionIndex) {
    const t = String(title || '');
    if (/ホーム|^home$/i.test(t)) return 'home';
    if (/探索|explore/i.test(t)) return 'explore';
    if (/ライブラリ|library/i.test(t)) return 'library';
    if (/サンプル|samples/i.test(t)) return 'samples';
    if (/アップグレード|upgrade|premium/i.test(t)) return 'upgrade';
    if (/高評価|liked/i.test(t)) return 'liked';
    return sectionIndex > 0 ? 'playlist' : 'item';
  }

  const q = selector => document.querySelector(selector);
  const playerBar = () => q('ytmusic-player-bar');
  const layoutEl = () => q('ytmusic-app-layout');
  function barButton(selector) {
    const bar = playerBar();
    return bar ? bar.querySelector(selector) : null;
  }
  function press(el) {
    if (!el) return false;
    const target = el.querySelector?.('button') || el;
    target.click();
    return true;
  }
  function currentVideo() {
    return q('#movie_player video.html5-main-video') || q('ytmusic-player video') || q('video');
  }

  // ---------- where YouTube Music's chrome sits ----------
  function visibleRect(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 ? rect : null;
  }
  function measure() {
    const navRect = visibleRect(q('ytmusic-nav-bar'));
    if (!navRect || navRect.height < 32 || !playerBar()) return null;
    let side = 0;
    const drawer = q('tp-yt-app-drawer#guide');
    if (drawer?.hasAttribute('opened') && drawer.hasAttribute('persistent')) {
      const rect = visibleRect(drawer.querySelector('#contentContainer') || drawer);
      if (rect && rect.left <= 1) side = Math.max(side, rect.right);
    }
    for (const selector of ['#mini-guide', 'div#mini-col', 'ytmusic-guide-renderer#mini-guide-renderer', 'ytmusic-mini-guide-renderer']) {
      const rect = visibleRect(q(selector));
      if (rect && rect.left <= 1) side = Math.max(side, rect.right);
    }
    return {top: Math.round(navRect.bottom), side: Math.round(Math.min(side, 420))};
  }

  // ---------- side menu ----------
  function guideSections() {
    const renderer = q('ytmusic-guide-renderer#guide-renderer') || q('ytmusic-guide-renderer#mini-guide-renderer') || q('ytmusic-guide-renderer') || q('ytmusic-mini-guide-renderer');
    if (!renderer) return [];
    let sections = [...renderer.querySelectorAll('ytmusic-guide-section-renderer')];
    if (!sections.length) sections = [renderer];
    return sections.map((section, sectionIndex) => [...section.querySelectorAll('ytmusic-guide-entry-renderer, ytmusic-mini-guide-entry-renderer')]
      .map(entry => {
        const titleEl = entry.querySelector('.title-column .title, .title-group, .title');
        const title = (titleEl || entry).textContent.replace(/\s+/g, ' ').trim();
        return {entry, title, active: entry.hasAttribute('active'), icon: iconFor(title, sectionIndex)};
      })
      .filter(item => item.title))
      .filter(items => items.length);
  }

  function renderGuide() {
    if (!ui.nav) return;
    const sections = guideSections();
    const signature = JSON.stringify(sections.map(items => items.map(item => [item.title, item.active])));
    if (signature === guideSignature) return;
    guideSignature = signature;
    ui.nav.replaceChildren();
    sections.forEach((items, index) => {
      const group = document.createElement('div');
      group.className = 'ytmls-am-group';
      if (index > 0) {
        const heading = document.createElement('div');
        heading.className = 'ytmls-am-heading';
        heading.textContent = 'プレイリスト';
        group.append(heading);
      }
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ytmls-am-item';
        button.title = item.title;
        if (item.active) { button.classList.add('is-active'); button.setAttribute('aria-current', 'page'); }
        button.innerHTML = `<span class="ytmls-am-item-icon" data-icon="${item.icon}">${ICONS[item.icon]}</span>`;
        const label = document.createElement('span');
        label.className = 'ytmls-am-item-label';
        label.textContent = item.title;
        button.append(label);
        button.addEventListener('click', () => {
          closeDrawer();
          press(item.entry.querySelector('tp-yt-paper-item') || item.entry);
        });
        group.append(button);
      }
      ui.nav.append(group);
    });
  }

  function runSearch(query) {
    const text = String(query || '').trim();
    if (!text) return;
    const input = q('ytmusic-search-box input#input') || q('ytmusic-search-box input');
    closeDrawer();
    if (!input) { location.assign(`/search?q=${encodeURIComponent(text)}`); return; }
    input.value = text;
    input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true}));
    // If YouTube Music did not take the search, open the results page directly.
    setTimeout(() => {
      if (!location.pathname.startsWith('/search')) location.assign(`/search?q=${encodeURIComponent(text)}`);
    }, 1500);
  }

  function closeDrawer() {
    root.classList.remove('ytmls-am-drawer-open');
    ui.searchBox?.classList.remove('is-open');
  }

  // ---------- now playing ----------
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function updateProgress() {
    const media = video;
    if (!ui.progressFill || !media) return;
    const duration = Number(media.duration);
    const time = Number(media.currentTime);
    const ratio = Number.isFinite(duration) && duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
    if (!seeking) ui.progressFill.style.transform = `scaleX(${ratio})`;
    ui.elapsed.textContent = formatTime(time);
    ui.remaining.textContent = Number.isFinite(duration) && duration > 0 ? `-${formatTime(duration - time)}` : '';
  }

  function progressLoop() {
    progressFrame = 0;
    updateProgress();
    if (video && !video.paused && !document.hidden && root.classList.contains('ytmls-am')) {
      progressFrame = requestAnimationFrame(progressLoop);
    }
  }
  function startProgress() {
    if (!progressFrame) progressFrame = requestAnimationFrame(progressLoop);
  }

  function updatePlayState() {
    if (!ui.play) return;
    const playing = Boolean(video && !video.paused);
    ui.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    ui.play.setAttribute('aria-label', playing ? '一時停止' : '再生');
    ui.play.title = playing ? '一時停止' : '再生';
    if (playing) startProgress(); else updateProgress();
  }

  function bindVideo() {
    const media = currentVideo();
    if (media === video) return;
    if (video) for (const type of ['play', 'pause', 'timeupdate', 'durationchange', 'emptied']) video.removeEventListener(type, onMediaEvent);
    video = media;
    if (video) for (const type of ['play', 'pause', 'timeupdate', 'durationchange', 'emptied']) video.addEventListener(type, onMediaEvent);
    updatePlayState();
  }
  function onMediaEvent(event) {
    if (event.type === 'play' || event.type === 'pause') updatePlayState();
    else updateProgress();
  }

  function updateNowPlaying() {
    if (!ui.lcd) return;
    const bar = playerBar();
    const title = bar?.querySelector('.title')?.textContent.trim() || '';
    const byline = (bar?.querySelector('.byline')?.textContent || '').split(/[•·]/).map(part => part.trim()).filter(Boolean);
    const subtitle = byline.slice(0, 2).join(' — ');
    const img = bar?.querySelector('img.image, .thumbnail-image-wrapper img, img');
    const art = img?.currentSrc || img?.src || '';
    ui.lcd.classList.toggle('is-empty', !title);
    if (ui.title.textContent !== title) ui.title.textContent = title;
    if (ui.subtitle.textContent !== subtitle) ui.subtitle.textContent = subtitle;
    if (art && ui.art.getAttribute('src') !== art) ui.art.setAttribute('src', art);
    ui.art.hidden = !art || !title;
    for (const [name, selector] of [['shuffle', '.shuffle'], ['repeat', '.repeat']]) {
      const native = barButton(selector);
      const label = native?.getAttribute('title') || native?.getAttribute('aria-label') || '';
      if (label) ui[name].title = label;
      ui[name].hidden = !native;
    }
    const avatar = q('ytmusic-nav-bar ytmusic-settings-button img');
    const avatarSrc = avatar?.currentSrc || avatar?.src || '';
    if (avatarSrc && /^https:/.test(avatarSrc)) {
      let img = ui.account.querySelector('img');
      if (!img) { img = document.createElement('img'); img.alt = ''; ui.account.replaceChildren(img); }
      if (img.getAttribute('src') !== avatarSrc) img.setAttribute('src', avatarSrc);
    } else if (!ui.account.firstElementChild) ui.account.innerHTML = ICONS.account;
    ui.account.hidden = !q('ytmusic-nav-bar ytmusic-settings-button');
  }

  function seekFromPointer(event) {
    const rect = ui.progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    ui.progressFill.style.transform = `scaleX(${ratio})`;
    return ratio;
  }
  function bindProgress() {
    ui.progress.addEventListener('pointerdown', event => {
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      seeking = true;
      ui.progress.setPointerCapture?.(event.pointerId);
      ui.progress.classList.add('is-seeking');
      seekFromPointer(event);
      event.preventDefault();
    });
    ui.progress.addEventListener('pointermove', event => { if (seeking) seekFromPointer(event); });
    const finish = event => {
      if (!seeking) return;
      seeking = false;
      ui.progress.classList.remove('is-seeking');
      const ratio = seekFromPointer(event);
      if (video && Number.isFinite(video.duration)) video.currentTime = ratio * video.duration;
      updateProgress();
    };
    ui.progress.addEventListener('pointerup', finish);
    ui.progress.addEventListener('pointercancel', finish);
  }

  // Open the Now Playing page and, if asked, one of its tabs (lyrics / up next).
  function openPlayerPage(tab) {
    const layout = layoutEl();
    const open = layout?.hasAttribute('player-page-open');
    if (!open) press(barButton('.toggle-player-page-button')) || playerBar()?.click();
    if (!tab) return;
    let tries = 0;
    const pick = () => {
      const tabs = [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')];
      const target = tab === 'lyrics'
        ? tabs.find(el => /歌詞|lyrics/i.test(el.textContent))
        : tabs[0];
      if (target) {
        if (target.getAttribute('aria-selected') === 'true' && open && tab === lastTab) {
          press(barButton('.toggle-player-page-button')) || playerBar()?.click();
        } else target.click();
        lastTab = tab;
        return;
      }
      if (++tries < 20) setTimeout(pick, 100);
    };
    pick();
  }
  let lastTab = '';

  // ---------- building ----------
  function button(name, label, icon, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ytmls-am-btn ytmls-am-${name}`;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.innerHTML = ICONS[icon];
    el.addEventListener('click', onClick);
    ui[name] = el;
    return el;
  }

  function build() {
    if (shell) return;
    shell = document.createElement('div');
    shell.id = 'ytmls-am';

    // Sidebar
    const sidebar = document.createElement('nav');
    sidebar.className = 'ytmls-am-sidebar';
    sidebar.setAttribute('aria-label', 'メニュー');
    const searchBox = document.createElement('form');
    searchBox.className = 'ytmls-am-search';
    searchBox.setAttribute('role', 'search');
    searchBox.innerHTML = `<span class="ytmls-am-search-icon">${ICONS.search}</span>`;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '検索';
    input.setAttribute('aria-label', '曲、アルバム、アーティストを検索');
    searchBox.append(input);
    searchBox.addEventListener('submit', event => { event.preventDefault(); runSearch(input.value); input.blur(); });
    const searchToggle = document.createElement('button');
    searchToggle.type = 'button';
    searchToggle.className = 'ytmls-am-search-toggle ytmls-am-item';
    searchToggle.title = '検索';
    searchToggle.innerHTML = `<span class="ytmls-am-item-icon">${ICONS.search}</span>`;
    searchToggle.addEventListener('click', () => {
      searchBox.classList.toggle('is-open');
      if (searchBox.classList.contains('is-open')) input.focus();
    });
    ui.searchBox = searchBox;
    ui.nav = document.createElement('div');
    ui.nav.className = 'ytmls-am-nav';
    sidebar.append(searchBox, searchToggle, ui.nav);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ytmls-am-toolbar';
    const left = document.createElement('div');
    left.className = 'ytmls-am-cluster ytmls-am-left';
    const menu = button('menu', 'メニュー', 'menu', () => root.classList.toggle('ytmls-am-drawer-open'));
    const controls = document.createElement('div');
    controls.className = 'ytmls-am-capsule ytmls-am-controls';
    controls.append(
      button('shuffle', 'シャッフル', 'shuffle', () => press(barButton('.shuffle'))),
      button('prev', '前へ', 'prev', () => press(barButton('.previous-button'))),
      button('play', '再生', 'play', () => {
        if (!press(barButton('#play-pause-button')) && video) video.paused ? video.play() : video.pause();
      }),
      button('next', '次へ', 'next', () => press(barButton('.next-button'))),
      button('repeat', 'リピート', 'repeat', () => press(barButton('.repeat'))),
    );
    left.append(menu, controls);

    const lcd = document.createElement('div');
    lcd.className = 'ytmls-am-lcd is-empty';
    ui.lcd = lcd;
    ui.art = document.createElement('img');
    ui.art.className = 'ytmls-am-art';
    ui.art.alt = '';
    ui.art.hidden = true;
    const placeholder = document.createElement('span');
    placeholder.className = 'ytmls-am-placeholder';
    placeholder.innerHTML = ICONS.note;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'ytmls-am-info';
    info.title = '再生中の画面を開く';
    ui.title = document.createElement('span');
    ui.title.className = 'ytmls-am-title';
    ui.subtitle = document.createElement('span');
    ui.subtitle.className = 'ytmls-am-subtitle';
    info.append(ui.title, ui.subtitle);
    info.addEventListener('click', () => openPlayerPage());
    ui.art.addEventListener('click', () => openPlayerPage());
    ui.progress = document.createElement('div');
    ui.progress.className = 'ytmls-am-progress';
    ui.progress.setAttribute('aria-label', '再生位置');
    ui.progress.innerHTML = '<span class="ytmls-am-progress-track"><span class="ytmls-am-progress-fill"></span></span>';
    ui.progressFill = ui.progress.querySelector('.ytmls-am-progress-fill');
    ui.elapsed = document.createElement('span');
    ui.elapsed.className = 'ytmls-am-time ytmls-am-elapsed';
    ui.remaining = document.createElement('span');
    ui.remaining.className = 'ytmls-am-time ytmls-am-remaining';
    lcd.append(ui.art, placeholder, info, ui.elapsed, ui.remaining, ui.progress);
    bindProgress();

    const right = document.createElement('div');
    right.className = 'ytmls-am-cluster ytmls-am-right';
    const views = document.createElement('div');
    views.className = 'ytmls-am-capsule';
    views.append(
      button('lyrics', '歌詞', 'lyrics', () => openPlayerPage('lyrics')),
      button('queue', '次に再生', 'queue', () => openPlayerPage('queue')),
    );
    right.append(views, button('account', 'アカウント', 'account', () => {
      const native = q('ytmusic-nav-bar ytmusic-settings-button');
      press(native?.querySelector('button, tp-yt-paper-icon-button, #button, img') || native);
    }));

    toolbar.append(left, lcd, right);
    const scrim = document.createElement('div');
    scrim.className = 'ytmls-am-scrim';
    scrim.addEventListener('click', closeDrawer);
    shell.append(scrim, sidebar, toolbar);
    document.body.append(shell);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });
  }

  // ---------- keeping it in place ----------
  function active() {
    return settingsLoaded && wanted && extensionEnabled && !document.fullscreenElement && !layoutEl()?.hasAttribute('player-fullscreened');
  }

  function refresh() {
    if (!active()) { root.classList.remove('ytmls-am', 'ytmls-am-compact', 'ytmls-am-no-side'); return; }
    const layout = measure();
    if (!layout) { root.classList.remove('ytmls-am'); return; }
    build();
    const key = `${layout.top}:${layout.side}`;
    if (key !== lastLayout) {
      lastLayout = key;
      root.style.setProperty('--ytmls-am-top', `${layout.top}px`);
      root.style.setProperty('--ytmls-am-side', `${layout.side}px`);
    }
    root.classList.add('ytmls-am');
    root.classList.toggle('ytmls-am-compact', layout.side > 0 && layout.side < 160);
    root.classList.toggle('ytmls-am-no-side', layout.side < 40);
    if (layout.side >= 40) root.classList.remove('ytmls-am-drawer-open');
    renderGuide();
    bindVideo();
    updateNowPlaying();
    updatePlayState();
  }

  let refreshQueued = false;
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; refresh(); });
  }

  function start() {
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 700);
    addEventListener('resize', queueRefresh);
    document.addEventListener('fullscreenchange', queueRefresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { queueRefresh(); startProgress(); } });
    window.addEventListener('yt-navigate-finish', queueRefresh, true);
  }

  chrome.storage.sync?.get({enabled: true}, stored => { extensionEnabled = stored.enabled !== false; queueRefresh(); });
  chrome.storage.local.get(defaults, stored => { wanted = stored.appleShellEnabled !== false; settingsLoaded = true; queueRefresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) extensionEnabled = changes.enabled.newValue !== false;
    if (area === 'local' && changes.appleShellEnabled) wanted = changes.appleShellEnabled.newValue !== false;
    if (changes.enabled || changes.appleShellEnabled) queueRefresh();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
