  let helpfulTimer = null;
  let undoNotice = null;
  function helpfulStatus() {
    if (STATE.contextInvalidated) return 'ページの再読み込みが必要です';
    if (!STATE.enabled) return '拡張機能はOFFです';
    if (STATE.isSearching) return STATE.hasLyricsResult ? '取得済み・ほかの候補を検索中' + (STATE.source ? ' · ' + STATE.source : '') : '歌詞を検索中…';
    if (STATE.hasLyricsResult) return (STATE.hasSync ? '同期歌詞を取得済み' : '同期時刻のない歌詞') + (STATE.source ? ' · ' + STATE.source : '');
    return STATE.lastTrackKey ? '同期歌詞が見つかりません' : '曲の読み込み待ち';
  }
  function updateHelpfulUi() {
    if (!panelEl || !lyricsToolsEl) return;
    let bar = panelEl.querySelector('#ytmls-helpful');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'ytmls-helpful';
      const status = document.createElement('span'); status.className = 'ytmls-fetch-status'; status.setAttribute('role','status');
      const back = document.createElement('button'); back.type = 'button'; back.className = 'ytmls-tool-button'; back.textContent = '今の歌詞に戻る';
      back.addEventListener('click', () => {
        if (!STATE.enabled || !STATE.trackingEnabled || !STATE.hasSync) return;
        resumeTrackingAfterLyricsSeek();
        updateHighlight(getAuthoritativePlaybackTime(getVideoElement()) || 0, true);
        updateHelpfulUi();
      });
      bar.append(status, back); lyricsToolsEl.prepend(bar);
    }
    const text = helpfulStatus();
    if (bar.firstChild.textContent !== text) { bar.firstChild.textContent = text; bar.firstChild.title = text; }
    bar.lastChild.hidden = !(STATE.enabled && STATE.trackingEnabled && STATE.hasSync && isManualScrollPaused());
    const menu = lyricsToolsEl.querySelector('.ytmls-more-menu');
    if (menu && lyricsToolsEl.querySelector('#ytmls-more')?.open) {
      const bottom = Math.min(window.innerHeight, panelEl.getBoundingClientRect().bottom);
      const available = Math.max(0, Math.floor(bottom - menu.getBoundingClientRect().top - 8));
      menu.style.maxHeight = Math.min(480, available) + 'px';
    }
    if (menu) for (const button of menu.querySelectorAll('button')) {
      let hint = button.nextElementSibling;
      if (!hint?.classList.contains('ytmls-menu-hint')) {
        hint = document.createElement('small'); hint.className = 'ytmls-menu-hint'; button.after(hint);
      }
      hint.hidden = !button.disabled;
      const reason = button.disabled ? button.title || '曲と歌詞の読み込み後に使用できます' : '';
      if (hint.textContent !== reason) hint.textContent = reason;
    }
    if (undoNotice && String(getAuthoritativeVideoId() || '') !== undoNotice.dataset.videoId) {
      undoNotice.remove(); undoNotice = null;
    }
    if (helpfulTimer === null) helpfulTimer = setTimeout(() => { helpfulTimer = null; updateHelpfulUi(); }, 500);
  }
  function showUserUndo(token, videoId) {
    if (!panelEl || String(getAuthoritativeVideoId() || '') !== String(videoId)) return;
    undoNotice?.remove();
    const notice = document.createElement('div'); undoNotice = notice;
    notice.className = 'ytmls-undo-notice'; notice.dataset.videoId = String(videoId);
    const label = document.createElement('span'); label.setAttribute('role','status'); label.textContent = '変更を保存しました';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ytmls-tool-button'; button.textContent = '元に戻す';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const data = await sendUserDataMutation({action:'undo',token,captureUndo:false});
        label.textContent = '変更を元に戻しました'; button.hidden = true;
        if (String(getAuthoritativeVideoId() || '') === String(videoId)) {
          closeLyricsToolsPane();
          if (data[TRACK_TIMING_OFFSETS_STORAGE_KEY]) {
            STATE.trackTimingOffsets = data[TRACK_TIMING_OFFSETS_STORAGE_KEY];
            trackTimingPreview = null; updateTrackTimingControl();
          }
          if (data[LYRICS_EDITS_STORAGE_KEY]) {
            STATE.lyricsEdits = data[LYRICS_EDITS_STORAGE_KEY];
            const candidate = activeOriginalLyricsCandidate();
            const info = STATE.activeBaseInfo || STATE.activeSearchInfo;
            if (candidate && info) applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
          }
          refreshLyricsReadings();
        }
      } catch (error) { label.textContent = error.message; button.disabled = false; }
    });
    notice.append(label, button); panelEl.insertBefore(notice, lyricsToolsPaneEl);
    setTimeout(() => { notice.remove(); if (undoNotice === notice) undoNotice = null; }, 60000);
  }
