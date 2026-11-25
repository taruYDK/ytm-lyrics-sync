  let helpfulTimer = null;
  function helpfulStatus() {
    if (STATE.contextInvalidated) return 'ページの再読み込みが必要です';
    if (!STATE.enabled) return '拡張機能はOFFです';
    if (STATE.isSearching) return STATE.hasLyricsResult ? '取得済み・ほかの候補を検索中' + (STATE.source ? ' · ' + STATE.source : '') : '歌詞を検索中…';
    // While lyrics play normally the source badge says enough; only exceptions get text.
    if (STATE.hasLyricsResult) return (STATE.hasSync ? (STATE.trackingEnabled ? '' : '読むモード') : '同期時刻のない歌詞') + (STATE.source ? ' · ' + STATE.source : '');
    return STATE.lastTrackKey ? '同期歌詞が見つかりません' : '曲の読み込み待ち';
  }
  function fitMoreMenu(more, menu) {
    if (!more.open || !panelEl) return;
    const panelBottom = panelEl.getBoundingClientRect().bottom;
    const menuTop = more.getBoundingClientRect().top + menu.offsetTop;
    const available = Math.max(0, Math.floor(Math.min(window.innerHeight, panelBottom) - menuTop - 8));
    const maxHeight = available + 'px';
    if (menu.style.maxHeight !== maxHeight) menu.style.maxHeight = maxHeight;
  }

  function updateHelpfulUi() {
    if (!panelEl || !lyricsToolsEl) return;
    let bar = panelEl.querySelector('#ytmls-helpful');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'ytmls-helpful';
      const status = document.createElement('span'); status.className = 'ytmls-fetch-status'; status.setAttribute('role','status');
      const statusText = document.createElement('span');
      statusText.className = 'ytmls-fetch-status-text';
      status.append(statusText);
      const back = document.createElement('button'); back.type = 'button'; back.className = 'ytmls-tool-button'; back.textContent = '今の歌詞に戻る';
      back.addEventListener('click', () => {
        if (!STATE.enabled || !STATE.trackingEnabled || !STATE.hasSync) return;
        resumeTrackingAfterLyricsSeek();
        updateHighlight(getAuthoritativePlaybackTime(getVideoElement()) || 0, true);
        updateHelpfulUi();
      });
      const source = document.createElement('span'); source.className = 'ytmls-source-badge';
      // Source first: it is the one label shown while lyrics play normally.
      bar.append(source, status, back); lyricsToolsEl.prepend(bar);
    }
    const text = helpfulStatus();
    const badge = bar.querySelector('.ytmls-source-badge');
    const source = STATE.enabled && !STATE.contextInvalidated && STATE.hasLyricsResult ? STATE.source || '' : '';
    badge.hidden = !source;
    if (badge.textContent !== source) badge.textContent = source;
    const badgeTitle = source && STATE.hasSync ? `${source}・${syncLevelShortLabel(STATE.syncLevel)}ごとに同期` : source;
    if (badge.title !== badgeTitle) badge.title = badgeTitle;
    const summary = (source ? text.replace(' · ' + source, '') : text).replace(/^ · /, '');
    const statusText = bar.querySelector('.ytmls-fetch-status-text');
    if (statusText.textContent !== summary) { statusText.textContent = summary; statusText.title = summary; }
    const browsing = Boolean(STATE.trackingEnabled && isManualScrollPaused());
    // Reading by manual scroll: other lines are shown unblurred.
    if (panelEl.dataset.browsing !== String(browsing)) panelEl.dataset.browsing = String(browsing);
    bar.lastChild.hidden = !(STATE.enabled && STATE.trackingEnabled && STATE.hasSync && browsing);
    const more = lyricsToolsEl.querySelector('#ytmls-more');
    const menu = more?.querySelector('.ytmls-more-menu');
    if (menu) fitMoreMenu(more, menu);
    if (menu) for (const button of menu.querySelectorAll('button')) updateHelpfulMenuHint(button);
    if (helpfulTimer === null) helpfulTimer = setTimeout(() => { helpfulTimer = null; updateHelpfulUi(); }, 500);
  }

  function updateHelpfulMenuHint(button) {
    let hint = button.nextElementSibling;
    // Presets share a flex row: per-button hints would become extra columns.
    if (button.closest?.('.ytmls-size-presets')) {
      if (hint?.classList.contains('ytmls-menu-hint')) hint.remove();
      return;
    }
    if (!hint?.classList.contains('ytmls-menu-hint')) {
      hint = document.createElement('small'); hint.className = 'ytmls-menu-hint'; button.after(hint);
    }
    hint.hidden = !button.disabled;
    const reason = button.disabled ? button.title || '曲と歌詞の読み込み後に使用できます' : '';
    if (hint.textContent !== reason) hint.textContent = reason;
  }
