  // ---------- メイン ----------
  function tick() {
    if (!runtimeAvailable()) return;
    ensureLyricsMount();
    ensureVideoListener();
    ensurePlayerBarTimingControl();
    maintainLyricsAutoOpen();

    if (STATE.enabled) {
      detectImmediateTrackTransition();

      // 歌詞取得前(hasSync=false)でも遷移ガードを必ず進める。
      // v1.6.3はここがRAF側のhasSync判定に阻まれ、endedVideoIdを
      // 取り違えた1回をきっかけに永久停止するデッドロックがあった。
      if (STATE.playbackTransitionPending || STATE.endedTransitionPending) {
        canTrackCurrentPlayback(getVideoElement());
      }

      checkTrackChange();
      runAutoRecoveryWatchdog();
      updatePlayerBarHealth();
      updateDiagnosticsSummary();
    } else {
      applySettings();
      updatePlayerBarHealth();
      updateDiagnosticsSummary();
    }
  }

  function init() {
    // YouTube Music reuses the same renderer for related/queue tabs.
    // Observe only tab-routing attributes, not animated lyric classes.
    let tabRefreshPending = false;
    const refreshTabVisibility = () => {
      if (tabRefreshPending) return;
      tabRefreshPending = true;
      queueMicrotask(() => {
        tabRefreshPending = false;
        if (!STATE.contextInvalidated) { ensureLyricsMount(); applySettings(); }
      });
    };
    new MutationObserver(refreshTabVisibility).observe(document.body, {
      subtree: true, attributes: true,
      attributeFilter: ["page-type", "aria-selected", "selected", "aria-hidden"],
    });
    bindAutoLyricsIdleInteractionWatch();
    loadSettings();
    loadTrackTimingOffsets();
    loadLyricsCacheFromStorage();
    loadManualSearchOverrides();
    loadLyricsEdits();
    loadPinnedLyrics();
    loadLocalLyrics();
    setInterval(tick, 300);
    tick();
    // ページを開いた時点ですでに「次のコンテンツ」なら、無操作時だけ歌詞へ移動する。
    setTimeout(() => {
      if (STATE.enabled) openLyricsTabForTrack(getAuthoritativeVideoId());
    }, 900);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 350);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(init, 350));
  }
