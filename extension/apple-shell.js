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
    sidebar: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.5 5v14"/><path d="M5.8 8.5h1.6M5.8 11h1.6"/>'),
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
    star: svg('<path d="M12 3.8 14.5 9l5.7.6-4.3 3.9 1.2 5.7L12 16.3l-5.1 2.9 1.2-5.7-4.3-3.9L9.5 9z"/>'),
    starFilled: svg('<path d="M12 3.8 14.5 9l5.7.6-4.3 3.9 1.2 5.7L12 16.3l-5.1 2.9 1.2-5.7-4.3-3.9L9.5 9z"/>', true),
    speaker: svg('<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    speakerLow: svg('<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'),
    speakerMuted: svg('<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>'),
    miniplayer: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect x="11.5" y="11.5" width="7" height="5.5" rx="1.2" fill="currentColor" stroke="none"/>'),
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
  // Press one of YouTube Music's (hidden) buttons. If `changed` is given and nothing changed shortly
  // after the click, the button's own "tap" event is sent as well (its Polymer buttons listen for it).
  function press(el, changed) {
    if (!el) return false;
    const target = el.querySelector?.('button') || el;
    target.click();
    if (changed) {
      setTimeout(() => {
        if (changed()) return;
        try { el.dispatchEvent(new CustomEvent('tap', {bubbles: true, cancelable: true, composed: true})); } catch (_) {}
      }, 600);
    }
    return true;
  }
  // ---------- shuffle / repeat state shown on our buttons ----------
  function nativeLabel(el) {
    return el ? (el.getAttribute('title') || el.getAttribute('aria-label') || el.querySelector?.('button')?.getAttribute('aria-label') || '') : '';
  }
  // Repeat: off / all / one, from the player bar's mode attribute or the button's label
  // (YouTube Music labels it with the current mode, e.g. リピートオフ / すべてリピート / 1 曲リピート).
  function repeatMode() {
    const bar = playerBar();
    const attr = (bar?.getAttribute('repeat-mode') || bar?.getAttribute('repeat-mode_') || '').toUpperCase();
    if (attr === 'NONE' || attr === 'OFF') return 'off';
    if (attr === 'ALL') return 'all';
    if (attr === 'ONE') return 'one';
    const label = nativeLabel(barButton('.repeat'));
    if (!label) return 'off';
    if (/1|one|１/i.test(label)) return 'one';
    if (/オフ|off|なし|無効/i.test(label)) return 'off';
    return 'all';
  }
  // Shuffle: on/off only if YouTube Music shows a pressed state; otherwise it is a one-time action.
  function shuffleState() {
    const el = barButton('.shuffle');
    const pressed = el?.getAttribute('aria-pressed') ?? el?.querySelector?.('button')?.getAttribute('aria-pressed');
    if (pressed === 'true' || pressed === 'false') return {toggle: true, on: pressed === 'true'};
    if (el?.classList.contains('active') || el?.hasAttribute('active')) return {toggle: true, on: true};
    return {toggle: false, on: false};
  }
  // How the shuffle button looks: its labels, pressed marks, classes and icon shape.
  function shuffleSignature() {
    const el = barButton('.shuffle');
    if (!el) return '';
    const inner = el.querySelector('button');
    const icon = el.querySelector('path');
    return [el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('aria-pressed'), el.getAttribute('class'),
      inner?.getAttribute('title'), inner?.getAttribute('aria-label'), inner?.getAttribute('aria-pressed'), icon?.getAttribute('d')].join('|');
  }
  // on / off looks, once seen; until then (or if the button looks the same either way), our own count.
  const shuffleLearned = {on: '', off: '', local: false};
  function shuffleOn() {
    const state = shuffleState();
    if (state.toggle) return state.on;
    const signature = shuffleSignature();
    if (shuffleLearned.on && signature === shuffleLearned.on) return true;
    if (shuffleLearned.off && signature === shuffleLearned.off) return false;
    return shuffleLearned.local;
  }
  function syncShuffleRepeat() {
    if (!ui.repeat) return;
    const mode = repeatMode();
    if (ui.repeat.dataset.mode !== mode) {
      ui.repeat.dataset.mode = mode;
      ui.repeat.classList.toggle('is-active', mode !== 'off');
      ui.repeat.setAttribute('aria-pressed', String(mode !== 'off'));
    }
    const repeatLabel = {off: 'リピート：オフ', all: 'リピート：すべて', one: 'リピート：1曲'}[mode];
    if (ui.repeat.title !== repeatLabel) { ui.repeat.title = repeatLabel; ui.repeat.setAttribute('aria-label', repeatLabel); }
    const shuffleIsOn = shuffleOn();
    ui.shuffle.classList.toggle('is-active', shuffleIsOn);
    ui.shuffle.setAttribute('aria-pressed', String(shuffleIsOn));
    const shuffleLabel = `シャッフル：${shuffleIsOn ? 'オン' : 'オフ'}`;
    if (ui.shuffle.title !== shuffleLabel) { ui.shuffle.title = shuffleLabel; ui.shuffle.setAttribute('aria-label', shuffleLabel); }
  }
  function flashButton(el) {
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 650);
  }

  // What a press of a button should change: used to tell whether the click was taken.
  function stateOf(el) {
    return el ? [el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('aria-pressed'), el.className,
      el.querySelector?.('button')?.getAttribute('aria-pressed'), el.querySelector?.('button')?.getAttribute('aria-label')].join('|') : '';
  }
  function trackState() {
    const media = currentVideo();
    return [lastSnapshot.videoId, playerBar()?.querySelector('.title')?.textContent || '', media ? media.currentTime < 2 : ''].join('|');
  }
  function pressChanging(el, read) {
    const before = read(el);
    return press(el, () => read(el) !== before);
  }
  function currentVideo() {
    return q('#movie_player video.html5-main-video') || q('ytmusic-player video') || q('video');
  }

  // ---------- shared controls (also used by the Now Playing screen in content.js) ----------
  const bridge = globalThis.ytmlsBridge;
  const volumeState = {volume: null, muted: false, holdUntil: 0};
  const lastSnapshot = {videoId: '', at: 0};
  bridge?.listen?.(message => {
    if (message?.type !== 'snapshot') return;
    const payload = message.payload || {};
    lastSnapshot.videoId = String(payload.videoId || '');
    lastSnapshot.at = performance.now();
    if (performance.now() < volumeState.holdUntil) return;
    if (Number.isFinite(payload.volume)) volumeState.volume = payload.volume;
    if (typeof payload.muted === 'boolean') volumeState.muted = payload.muted;
  });
  function getVolume() {
    if (volumeState.volume !== null) return {volume: volumeState.volume, muted: volumeState.muted};
    const media = currentVideo();
    return media ? {volume: Math.round(media.volume * 100), muted: media.muted} : {volume: 100, muted: false};
  }
  function setVolume(value) {
    const volume = Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
    volumeState.volume = volume;
    if (volume > 0) volumeState.muted = false;
    volumeState.holdUntil = performance.now() + 700;
    if (bridge) bridge.send({type: 'set-volume', payload: {volume}});
    else { const media = currentVideo(); if (media) media.volume = volume / 100; }
    syncVolumeControls();
  }
  function toggleMute() {
    volumeState.muted = !getVolume().muted;
    if (volumeState.volume === null) volumeState.volume = getVolume().volume;
    volumeState.holdUntil = performance.now() + 700;
    if (bridge) bridge.send({type: 'toggle-mute'});
    else { const media = currentVideo(); if (media) media.muted = !media.muted; }
    syncVolumeControls();
  }
  function likeRenderer() {
    return playerBar()?.querySelector('ytmusic-like-button-renderer') || null;
  }
  function likeButton() {
    const renderer = likeRenderer();
    return renderer?.querySelector('#button-shape-like button, #button-shape-like, .like button, tp-yt-paper-icon-button.like, .like') || null;
  }
  function isLiked() {
    const renderer = likeRenderer();
    if (renderer?.getAttribute('like-status')) return renderer.getAttribute('like-status') === 'LIKE';
    const button = likeButton();
    return (button?.querySelector?.('button') || button)?.getAttribute?.('aria-pressed') === 'true';
  }
  function toggleLike() { return press(likeButton()); }
  // Play / pause goes through the player itself (the bridge), like the Space key; without a recent
  // player sample, the <video>. Previous / next / shuffle / repeat press YouTube Music's buttons.
  const transport = {
    play: () => {
      if (bridge && lastSnapshot.videoId && performance.now() - lastSnapshot.at < 1500) {
        bridge.send({type: 'toggle-playback', payload: {videoId: lastSnapshot.videoId}});
        return;
      }
      const media = currentVideo();
      if (media) media.paused ? media.play() : media.pause();
      else press(barButton('#play-pause-button'));
    },
    prev: () => pressChanging(barButton('.previous-button'), trackState),
    next: () => pressChanging(barButton('.next-button'), trackState),
    // YouTube Music's shuffle is on/off (press again to stop). Its button may not say which, so
    // what changes on it between the two is learned from our own presses (see shuffleOn).
    shuffle: () => {
      const el = barButton('.shuffle');
      if (!el) return;
      const before = shuffleSignature(), wasOn = shuffleOn();
      pressChanging(el, stateOf);
      shuffleLearned.local = !wasOn;
      flashButton(ui.shuffle);
      syncShuffleRepeat();
      showToast(wasOn ? 'シャッフル：オフ' : 'シャッフル：オン', wasOn ? '曲順を元に戻しました' : '曲順を並べ替えて再生します', '', 'シャッフル');
      setTimeout(() => {
        const after = shuffleSignature();
        if (after && after !== before) {
          shuffleLearned.on = wasOn ? before : after;
          shuffleLearned.off = wasOn ? after : before;
        }
        syncShuffleRepeat();
      }, 700);
    },
    repeat: () => {
      pressChanging(barButton('.repeat'), stateOf);
      flashButton(ui.repeat);
      setTimeout(syncShuffleRepeat, 150); setTimeout(syncShuffleRepeat, 500); setTimeout(syncShuffleRepeat, 1000);
    },
  };

  // A volume control: speaker button (mute) and a slider. Any number can be made; all stay in step.
  const volumeControls = new Set();
  function volumeIcon(volume, muted) {
    return muted || volume === 0 ? ICONS.speakerMuted : volume < 50 ? ICONS.speakerLow : ICONS.speaker;
  }
  function createVolumeControl(className = '') {
    const wrap = document.createElement('div');
    wrap.className = `ytmls-am-volume ${className}`.trim();
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'ytmls-am-btn ytmls-am-volume-icon';
    mute.addEventListener('click', toggleMute);
    const slider = document.createElement('div');
    slider.className = 'ytmls-am-volume-slider';
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-label', '音量');
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', '100');
    slider.tabIndex = 0;
    slider.innerHTML = '<span class="ytmls-am-volume-track"><span class="ytmls-am-volume-fill"></span></span><span class="ytmls-am-volume-knob"></span>';
    let dragging = false;
    const fromPointer = event => {
      const rect = slider.getBoundingClientRect();
      setVolume(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100);
    };
    slider.addEventListener('pointerdown', event => {
      dragging = true; slider.setPointerCapture?.(event.pointerId); slider.classList.add('is-dragging'); fromPointer(event); event.preventDefault();
    });
    slider.addEventListener('pointermove', event => { if (dragging) fromPointer(event); });
    const end = () => { dragging = false; slider.classList.remove('is-dragging'); };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
    slider.addEventListener('keydown', event => {
      const step = {ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5}[event.key];
      if (step === undefined) return;
      event.preventDefault(); event.stopPropagation();
      setVolume(getVolume().volume + step);
    });
    slider.addEventListener('wheel', event => { event.preventDefault(); setVolume(getVolume().volume + (event.deltaY < 0 ? 4 : -4)); }, {passive: false});
    wrap.append(mute, slider);
    volumeControls.add({wrap, mute, slider});
    syncVolumeControls();
    return wrap;
  }
  function syncVolumeControls() {
    const {volume, muted} = getVolume();
    const shown = muted ? 0 : volume;
    for (const control of volumeControls) {
      if (!control.wrap.isConnected && control.wrap.dataset.mounted) { volumeControls.delete(control); continue; }
      if (control.wrap.isConnected) control.wrap.dataset.mounted = '1';
      control.slider.style.setProperty('--level', String(shown / 100));
      control.slider.setAttribute('aria-valuenow', String(shown));
      control.slider.setAttribute('aria-valuetext', muted ? '消音' : `${volume}%`);
      const label = muted ? '消音を解除' : '消音';
      if (control.mute.title !== label) { control.mute.title = label; control.mute.setAttribute('aria-label', label); }
      const icon = volumeIcon(volume, muted);
      if (control.mute.dataset.icon !== icon) { control.mute.dataset.icon = icon; control.mute.innerHTML = icon; }
    }
  }

  globalThis.ytmlsAppleControls = Object.freeze({
    transport, getVolume, setVolume, toggleMute, isLiked, toggleLike,
    hasLike: () => Boolean(likeButton()),
    createVolumeControl, syncVolumeControls,
    icons: ICONS,
  });

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
          // Going to a page from the sidebar also leaves the Now Playing page, so the page shows.
          closePlayerPage();
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

  function guideButton() {
    return q('ytmusic-nav-bar #guide-button') || q('ytmusic-nav-bar yt-icon-button.guide-button') || q('#guide-button');
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

  // A small "now playing" banner when the song changes (not on the first song after the page opens).
  let lastToastTitle = null;
  let toastTimer = 0;
  function showToast(title, subtitle, art, label = '再生中') {
    if (!shell || document.hidden) return;
    let toast = ui.toast;
    if (!toast) {
      toast = ui.toast = document.createElement('div');
      toast.className = 'ytmls-am-toast';
      toast.setAttribute('role', 'status');
      toast.innerHTML = '<img alt=""><span class="ytmls-am-toast-text"><span class="ytmls-am-toast-label">再生中</span><span class="ytmls-am-toast-title"></span><span class="ytmls-am-toast-sub"></span></span>';
      shell.append(toast);
    }
    const img = toast.querySelector('img');
    if (art) img.setAttribute('src', art); else img.removeAttribute('src');
    img.hidden = !art;
    toast.querySelector('.ytmls-am-toast-label').textContent = label;
    toast.querySelector('.ytmls-am-toast-title').textContent = title;
    toast.querySelector('.ytmls-am-toast-sub').textContent = subtitle;
    toast.classList.remove('is-shown');
    void toast.offsetWidth;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 3600);
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
    const liked = isLiked();
    ui.star.hidden = !likeButton();
    ui.star.classList.toggle('is-on', liked);
    if (ui.star.dataset.on !== String(liked)) {
      ui.star.dataset.on = String(liked);
      ui.star.innerHTML = liked ? ICONS.starFilled : ICONS.star;
      ui.star.setAttribute('aria-pressed', String(liked));
    }
    if (title && title !== lastToastTitle) {
      if (lastToastTitle !== null) showToast(title, subtitle, art);
      lastToastTitle = title;
    }
    syncVolumeControls();
    if (ui.title.textContent !== title) ui.title.textContent = title;
    if (ui.subtitle.textContent !== subtitle) ui.subtitle.textContent = subtitle;
    if (art && ui.art.getAttribute('src') !== art) ui.art.setAttribute('src', art);
    ui.art.hidden = !art || !title;
    for (const [name, selector] of [['shuffle', '.shuffle'], ['repeat', '.repeat']]) {
      const native = barButton(selector);
      ui[name].hidden = !native;
    }
    syncShuffleRepeat();
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
  function playerPageOpen() {
    return Boolean(layoutEl()?.hasAttribute('player-page-open'));
  }
  // Close the Now Playing page (YouTube Music's own ⌄ button sits in its hidden player bar).
  function closePlayerPage() {
    if (!playerPageOpen()) return false;
    press(barButton('.toggle-player-page-button')) || playerBar()?.click();
    return true;
  }
  // The now-playing display opens the Now Playing page, and closes it again, like the Mac.
  function togglePlayerPage() {
    if (!closePlayerPage()) openPlayerPage();
  }
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

  // ---------- lyrics panel / mini player (content.js: side-lyrics.js) ----------
  // While the Now Playing page is open it already shows the lyrics, so the button picks its tab;
  // otherwise it opens the lyrics panel on the right, like the Mac.
  function toggleLyricsView() {
    const side = globalThis.ytmlsSideLyrics;
    if (layoutEl()?.hasAttribute('player-page-open') || !side) { side?.toggle(false); openPlayerPage('lyrics'); return; }
    if (side.toggle()) toggleQueuePanel(false);
    syncViewButtons();
  }

  // ---------- "Up Next" panel on the right (the Mac's queue sidebar) ----------
  // Reads YouTube Music's own queue (the 次のコンテンツ tab's items, there even while the Now Playing
  // page is closed) and plays an item by pressing it.
  let queuePanel = null;
  let queueSignature = '';
  function queueItems() {
    // The same list, in the same order, as the bridge's queue-info.
    return [...document.querySelectorAll('ytmusic-player-queue-item')];
  }
  // Pictures from the bridge (index → {videoId, thumb}); asked for again when the list changes.
  let queueThumbs = [];
  let queueThumbsFor = '';
  bridge?.listen?.(message => {
    if (message?.type !== 'queue-info' || !Array.isArray(message.payload)) return;
    queueThumbs = message.payload;
    queueSignature = '';
    renderQueuePanel();
  });
  function queueThumbAt(index) {
    const info = queueThumbs[index];
    if (!info) return '';
    if (/^https:\/\//.test(info.thumb)) return info.thumb;
    return /^[\w-]{6,20}$/.test(info.videoId) ? `https://i.ytimg.com/vi/${info.videoId}/default.jpg` : '';
  }
  function queueItemInfo(item, index) {
    const text = selector => item.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || '';
    const img = item.querySelector('img');
    const state = item.getAttribute('play-button-state') || '';
    return {
      title: text('.song-title') || text('.title'),
      byline: text('.byline'),
      duration: text('.duration'),
      art: [img?.currentSrc, img?.src].find(src => /^https:\/\//.test(src || '')) || queueThumbAt(index),
      current: item.hasAttribute('selected') || state === 'playing' || state === 'paused',
    };
  }
  function playQueueItem(item) {
    const before = trackState();
    const target = item.querySelector('.song-info, .left-items, .song-title') || item;
    target.click();
    setTimeout(() => {
      if (trackState() !== before) return;
      try { item.dispatchEvent(new CustomEvent('tap', {bubbles: true, cancelable: true, composed: true})); } catch (_) {}
    }, 700);
  }
  function buildQueuePanel() {
    if (queuePanel) return queuePanel;
    queuePanel = document.createElement('aside');
    queuePanel.id = 'ytmls-side-queue';
    queuePanel.className = 'ytmls-side-panel';
    queuePanel.setAttribute('aria-label', '次に再生');
    queuePanel.hidden = true;
    queuePanel.innerHTML = '<div class="ytmls-side-head"><span class="ytmls-side-title">次に再生</span><button type="button" class="ytmls-side-close" title="閉じる" aria-label="閉じる"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div><p class="ytmls-side-message"></p><div class="ytmls-queue-list" role="list"></div>';
    queuePanel.querySelector('.ytmls-side-close').addEventListener('click', () => toggleQueuePanel(false));
    queuePanel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); toggleQueuePanel(false); } });
    document.body.append(queuePanel);
    return queuePanel;
  }
  function renderQueuePanel() {
    if (!queuePanel || queuePanel.hidden) return;
    const items = queueItems();
    const infos = items.map((item, index) => queueItemInfo(item, index));
    // A new or changed list: ask the player for its pictures.
    const listKey = infos.map(info => info.title).join('\n');
    if (listKey !== queueThumbsFor && bridge) { queueThumbsFor = listKey; bridge.send({type: 'queue-info'}); }
    const signature = JSON.stringify(infos.map(info => [info.title, info.byline, info.current, info.art]));
    if (signature === queueSignature) return;
    queueSignature = signature;
    const message = queuePanel.querySelector('.ytmls-side-message');
    message.textContent = items.length ? '' : '再生待ちの曲はありません。曲を再生すると、ここに並びます。';
    message.hidden = Boolean(items.length);
    const list = queuePanel.querySelector('.ytmls-queue-list');
    const scroll = list.scrollTop;
    list.replaceChildren();
    let currentRow = null;
    items.forEach((item, index) => {
      const info = infos[index];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ytmls-queue-row';
      row.setAttribute('role', 'listitem');
      if (info.current) { row.classList.add('is-current'); row.setAttribute('aria-current', 'true'); currentRow = row; }
      const art = document.createElement('img');
      art.className = 'ytmls-queue-art';
      art.alt = '';
      art.loading = 'lazy';
      if (/^https:/.test(info.art)) art.src = info.art;
      const textBox = document.createElement('span');
      textBox.className = 'ytmls-queue-text';
      const title = document.createElement('span');
      title.className = 'ytmls-queue-title';
      title.textContent = info.title || '—';
      const byline = document.createElement('span');
      byline.className = 'ytmls-queue-byline';
      byline.textContent = info.byline;
      textBox.append(title, byline);
      const duration = document.createElement('span');
      duration.className = 'ytmls-queue-duration';
      duration.textContent = info.current ? '' : info.duration;
      if (info.current) duration.innerHTML = '<span class="ytmls-queue-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
      row.append(art, textBox, duration);
      row.title = [info.title, info.byline].filter(Boolean).join(' — ');
      row.addEventListener('click', () => playQueueItem(item));
      list.append(row);
    });
    list.scrollTop = scroll;
    if (currentRow && !queuePanel.dataset.scrolled) {
      queuePanel.dataset.scrolled = '1';
      list.scrollTop = Math.max(0, currentRow.offsetTop - 12);
    }
  }
  function toggleQueuePanel(force) {
    const panel = buildQueuePanel();
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    root.classList.toggle('ytmls-side-queue-open', open);
    if (open) {
      globalThis.ytmlsSideLyrics?.toggle(false);
      queueSignature = '';
      delete panel.dataset.scrolled;
      renderQueuePanel();
    }
    syncViewButtons();
    return open;
  }
  function toggleQueueView() {
    if (layoutEl()?.hasAttribute('player-page-open')) { toggleQueuePanel(false); openPlayerPage('queue'); return; }
    toggleQueuePanel();
  }
  function toggleMiniPlayer() {
    const mini = globalThis.ytmlsMiniPlayer;
    if (!mini?.supported()) { showToast('ミニプレーヤーを使えません', 'Chrome 116 以降で使えます', '', 'ミニプレーヤー'); return; }
    Promise.resolve(mini.toggle()).finally(syncViewButtons);
  }
  function syncViewButtons() {
    const side = globalThis.ytmlsSideLyrics, mini = globalThis.ytmlsMiniPlayer;
    if (ui.lyrics) ui.lyrics.classList.toggle('is-on', Boolean(side?.isOpen()));
    if (ui.queue) ui.queue.classList.toggle('is-on', Boolean(queuePanel && !queuePanel.hidden));
    if (ui.miniplayer) {
      ui.miniplayer.classList.toggle('is-on', Boolean(mini?.isOpen()));
      ui.miniplayer.hidden = mini ? !mini.supported() : true;
    }
  }

  // ---------- Mac-style shortcuts (Ctrl on Windows, ⌘ on Mac) ----------
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const MOD = isMac ? '⌘' : 'Ctrl+';
  const SHIFT = isMac ? '⇧' : 'Shift+';
  const SHORTCUTS = [
    {name: 'next', label: '次へ', keys: `${MOD}→`, match: e => !e.shiftKey && e.key === 'ArrowRight', run: () => transport.next(), text: false},
    {name: 'prev', label: '前へ', keys: `${MOD}←`, match: e => !e.shiftKey && e.key === 'ArrowLeft', run: () => transport.prev(), text: false},
    {name: 'volumeUp', label: '音量を上げる', keys: `${MOD}↑`, match: e => !e.shiftKey && e.key === 'ArrowUp', run: () => setVolume(getVolume().volume + 10), text: false},
    {name: 'volumeDown', label: '音量を下げる', keys: `${MOD}↓`, match: e => !e.shiftKey && e.key === 'ArrowDown', run: () => setVolume(getVolume().volume - 10), text: false},
    {name: 'search', label: '検索', keys: `${MOD}F`, match: e => !e.shiftKey && e.code === 'KeyF', run: focusSearch, text: true},
    {name: 'lyrics', label: '歌詞', keys: `${SHIFT}${MOD}L`, match: e => e.shiftKey && e.code === 'KeyL', run: () => toggleLyricsView(), text: true},
    {name: 'queue', label: '次に再生', keys: `${SHIFT}${MOD}U`, match: e => e.shiftKey && e.code === 'KeyU', run: () => toggleQueueView(), text: true},
    {name: 'miniplayer', label: 'ミニプレーヤー', keys: `${SHIFT}${MOD}P`, match: e => e.shiftKey && e.code === 'KeyP', run: () => toggleMiniPlayer(), text: true},
  ];
  function editableTarget(event) {
    return event.composedPath().some(el => el instanceof Element && (el.isContentEditable || el.matches('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')));
  }
  function focusSearch() {
    const input = ui.searchBox?.querySelector('input');
    if (!input) return;
    if (root.classList.contains('ytmls-am-no-side')) root.classList.add('ytmls-am-drawer-open');
    else if (root.classList.contains('ytmls-am-compact')) ui.searchBox.classList.add('is-open');
    input.focus();
    input.select();
  }
  document.addEventListener('keydown', event => {
    if (!root.classList.contains('ytmls-am') || event.altKey || event.isComposing) return;
    if (!(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
    const shortcut = SHORTCUTS.find(item => item.match(event));
    if (!shortcut) return;
    // Arrow keys with Ctrl move by word in a text field: leave those to the field.
    if (!shortcut.text && editableTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat || shortcut.name.startsWith('volume')) shortcut.run();
  }, true);
  function addShortcutHints() {
    for (const shortcut of SHORTCUTS) {
      const el = ui[shortcut.name];
      if (!el) continue;
      const label = `${shortcut.label}（${shortcut.keys}）`;
      el.title = label;
      el.setAttribute('aria-keyshortcuts', shortcut.keys.replace('⌘', 'Meta+').replace('⇧', 'Shift+'));
    }
    const input = ui.searchBox?.querySelector('input');
    if (input) input.placeholder = `検索（${MOD}F）`;
  }

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
    // Wide / icon-only sidebar: YouTube Music's own ≡ button (hidden with its top bar) switches its
    // side menu between the two, and the sidebar follows the space it takes.
    const sideHead = document.createElement('div');
    sideHead.className = 'ytmls-am-side-head';
    const sideToggle = document.createElement('button');
    sideToggle.type = 'button';
    sideToggle.className = 'ytmls-am-btn ytmls-am-side-toggle';
    sideToggle.innerHTML = ICONS.sidebar;
    sideToggle.addEventListener('click', () => {
      press(guideButton());
      followLayout(900);
    });
    ui.sideToggle = sideToggle;
    sideHead.append(sideToggle);
    sidebar.append(sideHead, searchBox, searchToggle, ui.nav);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ytmls-am-toolbar';
    const left = document.createElement('div');
    left.className = 'ytmls-am-cluster ytmls-am-left';
    const menu = button('menu', 'メニュー', 'menu', () => root.classList.toggle('ytmls-am-drawer-open'));
    const controls = document.createElement('div');
    controls.className = 'ytmls-am-capsule ytmls-am-controls';
    controls.append(
      button('shuffle', 'シャッフル', 'shuffle', transport.shuffle),
      button('prev', '前へ', 'prev', transport.prev),
      button('play', '再生', 'play', transport.play),
      button('next', '次へ', 'next', transport.next),
      button('repeat', 'リピート', 'repeat', transport.repeat),
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
    info.title = '再生中の画面を開く・閉じる（Esc でも閉じる）';
    ui.title = document.createElement('span');
    ui.title.className = 'ytmls-am-title';
    ui.subtitle = document.createElement('span');
    ui.subtitle.className = 'ytmls-am-subtitle';
    info.append(ui.title, ui.subtitle);
    info.addEventListener('click', togglePlayerPage);
    ui.art.addEventListener('click', togglePlayerPage);
    ui.progress = document.createElement('div');
    ui.progress.className = 'ytmls-am-progress';
    ui.progress.setAttribute('aria-label', '再生位置');
    ui.progress.innerHTML = '<span class="ytmls-am-progress-track"><span class="ytmls-am-progress-fill"></span></span>';
    ui.progressFill = ui.progress.querySelector('.ytmls-am-progress-fill');
    ui.elapsed = document.createElement('span');
    ui.elapsed.className = 'ytmls-am-time ytmls-am-elapsed';
    ui.remaining = document.createElement('span');
    ui.remaining.className = 'ytmls-am-time ytmls-am-remaining';
    const star = button('star', 'お気に入り（高評価）', 'star', () => { toggleLike(); setTimeout(updateNowPlaying, 250); setTimeout(updateNowPlaying, 900); });
    lcd.append(ui.art, placeholder, info, star, ui.elapsed, ui.remaining, ui.progress);
    bindProgress();

    const right = document.createElement('div');
    right.className = 'ytmls-am-cluster ytmls-am-right';
    const views = document.createElement('div');
    views.className = 'ytmls-am-capsule';
    views.append(
      button('lyrics', '歌詞', 'lyrics', toggleLyricsView),
      button('queue', '次に再生', 'queue', toggleQueueView),
      button('miniplayer', 'ミニプレーヤー', 'miniplayer', toggleMiniPlayer),
    );
    ui.volume = createVolumeControl('ytmls-am-capsule');
    right.append(ui.volume, views, button('account', 'アカウント', 'account', () => {
      const native = q('ytmusic-nav-bar ytmusic-settings-button');
      press(native?.querySelector('button, tp-yt-paper-icon-button, #button, img') || native);
    }));

    toolbar.append(left, lcd, right);
    const scrim = document.createElement('div');
    scrim.className = 'ytmls-am-scrim';
    scrim.addEventListener('click', closeDrawer);
    shell.append(scrim, sidebar, toolbar);
    document.body.append(shell);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeDrawer();
      // Esc leaves the Now Playing page, unless something on top of it takes Esc first (menus,
      // panes, text fields, the lyrics tools…).
      if (event.defaultPrevented || !root.classList.contains('ytmls-am') || !playerPageOpen()) return;
      if (editableTarget(event)) return;
      if (document.querySelector('tp-yt-iron-dropdown:not([aria-hidden="true"]):not([style*="display: none"]) ytmusic-menu-popup-renderer, #ytmls-more[open], #ytmls-tools-pane:not([hidden]), #ytmls-track-offset-popover:not([hidden]), #ytmls-fullscreen, tp-yt-paper-dialog[opened]')) return;
      closePlayerPage();
    });
    addShortcutHints();
  }

  // ---------- keeping it in place ----------
  function active() {
    return settingsLoaded && wanted && extensionEnabled && !document.fullscreenElement && !layoutEl()?.hasAttribute('player-fullscreened');
  }

  let lastSide = 0;
  let sideGoneSince = 0;
  // Follow the side menu every frame for a short while (after the sidebar switch).
  function followLayout(ms) {
    const until = performance.now() + ms;
    const step = () => { refresh(); if (performance.now() < until) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function refresh() {
    if (!active()) {
      root.classList.remove('ytmls-am', 'ytmls-am-compact', 'ytmls-am-no-side');
      if (queuePanel && !queuePanel.hidden) toggleQueuePanel(false);
      return;
    }
    const layout = measure();
    if (!layout) { root.classList.remove('ytmls-am'); return; }
    // While YouTube Music switches its side menu, for a moment neither the wide nor the narrow one
    // is there: keep the last width until the gap has lasted a while (no flash of a missing sidebar).
    const now = performance.now();
    if (layout.side < 40 && lastSide >= 40) {
      if (!sideGoneSince) sideGoneSince = now;
      if (now - sideGoneSince < 700) { layout.side = lastSide; setTimeout(queueRefresh, 120); }
    } else sideGoneSince = 0;
    lastSide = layout.side;
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
    if (ui.sideToggle) {
      ui.sideToggle.hidden = !guideButton() || layout.side < 40;
      const label = layout.side >= 160 ? 'サイドバーを狭くする' : 'サイドバーを広げる';
      if (ui.sideToggle.title !== label) { ui.sideToggle.title = label; ui.sideToggle.setAttribute('aria-label', label); }
    }
    renderGuide();
    if (layoutEl()?.hasAttribute('player-page-open') && globalThis.ytmlsSideLyrics?.isOpen()) globalThis.ytmlsSideLyrics.toggle(false);
    if (queuePanel && !queuePanel.hidden) {
      if (layoutEl()?.hasAttribute('player-page-open')) toggleQueuePanel(false);
      else renderQueuePanel();
    }
    syncViewButtons();
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
