  // Native disabled tabs cannot be activated reliably. Keep their state intact
  // and provide an extension-owned button/view instead.
  let externalLyricsOpen = false;
  let externalLyricsHost = null;
  let externalLyricsButton = null;
  let externalLyricsTab = null;
  const externalHiddenContent = new Set();

  function restoreExternalBackdrop() {
    for (const el of externalHiddenContent) el.classList.remove('ytmls-external-obscured');
    externalHiddenContent.clear();
    document.querySelectorAll('.ytmls-external-native-label').forEach(el => el.classList.remove('ytmls-external-native-label'));
  }

  function hideExternalBackdrop(side, tab) {
    // Hide only content branches, preserving the native tabs and page backdrop.
    const tabs = tab.closest('#tabs, tp-yt-paper-tabs, paper-tabs, [role="tablist"]') || tab.parentElement;
    const visit = parent => {
      for (const el of parent.children) {
        if (el === tabs) continue;
        if (el.contains(tabs)) { visit(el); continue; }
        el.classList.add('ytmls-external-obscured');
        externalHiddenContent.add(el);
      }
    };
    if (side.contains(tabs)) visit(side);
    else for (const el of side.children) {
      el.classList.add('ytmls-external-obscured'); externalHiddenContent.add(el);
    }
  }

  function nativeLyricsDisabled(tab) {
    return !!tab && (tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true');
  }

  function closeExternalLyrics() {
    externalLyricsOpen = false;
    if (externalLyricsHost) externalLyricsHost.hidden = true;
    restoreExternalBackdrop();
  }

  function openExternalLyrics() {
    if (!STATE.enabled || !externalLyricsButton || externalLyricsButton.hidden) return false;
    externalLyricsOpen = true;
    ensureLyricsMount();
    checkTrackChange();
    return true;
  }

  function maintainExternalLyricsTab() {
    const tab = findLyricsTabButton();
    if (externalLyricsTab && externalLyricsTab !== tab) closeExternalLyrics();
    externalLyricsTab = tab;
    const side = document.querySelector('ytmusic-player-page #side-panel') || document.querySelector('#side-panel');
    const rect = tab?.getBoundingClientRect();
    const sideRect = side?.getBoundingClientRect();
    const usable = STATE.enabled && nativeLyricsDisabled(tab) && rect?.width > 0 && rect?.height > 0 &&
      sideRect?.width > 0 && sideRect?.bottom > rect.bottom && isVisibleRenderer(tab) && isVisibleRenderer(side);
    if (!usable) {
      closeExternalLyrics();
      if (externalLyricsButton) externalLyricsButton.hidden = true;
      return;
    }
    if (!externalLyricsButton) {
      externalLyricsButton = document.createElement('button');
      externalLyricsButton.id = 'ytmls-external-tab';
      externalLyricsButton.textContent = '歌詞';
      externalLyricsButton.title = '外部歌詞を表示・検索';
      externalLyricsButton.setAttribute('aria-label', '歌詞（外部歌詞を検索）');
      externalLyricsButton.addEventListener('click', openExternalLyrics);
      document.body.append(externalLyricsButton);
      externalLyricsHost = document.createElement('section');
      externalLyricsHost.id = 'ytmls-external-view';
      externalLyricsHost.setAttribute('aria-label', '外部歌詞');
      document.body.append(externalLyricsHost);
      document.addEventListener('click', event => {
        if (closestTabLikeElement(event.target)) {
          closeExternalLyrics();
          ensureLyricsMount();
        }
      }, true);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && externalLyricsOpen) {
          closeExternalLyrics(); ensureLyricsMount(); externalLyricsButton.focus();
        }
      });
    }
    externalLyricsButton.hidden = false;
    tab.classList.add('ytmls-external-native-label');
    const label = tab.querySelector('yt-formatted-string, .tab-content') || tab;
    const type = getComputedStyle(label);
    Object.assign(externalLyricsButton.style, {fontFamily: type.fontFamily, fontSize: type.fontSize, fontWeight: type.fontWeight, letterSpacing: type.letterSpacing});
    if (externalLyricsOpen) hideExternalBackdrop(side, tab);
    Object.assign(externalLyricsButton.style, {left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
    const bottom = Math.min(sideRect.bottom, document.querySelector('ytmusic-player-bar')?.getBoundingClientRect().top || innerHeight, innerHeight);
    Object.assign(externalLyricsHost.style, {left: sideRect.left + 'px', top: rect.bottom + 'px', width: sideRect.width + 'px', height: Math.max(0, bottom - rect.bottom) + 'px'});
    externalLyricsHost.hidden = !externalLyricsOpen;
    externalLyricsButton.setAttribute('aria-expanded', String(externalLyricsOpen));
  }
