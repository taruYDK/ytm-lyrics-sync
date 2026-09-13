  // ---------- v1.8.2 取得状態 / 再同期 / 自動復旧 ----------
  function lyricsHealthState() {
    const now = performance.now();
    if (!STATE.enabled) return { key: "off", label: "OFF", title: "歌詞シンクロは無効です" };
    if (STATE.recoveryActiveUntil > now) {
      return { key: "recovering", label: "再同期中", title: STATE.recoveryReason || "歌詞を再同期しています" };
    }
    if (STATE.isSearching) return { key: "searching", label: "取得中", title: STATE.statusText || "同期歌詞を探しています" };
    if (STATE.hasLyricsResult && STATE.hasSync) {
      const detail = STATE.source ? sourceLabel(STATE.source, STATE.syncLevel) : "同期歌詞";
      return { key: STATE.trackingEnabled ? "synced" : "paused", label: STATE.trackingEnabled ? "同期済み" : "追跡OFF", title: detail };
    }
    if (/見つかりません|表示できません/.test(String(STATE.statusText || ""))) {
      return { key: "missing", label: "同期歌詞なし", title: STATE.statusText };
    }
    return { key: "idle", label: "待機中", title: STATE.statusText || "曲を待っています" };
  }

  function updatePlayerBarHealth() {
    const state = lyricsHealthState();
    if (lyricsHealthEl) lyricsHealthEl.dataset.state = state.key;
    if (trackTimingButtonEl) trackTimingButtonEl.setAttribute("aria-label", `歌詞状態: ${state.label}。曲ごとの歌詞タイミングを調整`);
    if (resyncButtonEl) {
      const activeVideoId = getAuthoritativeVideoId();
      resyncButtonEl.disabled = !STATE.enabled || !activeVideoId || STATE.recoveryActiveUntil > performance.now();
      resyncButtonEl.hidden = !STATE.enabled;
      resyncButtonEl.setAttribute("aria-disabled", resyncButtonEl.disabled ? "true" : "false");
    }
  }

  function scheduleRecoveryTicks() {
    setTimeout(tick, 20);
    setTimeout(tick, 180);
    setTimeout(tick, 520);
    setTimeout(tick, 1100);
  }

  function performLyricsResync(reason = "歌詞を再同期中…", automatic = false) {
    if (!STATE.enabled) return false;
    const now = performance.now();
    const activeVideoId = getAuthoritativeVideoId();
    if (!activeVideoId) return false;

    if (automatic) {
      if (STATE.autoRecoveryVideoId !== activeVideoId) {
        STATE.autoRecoveryVideoId = activeVideoId;
        STATE.autoRecoveryCount = 0;
      }
      // 同じ曲で自己復旧を連打しない。最大2回、間隔12秒。
      if (STATE.autoRecoveryCount >= 2 || now - STATE.lastAutoRecoveryAt < 12000) return false;
      STATE.autoRecoveryCount += 1;
      STATE.lastAutoRecoveryAt = now;
    } else {
      // 手動再同期は回数制限しない。
      STATE.autoRecoveryVideoId = activeVideoId;
      STATE.autoRecoveryCount = 0;
    }

    STATE.recoveryActiveUntil = now + 4500;
    STATE.recoveryReason = String(reason || "歌詞を再同期中…");

    // 再同期は「同じ壊れたキャッシュを再表示」ではなく、本当に取り直す。
    // videoIdを含む現在曲のキャッシュだけを破棄し、他曲のキャッシュは維持する。
    let cacheChanged = false;
    for (const cacheKey of Array.from(STATE.lyricsCache.keys())) {
      if (String(cacheKey).endsWith(`::${activeVideoId}`)) {
        STATE.lyricsCache.delete(cacheKey);
        cacheChanged = true;
      }
    }
    if (cacheChanged) saveLyricsCacheToStorage();

    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    STATE.playbackTransitionPending = false;
    STATE.transitionTargetVideoId = "";
    clearEndedTransitionGuard();
    clearTrackStartGuard();
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    STATE.lastTrackingPulseAt = 0;
    clearLyricsForNewTrack(reason);
    openLyricsTabForTrack(activeVideoId);
    updatePlayerBarHealth();
    scheduleRecoveryTicks();
    return true;
  }

  function runAutoRecoveryWatchdog() {
    if (!STATE.enabled) return;
    const snap = getFreshPlayerSnapshot();
    const activeVideoId = getAuthoritativeVideoId();
    if (!activeVideoId) return;
    const now = performance.now();

    if (STATE.healthVideoId !== activeVideoId) {
      STATE.healthVideoId = activeVideoId;
      STATE.healthPlaybackTime = null;
      STATE.healthPlaybackSampleAt = now;
      STATE.healthLastAdvanceAt = now;
      STATE.autoRecoveryVideoId = activeVideoId;
      STATE.autoRecoveryCount = 0;
      STATE.lastAutoRecoveryAt = 0;
      return;
    }

    if (STATE.recoveryActiveUntil > now || STATE.isSearching) return;

    // 表示している歌詞が実再生曲と違う状態は、本来の曲変更処理が取りこぼした時だけ。
    if (STATE.hasLyricsResult && STATE.displayedVideoId && STATE.displayedVideoId !== activeVideoId) {
      performLyricsResync("曲が変わったため歌詞を再同期中…", true);
      return;
    }

    if (!STATE.hasSync || !STATE.trackingEnabled || !snap || snap.playerState !== 1 || !Number.isFinite(snap.currentTime)) return;

    const t = Number(snap.currentTime);
    if (Number.isFinite(STATE.healthPlaybackTime)) {
      const elapsed = Math.max(0.001, (now - STATE.healthPlaybackSampleAt) / 1000);
      const delta = t - Number(STATE.healthPlaybackTime);
      // 再生が実際に前へ進んでいることを確認。シークは監視基準を更新するだけで復旧判定には使わない。
      if (delta >= Math.min(0.20, elapsed * 0.35) && delta < 4.0) STATE.healthLastAdvanceAt = now;
      if (Math.abs(delta) >= 4.0) STATE.healthLastAdvanceAt = now;
    } else {
      STATE.healthLastAdvanceAt = now;
    }
    STATE.healthPlaybackTime = t;
    STATE.healthPlaybackSampleAt = now;

    const playbackAdvancing = now - STATE.healthLastAdvanceAt < 1600;
    const trackingPulseAge = STATE.lastTrackingPulseAt ? now - STATE.lastTrackingPulseAt : Infinity;
    const lyricsHaveSettled = STATE.lyricsAppliedAt > 0 && now - STATE.lyricsAppliedAt > 3600;
    if (lyricsHaveSettled && playbackAdvancing && trackingPulseAge > 3600) {
      performLyricsResync("歌詞追跡が止まったため自動復旧中…", true);
      return;
    }

    // 曲頭なのに最終付近を追っている場合は、旧曲時刻/スクロール状態の残留とみなす。
    // ユーザーが手動スクロール中は絶対に発動しない。
    if (t <= 12 && Math.abs(effectiveTimingOffsetMs()) < 50 && !isManualScrollPaused() && STATE.lines.length >= 8 && STATE.currentIndex >= Math.floor(STATE.lines.length * 0.72)) {
      performLyricsResync("曲頭の歌詞位置が不自然なため自動復旧中…", true);
    }
  }
