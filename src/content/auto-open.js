  // ---------- YouTube Music の「歌詞」タブ ----------
  function findLyricsRenderer() {
    return (
      document.querySelector('#side-panel #tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
      document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
      document.querySelector('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]')
    );
  }

  function isUsableTabElement(el) {
    if (!el || !(el instanceof Element)) return false;
    // 拡張自身の「歌詞 ±秒」ボタンやポップオーバーを、歌詞タブとして再検出しない。
    if (el.closest && el.closest('#ytmls-panel, #ytmls-track-offset-popover, [id^="ytmls-"]')) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (_) {}
    return true;
  }

  function getPlayerPageTabs() {
    const selectors = [
      'ytmusic-player-page #tabs tp-yt-paper-tab',
      'ytmusic-player-page #tabs paper-tab',
      'ytmusic-player-page tp-yt-paper-tabs tp-yt-paper-tab',
      'ytmusic-player-page paper-tabs paper-tab',
      'ytmusic-player-page #tabs [role="tab"]',
      '#side-panel tp-yt-paper-tab',
      '#side-panel paper-tab',
      '#side-panel [role="tab"]',
      'ytmusic-player-page [role="tab"]',
      'ytmusic-player-page tp-yt-paper-tab',
      'ytmusic-player-page paper-tab',
      'ytmusic-tab-renderer [role="tab"]',
    ];
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isUsableTabElement(el) || seen.has(el)) continue;
        if (el.closest && el.closest('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]')) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function normalizedTabText(el) {
    if (!el) return '';
    return [
      el.textContent,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('data-title'),
      el.dataset && el.dataset.title,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isLyricsLabelText(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label === '歌詞' || label === 'lyrics' || label.includes('歌詞') || /(^|\s)lyrics($|\s)/i.test(label);
  }

  function closestTabLikeElement(node) {
    if (!node || !(node instanceof Element)) return null;
    const strictSelector = 'tp-yt-paper-tab, paper-tab, [role="tab"]';
    let candidate = node.matches(strictSelector) ? node : node.closest(strictSelector);

    // UIによってタブがbuttonになる場合も、実際のタブコンテナ内だけを許可する。
    if (!candidate) {
      const button = node.matches('button, [aria-selected]') ? node : node.closest('button, [aria-selected]');
      const tabContainer = button && button.closest('#tabs, tp-yt-paper-tabs, paper-tabs, [role="tablist"]');
      if (button && tabContainer) candidate = button;
    }
    return isUsableTabElement(candidate) ? candidate : null;
  }

  function findLyricsTabButton() {
    const tabs = getPlayerPageTabs();

    // 1) 通常のタブ要素からラベルで特定。
    for (const el of tabs) {
      if (isLyricsLabelText(normalizedTabText(el))) return el;
    }

    // 2) 現行UIではラベルがyt-formatted-string等の子要素にだけ入ることがある。
    //    「歌詞 / Lyrics」という実テキストを探して、クリック可能な親タブまで戻る。
    const roots = [
      document.querySelector('ytmusic-player-page'),
      document.querySelector('#side-panel'),
      document
    ].filter(Boolean);
    const labelSelectors = [
      'yt-formatted-string', '.tab-content', '[aria-label]', '[title]',
      'span', 'div'
    ];
    const labelSeen = new Set();
    for (const root of roots) {
      for (const selector of labelSelectors) {
        for (const node of root.querySelectorAll(selector)) {
          if (!node || labelSeen.has(node)) continue;
          labelSeen.add(node);
          const text = normalizedTabText(node);
          if (!isLyricsLabelText(text)) continue;
          const tab = closestTabLikeElement(node);
          if (tab) return tab;
        }
      }
    }

    // 3) UI更新で文字列が取れない場合はrendererとタブの並び順を照合。
    const renderers = Array.from(document.querySelectorAll(
      '#side-panel ytmusic-tab-renderer[page-type], ytmusic-player-page #side-panel [page-type], ytmusic-player-page ytmusic-tab-renderer[page-type]'
    ));
    const uniqueRenderers = [];
    const rendererSeen = new Set();
    for (const renderer of renderers) {
      if (!renderer || rendererSeen.has(renderer)) continue;
      rendererSeen.add(renderer);
      uniqueRenderers.push(renderer);
    }
    const lyricsIndex = uniqueRenderers.findIndex((renderer) =>
      renderer.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS'
    );
    if (lyricsIndex >= 0 && tabs[lyricsIndex]) return tabs[lyricsIndex];

    return null;
  }

  function isLyricsTabSelected(tab) {
    if (!tab) return false;
    if (isLyricsViewVisible()) return true;
    return tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('aria-current') === 'page' ||
      tab.hasAttribute('selected') ||
      tab.classList.contains('iron-selected') ||
      tab.classList.contains('selected') ||
      tab.classList.contains('active');
  }

  function isLyricsViewVisible() {
    if (externalLyricsOpen && externalLyricsHost && !externalLyricsHost.hidden) return true;
    const renderer = findLyricsRenderer();
    if (!renderer) return false;
    try {
      const style = getComputedStyle(renderer);
      return renderer.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) {
      return false;
    }
  }

  function clickLyricsTab(tab) {
    if (!tab) return false;
    const targets = [tab];
    const innerLabel = Array.from(tab.querySelectorAll ? tab.querySelectorAll('yt-formatted-string, .tab-content, span') : [])
      .find((el) => isLyricsLabelText(normalizedTabText(el)));
    if (innerLabel) targets.push(innerLabel);

    let attempted = false;
    for (const target of targets) {
      try { target.focus && target.focus({ preventScroll: true }); } catch (_) {}
      try {
        if (typeof PointerEvent === 'function') {
          target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse' }));
          target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse' }));
        }
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, button: 0 }));
      } catch (_) {}
      try {
        target.click();
        attempted = true;
      } catch (_) {
        try {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
          attempted = true;
        } catch (_) {}
      }
      // YouTube MusicのPolymer系UI向け。標準clickが取りこぼされた場合の補助。
      try {
        target.dispatchEvent(new CustomEvent('tap', { bubbles: true, cancelable: true, composed: true }));
      } catch (_) {}
    }
    return attempted;
  }

  // v1.8.5: 「次のコンテンツ」が選択されている間だけ無操作時間を測る。
  // 操作したらその曲を永久キャンセルせず、最後の操作から2秒を数え直す。
  // YouTube MusicのタブDOM/selected属性の揺れに備えて、ラベル・paper-tabsのselected・
  // page-type renderer・タブ並びの4経路で現在タブを判定する。
  const AUTO_LYRICS_IDLE_DELAY_MS = 2000;
  const AUTO_LYRICS_RETRY_MS = 450;

  function isTabActive(tab) {
    if (!tab) return false;
    return tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('aria-current') === 'page' ||
      tab.hasAttribute('selected') ||
      tab.classList.contains('iron-selected') ||
      tab.classList.contains('selected') ||
      tab.classList.contains('active');
  }

  function getTabContainers() {
    const selectors = [
      'ytmusic-player-page #tabs',
      'ytmusic-player-page tp-yt-paper-tabs',
      'ytmusic-player-page paper-tabs',
      '#side-panel tp-yt-paper-tabs',
      '#side-panel paper-tabs'
    ];
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function getTabsForContainer(container) {
    if (!container) return [];
    const selectors = [':scope > tp-yt-paper-tab', ':scope > paper-tab', ':scope > [role="tab"]'];
    for (const selector of selectors) {
      try {
        const tabs = Array.from(container.querySelectorAll(selector)).filter(isUsableTabElement);
        if (tabs.length) return tabs;
      } catch (_) {}
    }
    return [];
  }

  function getSelectedPlayerTab() {
    const allTabs = getPlayerPageTabs();
    for (const tab of allTabs) {
      if (isTabActive(tab)) return tab;
    }

    // Polymerのpaper-tabsは子tabではなく親側のselected="0"だけ更新するUIがある。
    for (const container of getTabContainers()) {
      const tabs = getTabsForContainer(container);
      if (!tabs.length) continue;
      let index = Number.parseInt(container.getAttribute('selected') || '', 10);
      if (!Number.isFinite(index)) {
        try { index = Number.parseInt(String(container.selected), 10); } catch (_) {}
      }
      if (Number.isFinite(index) && index >= 0 && index < tabs.length) return tabs[index];
      try {
        if (container.selectedItem && tabs.includes(container.selectedItem)) return container.selectedItem;
      } catch (_) {}
    }

    return null;
  }

  function tabLabel(tab) {
    return normalizedTabText(tab);
  }

  function isNextContentLabel(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label.includes('次のコンテンツ') ||
      label.includes('次に再生') ||
      label === 'up next' ||
      label.includes('up next') ||
      label === 'queue' ||
      label.includes('queue');
  }

  function isRelatedLabel(text) {
    const label = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label === '関連' || label.includes('関連') || label === 'related' || /(^|\s)related($|\s)/i.test(label);
  }

  function findNextContentTabButton() {
    const tabs = getPlayerPageTabs();

    // 1) ラベルで直接探す。
    for (const tab of tabs) {
      if (isNextContentLabel(tabLabel(tab))) return tab;
    }

    // 2) 子要素の文字しか取れないUI。
    const roots = [document.querySelector('ytmusic-player-page'), document.querySelector('#side-panel'), document].filter(Boolean);
    const selectors = ['yt-formatted-string', '.tab-content', '[aria-label]', '[title]', 'span'];
    const seen = new Set();
    for (const root of roots) {
      for (const selector of selectors) {
        for (const node of root.querySelectorAll(selector)) {
          if (!node || seen.has(node)) continue;
          seen.add(node);
          if (!isNextContentLabel(normalizedTabText(node))) continue;
          const tab = closestTabLikeElement(node);
          if (tab) return tab;
        }
      }
    }

    // 3) 現行YouTube Musicは「次のコンテンツ / 歌詞 / 関連」の順。
    //    Lyricsの直前をUp nextとして使うのは、文字列/page-typeが取れない時だけの最後のfallback。
    const lyricsTab = findLyricsTabButton();
    if (lyricsTab) {
      const index = tabs.indexOf(lyricsTab);
      if (index > 0 && tabs[index - 1]) return tabs[index - 1];
    }
    return null;
  }

  function findRelatedTabButton() {
    for (const tab of getPlayerPageTabs()) {
      if (isRelatedLabel(tabLabel(tab))) return tab;
    }
    return null;
  }

  function isVisibleRenderer(renderer) {
    if (!renderer) return false;
    try {
      const style = getComputedStyle(renderer);
      return renderer.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) {
      return false;
    }
  }

  function visiblePlayerPageType() {
    const renderers = document.querySelectorAll(
      '#side-panel ytmusic-tab-renderer[page-type], ytmusic-player-page ytmusic-tab-renderer[page-type], #side-panel [page-type]'
    );
    for (const renderer of renderers) {
      if (!isVisibleRenderer(renderer)) continue;
      const pageType = String(renderer.getAttribute('page-type') || '').toUpperCase();
      if (pageType) return pageType;
    }
    return '';
  }

  function isNextContentViewActive() {
    if (isLyricsViewVisible()) return false;

    const selected = getSelectedPlayerTab();
    if (selected) {
      const label = tabLabel(selected);
      if (isNextContentLabel(label)) return true;
      if (isLyricsLabelText(label) || isRelatedLabel(label)) return false;

      const nextTab = findNextContentTabButton();
      if (nextTab && selected === nextTab) return true;
      const relatedTab = findRelatedTabButton();
      if (relatedTab && selected === relatedTab) return false;
    }

    // page-typeが取れる場合はこちらを優先。実UIの内部名変更に備えて広めに見る。
    const pageType = visiblePlayerPageType();
    if (pageType) {
      if (pageType.includes('LYRICS')) return false;
      if (pageType.includes('RELATED')) return false;
      if (pageType.includes('UP_NEXT') || pageType.includes('UPNEXT') || pageType.includes('QUEUE') || pageType.includes('NEXT')) return true;
    }

    // 最終fallback: Lyrics/Relatedのどちらも選択されておらず、Up nextタブが存在する場合。
    // paper-tabsのselected属性が一切取れないYouTube Music UI向け。
    const nextTab = findNextContentTabButton();
    const lyricsTab = findLyricsTabButton();
    const relatedTab = findRelatedTabButton();
    if (nextTab && isTabActive(nextTab)) return true;
    if (lyricsTab && isTabActive(lyricsTab)) return false;
    if (relatedTab && isTabActive(relatedTab)) return false;
    return false;
  }

  function resetLyricsAutoOpenIdle() {
    STATE.lyricsAutoOpenToken += 1;
    STATE.lyricsAutoOpenExpectedVideoId = '';
    STATE.lyricsAutoOpenUntil = 0;
    STATE.lyricsAutoOpenSelectedSince = 0;
    STATE.lyricsAutoOpenArmedAt = 0;
    STATE.lyricsAutoOpenLastClickAt = 0;
  }

  function cancelLyricsAutoOpen() {
    resetLyricsAutoOpenIdle();
  }

  function noteUserInteraction(event) {
    if (!event || event.isTrusted !== true) return;
    const now = performance.now();
    STATE.lastUserInteractionAt = now;

    // 「次のコンテンツ」表示中の操作は永久キャンセルではなく、2秒タイマーをリセットするだけ。
    if (STATE.enabled && STATE.autoLyricsOnIdle && isNextContentViewActive()) {
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenLastClickAt = 0;
      STATE.lyricsAutoOpenExpectedVideoId = String(getAuthoritativeVideoId() || '');
    }
  }

  function bindAutoLyricsIdleInteractionWatch() {
    document.addEventListener('pointerdown', noteUserInteraction, true);
    document.addEventListener('keydown', noteUserInteraction, true);
    document.addEventListener('wheel', noteUserInteraction, { capture: true, passive: true });
    document.addEventListener('touchstart', noteUserInteraction, { capture: true, passive: true });
  }

  function openLyricsTabForTrack(expectedVideoId = '') {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) return;
    // 曲変更側から呼ばれても即クリックしない。次のコンテンツが実際に表示されてから
    // maintainLyricsAutoOpen() が無操作2秒を数える。
    const activeVideoId = String(expectedVideoId || getAuthoritativeVideoId() || '');
    if (activeVideoId) STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
  }

  function armLyricsAutoOpenIfNeeded(expectedVideoId = '') {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) return;
    if (!isNextContentViewActive()) return;
    if (isLyricsViewVisible()) return;

    const now = performance.now();
    const activeVideoId = String(expectedVideoId || getAuthoritativeVideoId() || '');
    if (!STATE.lyricsAutoOpenArmedAt) {
      // 次のコンテンツを検出した瞬間から2秒。検出より前の操作は影響させない。
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenLastClickAt = 0;
    } else if (activeVideoId && STATE.lyricsAutoOpenExpectedVideoId && activeVideoId !== STATE.lyricsAutoOpenExpectedVideoId) {
      // 曲が変わったら新しい曲として2秒を数え直す。
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenLastClickAt = 0;
    }
  }

  function tryAutoOpenLyricsTab() {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle || !STATE.lyricsAutoOpenArmedAt) return;
    if (!isNextContentViewActive()) {
      resetLyricsAutoOpenIdle();
      return;
    }

    const now = performance.now();
    const activeVideoId = String(getAuthoritativeVideoId() || '');
    if (STATE.lyricsAutoOpenExpectedVideoId && activeVideoId && activeVideoId !== STATE.lyricsAutoOpenExpectedVideoId) {
      STATE.lyricsAutoOpenExpectedVideoId = activeVideoId;
      STATE.lyricsAutoOpenArmedAt = now;
      STATE.lyricsAutoOpenLastClickAt = 0;
      return;
    }

    // 次のコンテンツを開いた後の「最後の実操作」から2秒。
    const idleStart = Math.max(STATE.lyricsAutoOpenArmedAt || 0, STATE.lastUserInteractionAt || 0);
    if (now - idleStart < AUTO_LYRICS_IDLE_DELAY_MS) return;

    const lyricsTab = findLyricsTabButton();
    if (!lyricsTab) return;
    if (nativeLyricsDisabled(lyricsTab)) { openExternalLyrics(); return; }
    if (isLyricsTabSelected(lyricsTab) || isLyricsViewVisible()) {
      requestAnimationFrame(() => ensureLyricsMount());
      resetLyricsAutoOpenIdle();
      return;
    }

    // クリックが1回取りこぼされても、次tickで再試行する。
    if (STATE.lyricsAutoOpenLastClickAt && now - STATE.lyricsAutoOpenLastClickAt < AUTO_LYRICS_RETRY_MS) return;
    STATE.lyricsAutoOpenLastClickAt = now;
    clickLyricsTab(lyricsTab);

    setTimeout(() => {
      const latestLyricsTab = findLyricsTabButton();
      if ((latestLyricsTab && isLyricsTabSelected(latestLyricsTab)) || isLyricsViewVisible()) {
        requestAnimationFrame(() => ensureLyricsMount());
        resetLyricsAutoOpenIdle();
      }
    }, 140);
  }

  function maintainLyricsAutoOpen() {
    if (!STATE.enabled || !STATE.autoLyricsOnIdle) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    if (isLyricsViewVisible()) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    if (!isNextContentViewActive()) {
      if (STATE.lyricsAutoOpenArmedAt) resetLyricsAutoOpenIdle();
      return;
    }

    armLyricsAutoOpenIfNeeded(getAuthoritativeVideoId());
    tryAutoOpenLyricsTab();
  }
