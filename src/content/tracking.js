  function resumeTrackingAfterLyricsSeek() {
    // An explicit seek is not a stale previous-track timestamp or manual browsing.
    clearTrackStartGuard();
    manualScrollUntil = 0;
    pendingReturnToCurrent = true;
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    scheduleTrackingRealignment();
  }

  // ---------- 手動スクロール制御 ----------
  function pauseAutoScrollFromUser() {
    if (!STATE.trackingEnabled) return;
    cancelLyricsFollowScroll();
    manualScrollUntil = performance.now() + STATE.manualScrollReturnMs;
    pendingReturnToCurrent = true;
    if (typeof updateHelpfulUi === "function") updateHelpfulUi();
  }

  function isManualScrollPaused() {
    return performance.now() < manualScrollUntil;
  }

  function trackingAllowsAutoScroll() {
    return Boolean(STATE.trackingEnabled);
  }

  function clearTrackingVisuals() {
    cancelLyricsFollowScroll();
    if (!listEl) return;
    listEl.querySelectorAll(".ytmls-active, .ytmls-near, .ytmls-middle, .ytmls-far, .ytmls-upcoming").forEach((el) => el.classList.remove("ytmls-active", "ytmls-near", "ytmls-middle", "ytmls-far", "ytmls-upcoming"));
    listEl.querySelectorAll(".ytmls-word").forEach((el) => {
      el.classList.remove("ytmls-word-sung", "ytmls-word-current");
      el.style.removeProperty("--ytmls-word-progress");
    });
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
  }

  let lyricScrollFrame = 0;
  function cancelLyricsFollowScroll() {
    if (lyricScrollFrame) cancelAnimationFrame(lyricScrollFrame);
    lyricScrollFrame = 0;
  }

  function scrollCurrentLineIntoView(lineEl, behavior = "smooth") {
    if (!lineEl || !listEl || !trackingAllowsAutoScroll()) return false;
    cancelLyricsFollowScroll();
    const scroller = listEl;
    const height = scroller.clientHeight;
    if (!height) { pendingReturnToCurrent = true; return false; }
    const focusHeight = height * STATE.trackingPosition / 100;
    const listRect = scroller.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    const start = scroller.scrollTop;
    const desired = Math.max(0, start + lineRect.top - listRect.top + lineRect.height / 2 - focusHeight);
    const tail = Math.max(0, height - focusHeight - 180) + "px";
    if (scroller.style.getPropertyValue("--ytmls-trailing-space") !== tail) {
      scroller.style.setProperty("--ytmls-trailing-space", tail);
    }
    const target = Math.min(desired, Math.max(0, scroller.scrollHeight - height));
    const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A bounded animation follows promptly, independent of the browser's variable
    // native smooth-scroll duration. 'instant' bypasses CSS scroll-behavior:smooth.
    if (behavior === "auto" || reducedMotion || Math.abs(target - start) < 1) {
      autoScrollUntil = performance.now() + 150;
      scroller.scrollTo({left:0,top:target, behavior:"instant"});
      return true;
    }
    const duration = Math.min(240, Math.max(150, 120 + Math.abs(target - start) * .12));
    const startedAt = performance.now();
    autoScrollUntil = startedAt + duration + 150;
    function step(now) {
      lyricScrollFrame = 0;
      if (listEl !== scroller || !scroller.isConnected || !lineEl.isConnected ||
          !STATE.enabled || !STATE.trackingEnabled || !STATE.hasSync || isManualScrollPaused()) return;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      scroller.scrollTo({left:0,top:start + (target - start) * eased, behavior:"instant"});
      autoScrollUntil = now + 150;
      if (progress < 1) lyricScrollFrame = requestAnimationFrame(step);
    }
    lyricScrollFrame = requestAnimationFrame(step);
    return true;
  }

  let trackingLayoutFrame = 0;
  let trackingResizeObserver = null;
  let trackingBoundList = null;
  function scheduleTrackingRealignment() {
    if (trackingLayoutFrame) return;
    trackingLayoutFrame = requestAnimationFrame(() => {
      trackingLayoutFrame = 0;
      if (!STATE.enabled || !STATE.hasSync || !STATE.trackingEnabled || STATE.contextInvalidated || !listEl || !listEl.clientHeight) return;
      if (isManualScrollPaused()) { pendingReturnToCurrent = true; return; }
      if (!canTrackCurrentPlayback(getVideoElement())) return;
      const line = listEl.children[STATE.currentIndex];
      if (line && scrollCurrentLineIntoView(line, "auto")) pendingReturnToCurrent = false;
    });
  }

  function bindScrollInteraction() {
    if (!listEl || trackingBoundList === listEl) return;
    trackingBoundList = listEl;
    scrollInteractionBound = true;
    if (trackingResizeObserver) trackingResizeObserver.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      trackingResizeObserver = new ResizeObserver(scheduleTrackingRealignment);
      trackingResizeObserver.observe(listEl);
    }
    window.addEventListener("resize", scheduleTrackingRealignment, { passive: true });

    // ホイール・タッチ・キー操作は確実にユーザー操作として扱う。
    listEl.addEventListener("wheel", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("touchstart", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("touchmove", pauseAutoScrollFromUser, { passive: true });
    listEl.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        pauseAutoScrollFromUser();
      }
    });

    // スクロールバーをドラッグした場合も拾う。自動scrollIntoView中のscrollは除外。
    listEl.addEventListener("scroll", () => {
      if (performance.now() > autoScrollUntil) pauseAutoScrollFromUser();
    }, { passive: true });
  }

  // ---------- 同期ハイライト ----------
  function findCurrentLineIndex(currentTime) {
    if (!STATE.lines.length) return -1;
    let lo = 0;
    let hi = STATE.lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = STATE.lines[mid].time;
      if (t == null || t > currentTime) {
        hi = mid - 1;
      } else {
        ans = mid;
        lo = mid + 1;
      }
    }
    return ans;
  }

  const trackingWordElements = new WeakMap();
  function updateWordHighlight(lineIndex, currentTime) {
    if (!listEl || lineIndex < 0) return;
    const line = STATE.lines[lineIndex];
    if (!line || !Array.isArray(line.words) || !line.words.length) return;

    const lineEl = listEl.children[lineIndex];
    if (!lineEl) return;
    let wordsRebuilt = false;
    let wordEls = trackingWordElements.get(lineEl);
    if (!wordEls || !wordEls.length || !wordEls[0].isConnected || !wordEls[wordEls.length - 1].isConnected) {
      wordEls = lineEl.querySelectorAll(".ytmls-word");
      trackingWordElements.set(lineEl, wordEls);
      wordsRebuilt = true;
    }
    const mode = STATE.wordTrackingStyle || "smooth";

    let currentWord = -1;
    for (let wi = 0; wi < line.words.length; wi++) {
      const start = Number(line.words[wi] && line.words[wi].time);
      if (Number.isFinite(start) && start <= currentTime) currentWord = wi;
      else if (Number.isFinite(start) && start > currentTime) break;
    }

    const wordChanged = wordsRebuilt || STATE.currentWordIndex !== currentWord;

    // 単語が変わった瞬間だけ、前後の単語の確定状態を更新。
    // 毎フレーム全単語を書き換えないので、DOM負荷を大幅に下げて滑らかにする。
    if (wordChanged || mode === "step") {
      wordEls.forEach((el, wi) => {
        const sung = wi < currentWord || (mode === "step" && wi === currentWord);
        const current = wi === currentWord;
        el.classList.toggle("ytmls-word-sung", Boolean(sung));
        el.classList.toggle("ytmls-word-current", Boolean(current));
        if (wi < currentWord) el.style.setProperty("--ytmls-word-progress", "100%");
        else if (wi > currentWord) el.style.setProperty("--ytmls-word-progress", "0%");
      });
      STATE.currentWordIndex = currentWord;
    }

    if (currentWord < 0 || !wordEls[currentWord]) return;
    if (mode === "step") {
      if (wordEls[currentWord].style.getPropertyValue("--ytmls-word-progress") !== "100%") {
        wordEls[currentWord].style.setProperty("--ytmls-word-progress", "100%");
      }
      return;
    }

    const word = line.words[currentWord] || {};
    const start = Number(word.time);
    const nextStart = currentWord + 1 < line.words.length ? Number(line.words[currentWord + 1].time) : NaN;
    let end = Number(word.end);
    if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) {
      if (Number.isFinite(nextStart) && nextStart > start) end = nextStart;
      else if (Number.isFinite(line.end) && line.end > start) end = Number(line.end);
      else end = start + 0.65;
    }

    // smooth: 時刻通りに直線で進む
    // silky: 少しだけ先読み + smoothstepで端を丸めて、よりぬるぬる見せる
    const lookAhead = mode === "silky" ? 0.065 : 0;
    const raw = Math.max(0, Math.min(1, (currentTime + lookAhead - start) / Math.max(0.08, end - start)));
    const progress = mode === "silky" ? raw * raw * (3 - 2 * raw) : raw;
    const currentEl = wordEls[currentWord];
    const progressValue =       (progress * 100).toFixed(3) + "%";
    if (currentEl.style.getPropertyValue("--ytmls-word-progress") !== progressValue) {
      currentEl.style.setProperty("--ytmls-word-progress", progressValue);
    }
    const sung = progress >= 0.999;
    if (currentEl.classList.contains("ytmls-word-sung") !== sung) currentEl.classList.toggle("ytmls-word-sung", sung);
  }

  function updateHighlight(currentTime, force = false) {
    if (!STATE.hasSync || !STATE.lines.length || !listEl) return false;

    // 曲切り替え直後のvideo要素は旧曲のcurrentTimeを一瞬保持する。
    // canTrackの解除直後にも古いtimeupdateが1回飛ぶことがあるため、
    // 呼び出し元から渡された時刻ではなく「今この瞬間のmedia.currentTime」を再読込し、
    // さらに次曲開始ガードで不自然な前方ジャンプを拒否する。
    const media = getVideoElement();
    if (!canTrackCurrentPlayback(media)) return false;
    const safeCurrentTime = getGuardedPlaybackTime(media);
    if (safeCurrentTime == null) return false;

    STATE.lastTrackingPulseAt = performance.now();

    if (!STATE.trackingEnabled) {
      if (STATE.currentIndex !== -1 || STATE.currentWordIndex !== -1) clearTrackingVisuals();
      return;
    }

    const adjustedTime = Math.max(0, safeCurrentTime + timingOffsetSeconds(safeCurrentTime, getAuthoritativeDuration(media)));
    const idx = findCurrentLineIndex(adjustedTime);
    const firstHighlight = STATE.currentIndex < 0;
    const changedLine = idx !== STATE.currentIndex;
    const children = listEl.children;

    if (changedLine || force) {
      STATE.currentIndex = idx;
      STATE.currentWordIndex = -1;

      for (let i = 0; i < children.length; i++) {
        const isActive = i === idx;
        const distance = idx >= 0 ? Math.abs(i - idx) : 999;
        children[i].classList.toggle("ytmls-active", isActive);
        children[i].classList.toggle("ytmls-near", !isActive && distance <= 1);
        children[i].classList.toggle("ytmls-middle", !isActive && distance === 2);
        children[i].classList.toggle("ytmls-upcoming", idx >= 0 && i > idx);
        children[i].classList.toggle("ytmls-far", !isActive && distance > 2);
      }

      if (idx >= 0 && children[idx] && trackingAllowsAutoScroll()) {
        if (isManualScrollPaused()) {
          // ハイライト追跡は続けるが、ユーザーが読んでいる位置は奪わない。
          pendingReturnToCurrent = true;
        } else {
          pendingReturnToCurrent = !scrollCurrentLineIntoView(children[idx], firstHighlight ? "auto" : "smooth");
        }
      }
    }

    // 手動スクロールが止まって設定時間が経ったら現在位置へ戻す。
    if (trackingAllowsAutoScroll() && pendingReturnToCurrent && !isManualScrollPaused() && idx >= 0 && children[idx]) {
      pendingReturnToCurrent = !scrollCurrentLineIntoView(children[idx], "auto");
    }

    if (idx >= 0 && (STATE.syncLevel === "word" || STATE.syncLevel === "syllable")) {
      updateWordHighlight(idx, adjustedTime);
    }
  }
  function startTrackingLoop() {
    if (trackingRaf) return;

      const frame = () => {
        if (STATE.contextInvalidated) { trackingRaf = 0; return; }
        trackingRaf = requestAnimationFrame(frame);
      if (!STATE.enabled || !STATE.hasSync) return;
      const video = videoEl && videoEl.isConnected ? videoEl : getVideoElement();
      // updateHighlight performs the playback guard once for this frame.
      if (updateHighlight(getAuthoritativePlaybackTime(video) || 0) === false) return;
      if (typeof syncPracticeFullscreenTracking === "function") syncPracticeFullscreenTracking();
    };

    trackingRaf = requestAnimationFrame(frame);
  }

  function restartLyricsSearch(message = "歌詞を再検索中…") {
    if (!STATE.enabled) return;
    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    clearLyricsForNewTrack(message);
    setTimeout(tick, 20);
    setTimeout(tick, 180);
  }

  function resetTrackingForPlaybackChange(message = "歌詞を探し中…") {
    markPlaybackTransition(getVideoId());
    STATE.searchGeneration += 1;
    STATE.lastTrackKey = null;
    STATE.trackCandidateKey = "";
    STATE.trackCandidateSince = 0;
    manualScrollUntil = 0;
    pendingReturnToCurrent = false;
    clearLyricsForNewTrack(message);
    setTimeout(tick, 60);
    setTimeout(tick, 260);
  }

  function ensureVideoListener() {
    const video = getVideoElement();
    if (!video) {
      startTrackingLoop();
      return;
    }

    if (video !== videoEl) {
      if (videoEl && videoTimeUpdateHandler) {
        videoEl.removeEventListener("timeupdate", videoTimeUpdateHandler);
        if (videoForceUpdateHandler) {
          videoEl.removeEventListener("seeked", videoForceUpdateHandler);
          videoEl.removeEventListener("play", videoForceUpdateHandler);
        }
        videoEl.removeEventListener("ended", videoEndedHandler);
        videoEl.removeEventListener("loadedmetadata", videoMetadataHandler);
      }

      videoEl = video;
      videoTimeUpdateHandler = () => {
        if (!STATE.enabled || !videoEl || videoEl.ended || !canTrackCurrentPlayback(videoEl)) return;
        // timeupdate は再生中に何度も来るため force=true にしない。
        // 同じ行への smooth scroll を連続発行すると、曲切替後まで旧スクロールが残る原因になる。
        updateHighlight(getAuthoritativePlaybackTime(videoEl) || 0, false);
      };
      videoForceUpdateHandler = () => {
        if (!STATE.enabled || !videoEl || videoEl.ended || !canTrackCurrentPlayback(videoEl)) return;
        updateHighlight(getAuthoritativePlaybackTime(videoEl) || 0, true);
      };
      videoEndedHandler = () => {
        if (!STATE.enabled) return;
        beginEndedPlaybackTransition();
        STATE.searchGeneration += 1;
        STATE.lastTrackKey = null;
        STATE.trackCandidateKey = "";
        STATE.trackCandidateSince = 0;
        manualScrollUntil = 0;
        pendingReturnToCurrent = false;
        clearLyricsForNewTrack("次の曲の歌詞を待っています…");
        openLyricsTabForTrack();
        setTimeout(tick, 60);
        setTimeout(tick, 260);
      };
      videoMetadataHandler = () => {
        if (!STATE.enabled) return;
        const currentVideoId = getAuthoritativeVideoId();
        if (STATE.displayedVideoId && currentVideoId && STATE.displayedVideoId !== currentVideoId) {
          resetTrackingForPlaybackChange("歌詞を探し中…");
          return;
        }
        STATE.currentIndex = -1;
        STATE.currentWordIndex = -1;
        resetLyricsScrollPosition();
        canTrackCurrentPlayback(videoEl);
        setTimeout(tick, 80);
      };
      videoEl.addEventListener("timeupdate", videoTimeUpdateHandler);
      videoEl.addEventListener("seeked", videoForceUpdateHandler);
      videoEl.addEventListener("play", videoForceUpdateHandler);
      videoEl.addEventListener("ended", videoEndedHandler);
      videoEl.addEventListener("loadedmetadata", videoMetadataHandler);
    }

    // timeupdateだけでなくrequestAnimationFrameでも追跡し、単語/音節の細かいタイミングも追う。
    startTrackingLoop();
  }
