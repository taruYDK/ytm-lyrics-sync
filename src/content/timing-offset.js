  // ---------- 曲ごとの歌詞タイミング補正 ----------
  const TRACK_TIMING_OFFSETS_STORAGE_KEY = "ytmlsTrackTimingOffsetsV174";
  const TRACK_TIMING_OFFSET_LIMIT_MS = 20000;

  let trackTimingPreview = null;
  let trackTimingRenderedVideoId = "";

  function clampTrackOffsetMs(value) {
    return Math.max(-TRACK_TIMING_OFFSET_LIMIT_MS, Math.min(TRACK_TIMING_OFFSET_LIMIT_MS, Math.round((Number(value) || 0) / 100) * 100));
  }

  function formatOffsetMs(value, withSign = true) {
    const ms = Number(value) || 0;
    const sec = ms / 1000;
    if (Math.abs(sec) < 0.0001) return '0.0秒';
    const sign = withSign && sec > 0 ? '+' : '';
    return `${sign}${sec.toFixed(1)}秒`;
  }

  function getTrackOffsetVideoId(forLyrics = false) {
    if (forLyrics && STATE.displayedVideoId) return String(STATE.displayedVideoId);
    return String(getAuthoritativeVideoId() || STATE.displayedVideoId || STATE.lastKnownVideoId || '');
  }

  function getTrackTimingOffsetMs(videoId = getTrackOffsetVideoId(true)) {
    return getTrackTimingPoints(videoId)[0].offsetMs;
  }

  function getTrackTimingPoints(videoId = getTrackOffsetVideoId(true)) {
    const id = String(videoId || '');
    if (!id) return [{ position: 0, offsetMs: 0 }];
    if (trackTimingPreview?.videoId === id) return trackTimingPreview.points.map(point => ({ ...point }));
    const entry = STATE.trackTimingOffsets && STATE.trackTimingOffsets[id];
    if (entry && typeof entry === 'object') {
      if (Array.isArray(entry.points) && entry.points.length) {
        const byPosition = new Map();
        for (const point of entry.points) {
          const rawPosition = Number(point && (point.position ?? point.progress ?? point.ratio));
          if (!Number.isFinite(rawPosition)) continue;
          const position = Math.max(0, Math.min(1, rawPosition));
          // v1.9.3までは曲末の欄を必ず作っていた。v1.9.4では最初は1欄だけにし、
          // 必要な再生位置へユーザーがポイントを足す方式なので、旧来の強制曲末点は移行しない。
          if (position >= 1) continue;
          byPosition.set(Math.round(position * 1000000), {
            position,
            offsetMs: clampTrackOffsetMs(point && point.offsetMs),
          });
        }
        const points = Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
        if (points.length) {
          if (points[0].position > 0) points.unshift({ position: 0, offsetMs: points[0].offsetMs });
          return points;
        }
      }
      const startMs = clampTrackOffsetMs(entry.offsetMs);
      return [{ position: 0, offsetMs: startMs }];
    }
    const legacyMs = clampTrackOffsetMs(entry);
    return [{ position: 0, offsetMs: legacyMs }];
  }

  function getTrackTimingOffsets(videoId = getTrackOffsetVideoId(true)) {
    const points = getTrackTimingPoints(videoId);
    return {
      startMs: points[0].offsetMs,
      endMs: points[points.length - 1].offsetMs,
    };
  }

  function effectiveTimingOffsetMs(playbackTime = null, duration = null) {
    const points = getTrackTimingPoints(getTrackOffsetVideoId(true));
    const media = getVideoElement();
    const time = playbackTime != null && Number.isFinite(Number(playbackTime))
      ? Number(playbackTime)
      : getAuthoritativePlaybackTime(media);
    const total = duration != null && Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : getAuthoritativeDuration(media);
    return interpolateTimingOffsetMs(points, time, total);
  }

  function timingOffsetSeconds(playbackTime = null, duration = null) {
    return effectiveTimingOffsetMs(playbackTime, duration) / 1000;
  }

  function playbackTimeForLyricsTime(lyricsTime, duration = null) {
    const lyricsSeconds = Number(lyricsTime);
    if (!Number.isFinite(lyricsSeconds)) return 0;
    // 表示時刻 = 再生時刻 + 位置別補正。補正量も再生位置で変わるため、
    // 歌詞クリック時は数回の逆算で正しい実再生位置を求める。
    let target = Math.max(0, lyricsSeconds - timingOffsetSeconds(lyricsSeconds, duration));
    for (let i = 0; i < 3; i++) {
      target = Math.max(0, lyricsSeconds - timingOffsetSeconds(target, duration));
    }
    return target;
  }

  function loadTrackTimingOffsets() {
    try {
      chrome.storage.local.get({ [TRACK_TIMING_OFFSETS_STORAGE_KEY]: {} }, (data) => {
        const stored = data && data[TRACK_TIMING_OFFSETS_STORAGE_KEY];
        STATE.trackTimingOffsets = stored && typeof stored === 'object' ? stored : {};
        STATE.trackTimingOffsetsLoaded = true;
        updateTrackTimingControl();
        const media = getVideoElement();
        if (media && STATE.hasSync && canTrackCurrentPlayback(media)) {
          STATE.currentIndex = -1;
          STATE.currentWordIndex = -1;
          updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
        }
      });
    } catch (_) {
      STATE.trackTimingOffsetsLoaded = true;
    }
  }

  function saveTrackTimingOffsets(videoId = getTrackOffsetVideoId(false)) {
    if (!videoId) return;
    return sendUserDataMutation({ action: "entry", key: TRACK_TIMING_OFFSETS_STORAGE_KEY,
      videoId, entry: STATE.trackTimingOffsets[videoId] || null }).catch(reportSaveError);
  }

  function saveCurrentTrackTimingPoints(points, renderPoints = true, persist = true) {
    const videoId = getTrackOffsetVideoId(false);
    if (!videoId) return;
    const normalized = Array.from(points || [])
      .map((point) => ({
        position: Math.max(0, Math.min(1, Number(point.position) || 0)),
        offsetMs: clampTrackOffsetMs(point.offsetMs),
      }))
      .sort((a, b) => a.position - b.position);
    if (!normalized.length || normalized[0].position > 0) normalized.unshift({ position: 0, offsetMs: 0 });
    if (!persist) {
      trackTimingPreview = { videoId, points: normalized };
    } else {
    trackTimingPreview = null;
    if (!STATE.trackTimingOffsets || typeof STATE.trackTimingOffsets !== 'object') STATE.trackTimingOffsets = {};
    const isDefault = normalized.length === 1 && normalized[0].offsetMs === 0;
    if (isDefault) {
      delete STATE.trackTimingOffsets[videoId];
    } else {
      STATE.trackTimingOffsets[videoId] = {
        points: normalized,
        // 古いバージョンへ戻した場合にも曲頭・曲末の値を読めるよう残す。
        offsetMs: normalized[0].offsetMs,
        endOffsetMs: normalized[normalized.length - 1].offsetMs,
        title: String(STATE.stablePlayerTitle || STATE.lastDisplayedTitle || ''),
        artist: String(STATE.stablePlayerArtist || STATE.lastDisplayedArtist || ''),
        updatedAt: Date.now(),
      };
    }
    saveTrackTimingOffsets(videoId);
    }
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;
    updateTrackTimingControl(renderPoints);
    const media = getVideoElement();
    if (media && STATE.hasSync && canTrackCurrentPlayback(media)) {
      updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
    }
    updateOffsetPreview();
  }

  function setCurrentTrackTimingPointOffset(position, value, renderPoints = true, persist = true) {
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false));
    const target = Math.max(0, Math.min(1, Number(position) || 0));
    let closestIndex = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index].position - target) < Math.abs(points[closestIndex].position - target)) closestIndex = index;
    }
    points[closestIndex] = { ...points[closestIndex], offsetMs: clampTrackOffsetMs(value) };
    saveCurrentTrackTimingPoints(points, renderPoints, persist);
  }

  function addCurrentTrackTimingPoint() {
    const videoId = getTrackOffsetVideoId(false);
    const media = getVideoElement();
    const currentTime = getAuthoritativePlaybackTime(media);
    const duration = getAuthoritativeDuration(media);
    if (!videoId || !Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return;
    const position = Math.max(0, Math.min(0.999999, currentTime / duration));
    const points = getTrackTimingPoints(videoId);
    const duplicate = points.find((point) => Math.abs(point.position - position) <= Math.max(0.0005, 0.5 / duration));
    if (!duplicate) {
      points.push({ position, offsetMs: clampTrackOffsetMs(effectiveTimingOffsetMs(currentTime, duration)) });
      saveCurrentTrackTimingPoints(points);
    }
  }

  function removeCurrentTrackTimingPoint(position) {
    const target = Number(position);
    if (!Number.isFinite(target) || target <= 0) return;
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false)).filter((point) => Math.abs(point.position - target) > 0.000001);
    saveCurrentTrackTimingPoints(points);
  }

  async function nudgeCurrentTrackTiming(deltaMs) {
    if (!STATE.enabled || !STATE.trackTimingOffsetsLoaded) return;
    const id = getAuthoritativeVideoId();
    if (!id || id !== STATE.displayedVideoId || !STATE.hasSync) return;
    try {
      // Increment the latest persisted value in the shared service-worker queue.
      // onChanged applies the committed data, including updates from other tabs.
      await sendUserDataMutation({ action: "nudgeTiming", videoId: id, deltaMs,
        title: STATE.stablePlayerTitle || STATE.lastDisplayedTitle || "",
        artist: STATE.stablePlayerArtist || STATE.lastDisplayedArtist || "" });
    } catch (error) { reportSaveError(error); }
  }

  function resetCurrentTrackTimingPoints() {
    saveCurrentTrackTimingPoints([{ position: 0, offsetMs: 0 }]);
  }

  function formatTrackPosition(position, duration) {
    if (position <= 0) return '曲の最初';
    const seconds = Number.isFinite(duration) && duration > 0 ? Math.max(0, position * duration) : 0;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')} から`;
  }

  function bindTrackTimingRange(range, group, point, videoId) {
    range.addEventListener('input', () => {
      if (getTrackOffsetVideoId(false) !== videoId) return;
      group.querySelector('.ytmls-track-offset-value').textContent = formatOffsetMs(range.value);
      setCurrentTrackTimingPointOffset(point.position, range.value, false, false);
    });
    range.addEventListener('change', () => {
      if (getTrackOffsetVideoId(false) !== videoId) return;
      setCurrentTrackTimingPointOffset(point.position, range.value, false, true);
    });
    range.addEventListener('blur', () => {
      // Also commits an input preview if a browser omits change on focus loss.
      if (trackTimingPreview?.videoId === videoId && getTrackOffsetVideoId(false) === videoId) {
        saveCurrentTrackTimingPoints(trackTimingPreview.points, false);
      }
      requestAnimationFrame(renderTrackTimingPoints);
    });
  }

  function renderTrackTimingPoints() {
    if (!trackTimingPointsEl) return;
    const videoId = getTrackOffsetVideoId(false);
    if (trackTimingPreview && trackTimingPreview.videoId !== videoId) trackTimingPreview = null;
    if (trackTimingRenderedVideoId === videoId && trackTimingPointsEl.contains(document.activeElement) &&
        document.activeElement?.classList.contains('ytmls-track-offset-range')) return;
    trackTimingRenderedVideoId = videoId;
    const points = getTrackTimingPoints(getTrackOffsetVideoId(false));
    const duration = getAuthoritativeDuration(getVideoElement());
    const signature = `${getTrackOffsetVideoId(false)}|${Math.round(Number(duration) || 0)}|${points.map((point) => `${point.position.toFixed(6)}:${point.offsetMs}`).join(',')}`;
    if (signature === trackTimingPointsSignature && trackTimingPointsEl.childElementCount === points.length) return;
    trackTimingPointsSignature = signature;
    trackTimingPointsEl.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const point of points) {
      const group = document.createElement('div');
      group.className = 'ytmls-track-offset-group';
      group.dataset.position = String(point.position);
      group.innerHTML = `
        <div class="ytmls-track-offset-row">
          <span class="ytmls-track-offset-point-label"></span>
          <span class="ytmls-track-offset-point-actions">
            <button type="button" class="ytmls-track-offset-delete" aria-label="この補正ポイントを削除" hidden>削除</button>
            <strong class="ytmls-track-offset-value">0.0秒</strong>
          </span>
        </div>
        <input class="ytmls-track-offset-range" type="range" min="-${TRACK_TIMING_OFFSET_LIMIT_MS}" max="${TRACK_TIMING_OFFSET_LIMIT_MS}" step="100" value="0" aria-label="歌詞タイミング補正" />
        <div class="ytmls-track-offset-ends"><span>遅く（−）</span><span>早く（＋）</span></div>
        <div class="ytmls-track-offset-quick">
          <button type="button" data-delta="-500">−0.5</button><button type="button" data-delta="-100">−0.1</button>
          <button type="button" data-reset-point="1">0</button>
          <button type="button" data-delta="100">＋0.1</button><button type="button" data-delta="500">＋0.5</button>
        </div>`;
      group.querySelector('.ytmls-track-offset-point-label').textContent = formatTrackPosition(point.position, duration);
      group.querySelector('.ytmls-track-offset-value').textContent = formatOffsetMs(point.offsetMs);
      const range = group.querySelector('.ytmls-track-offset-range');
      range.value = String(point.offsetMs);
      range.setAttribute('aria-label', `${formatTrackPosition(point.position, duration)}の歌詞タイミング補正`);
      bindTrackTimingRange(range, group, point, videoId);
      for (const button of group.querySelectorAll('[data-delta]')) {
        button.addEventListener('click', () => {
          const latest = getTrackTimingPoints(getTrackOffsetVideoId(false));
          const current = latest.find((candidate) => Math.abs(candidate.position - point.position) < 0.000001);
          setCurrentTrackTimingPointOffset(point.position, Number((current && current.offsetMs) || 0) + Number(button.dataset.delta || 0));
        });
      }
      group.querySelector('[data-reset-point]').addEventListener('click', () => setCurrentTrackTimingPointOffset(point.position, 0));
      const deleteButton = group.querySelector('.ytmls-track-offset-delete');
      if (point.position > 0) {
        deleteButton.hidden = false;
        deleteButton.addEventListener('click', () => removeCurrentTrackTimingPoint(point.position));
      }
      fragment.appendChild(group);
    }
    trackTimingPointsEl.appendChild(fragment);
  }

  function positionTrackTimingPopover() {
    if (!trackTimingPopoverEl || !trackTimingButtonEl || trackTimingPopoverEl.hidden) return;
    const rect = trackTimingButtonEl.getBoundingClientRect();
    const width = trackTimingPopoverEl.offsetWidth || 330;
    const height = trackTimingPopoverEl.offsetHeight || 230;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    let top = rect.top - height - 12;
    if (top < 12) top = Math.min(window.innerHeight - height - 12, rect.bottom + 12);
    trackTimingPopoverEl.style.left = `${Math.round(left)}px`;
    trackTimingPopoverEl.style.top = `${Math.round(Math.max(12, top))}px`;
  }

  function updateTrackTimingControl(renderPoints = true) {
    updateOffsetPreview();
    if (!trackTimingButtonEl) return;
    const videoId = getTrackOffsetVideoId(false);
    const points = getTrackTimingPoints(videoId);
    const enabled = Boolean(STATE.enabled && videoId && STATE.trackTimingOffsetsLoaded);
    trackTimingButtonEl.disabled = !enabled;
    if (trackTimingPopoverEl) {
      trackTimingPopoverEl.querySelectorAll('[data-nudge]').forEach(button => {
        const delta = Number(button.dataset.nudge);
        const atLimit = points.some(point => delta > 0 ? point.offsetMs >= TRACK_TIMING_OFFSET_LIMIT_MS : point.offsetMs <= -TRACK_TIMING_OFFSET_LIMIT_MS);
        button.disabled = !enabled || !STATE.hasSync || videoId !== STATE.displayedVideoId || atLimit;
        button.textContent = delta > 0 ? (atLimit ? '早く：上限です' : '歌詞を0.1秒早く') : (atLimit ? '遅く：上限です' : '歌詞を0.1秒遅く');
        button.title = atLimit ? '補正の上限（±20秒）に達しています。反対方向には調整できます。' : 'この曲全体の歌詞タイミングを調整して保存';
      });
    }
    trackTimingButtonEl.hidden = !STATE.enabled;
    trackTimingButtonEl.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    const currentMs = effectiveTimingOffsetMs();
    const customPointCount = Math.max(0, points.length - 1);
    const offsetSummary = formatOffsetMs(currentMs);
    if (trackTimingButtonLabelEl) trackTimingButtonLabelEl.textContent = `歌詞 ${offsetSummary}`;
    const health = lyricsHealthState();
    trackTimingButtonEl.title = enabled
      ? `歌詞状態: ${health.label}\n現在位置の補正: ${offsetSummary}（途中の補正ポイント ${customPointCount}個）`
      : `歌詞状態: ${health.label}\n曲を検出すると歌詞タイミングを調整できます`;

    if (trackTimingTitleEl) trackTimingTitleEl.textContent = String(STATE.stablePlayerTitle || STATE.lastDisplayedTitle || '現在の曲');
    if (trackTimingAddPointEl) {
      const media = getVideoElement();
      const time = getAuthoritativePlaybackTime(media);
      const duration = getAuthoritativeDuration(media);
      trackTimingAddPointEl.disabled = !enabled || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0;
    }
    if (renderPoints && trackTimingPopoverEl && !trackTimingPopoverEl.hidden) renderTrackTimingPoints();
    if (trackTimingTotalEl) {
      trackTimingTotalEl.textContent = `現在位置の補正: ${formatOffsetMs(currentMs)} ・ 途中のポイント ${customPointCount}個 ・ この曲だけに保存`;
    }
    if (renderPoints) positionTrackTimingPopover();
  }

  function closeTrackTimingPopover() {
    if (trackTimingPreview?.videoId === getTrackOffsetVideoId(false)) saveCurrentTrackTimingPoints(trackTimingPreview.points, false);
    if (trackTimingPopoverEl) trackTimingPopoverEl.hidden = true;
    if (trackTimingButtonEl) trackTimingButtonEl.setAttribute('aria-expanded', 'false');
  }

  function updateOffsetPreview() {
    if (!trackTimingPopoverEl || trackTimingPopoverEl.hidden) return;
    let preview = trackTimingPopoverEl.querySelector('.ytmls-offset-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'ytmls-offset-preview';
      trackTimingPopoverEl.append(preview);
    }
    const line = STATE.lines[STATE.currentIndex];
    const text = STATE.hasSync && line ? editableLineText(line) : '';
    preview.textContent = text ? `調整中の歌詞：${text}` : '補正は歌詞へ即時反映されます。同期歌詞を表示して調整してください。';
  }

  function ensurePlayerBarTimingControl() {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return;
    const host = playerBar.querySelector('.middle-controls .middle-controls-buttons') ||
      playerBar.querySelector('.middle-controls-buttons');
    if (!host) return;


    if (!resyncButtonEl || !resyncButtonEl.isConnected) {
      const button = document.createElement('button');
      button.id = 'ytmls-resync-button';
      button.type = 'button';
      button.title = '現在の曲の歌詞を再取得・再同期';
      button.setAttribute('aria-label', '歌詞を再同期');
      button.innerHTML = `
        <svg class="ytmls-resync-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"/>
        </svg>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        performLyricsResync('手動で歌詞を再同期中…', false);
      });
      host.appendChild(button);
      resyncButtonEl = button;
    } else if (resyncButtonEl.parentElement !== host) {
      host.appendChild(resyncButtonEl);
    }

    if (!trackTimingButtonEl || !trackTimingButtonEl.isConnected) {
      const button = document.createElement('button');
      button.id = 'ytmls-track-offset-button';
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `
        <span class="ytmls-track-health" data-state="idle" aria-hidden="true"></span>
        <svg class="ytmls-track-offset-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8Zm1-13h-2v6l5.2 3.1 1-1.7-4.2-2.5Z"/>
        </svg>
        <span class="ytmls-track-offset-label">歌詞 0.0秒</span>`;
      host.appendChild(button);
      trackTimingButtonEl = button;
      trackTimingButtonLabelEl = button.querySelector('.ytmls-track-offset-label');
      lyricsHealthEl = button.querySelector('.ytmls-track-health');

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        ensureTrackTimingPopover();
        const willOpen = trackTimingPopoverEl.hidden;
        trackTimingPopoverEl.hidden = !willOpen;
        button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        updateTrackTimingControl();
        if (willOpen) requestAnimationFrame(() => {
          positionTrackTimingPopover();
          trackTimingPopoverEl.querySelector(".ytmls-track-offset-close")?.focus();
        });
      });
    } else if (trackTimingButtonEl.parentElement !== host) {
      host.appendChild(trackTimingButtonEl);
    }

    ensureTrackTimingPopover();
    // tick()から300msごとに呼ばれるため、一覧DOMは変更せず現在値だけ更新する。
    updateTrackTimingControl(false);
    updatePlayerBarHealth();
  }

  function ensureTrackTimingPopover() {
    if (trackTimingPopoverEl && trackTimingPopoverEl.isConnected) return;
    const pop = document.createElement('div');
    pop.id = 'ytmls-track-offset-popover';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '曲ごとの歌詞タイミング補正');
    pop.innerHTML = `
      <div class="ytmls-track-offset-head">
        <div>
          <div class="ytmls-track-offset-heading">この曲の歌詞タイミング</div>
          <div class="ytmls-track-offset-track">現在の曲</div>
        </div>
        <button type="button" class="ytmls-track-offset-close" aria-label="閉じる">×</button>
      </div>
      <div class="ytmls-track-offset-quick ytmls-track-nudge">
        <button type="button" data-nudge="100">歌詞を0.1秒早く</button>
        <button type="button" data-nudge="-100">歌詞を0.1秒遅く</button>
      </div>
      <div class="ytmls-track-offset-help">曲全体を調整して自動保存します。途中の補正ポイント同士の差は保ちます（上限±20秒）。</div>
      <div class="ytmls-track-offset-help ytmls-track-offset-intro">最初は補正欄が1つだけです。合わせたい場所まで再生してポイントを追加すると、その位置以降の補正を変更できます。ポイントは何個でも追加できます。</div>
      <button type="button" class="ytmls-track-offset-add">＋ 現在位置に補正ポイントを追加</button>
      <div class="ytmls-track-offset-points"></div>
      <button type="button" class="ytmls-track-offset-reset-all" data-reset="1">すべての補正を削除</button>
      <div class="ytmls-track-offset-total"></div>`;
    document.body.appendChild(pop);
    trackTimingPopoverEl = pop;
    trackTimingPointsEl = pop.querySelector('.ytmls-track-offset-points');
    trackTimingAddPointEl = pop.querySelector('.ytmls-track-offset-add');
    trackTimingTitleEl = pop.querySelector('.ytmls-track-offset-track');
    trackTimingTotalEl = pop.querySelector('.ytmls-track-offset-total');

    pop.querySelectorAll('[data-nudge]').forEach(button => {
      button.addEventListener('click', () => nudgeCurrentTrackTiming(Number(button.dataset.nudge)));
    });
    pop.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      closeTrackTimingPopover();
      trackTimingButtonEl?.focus();
    });
    pop.addEventListener('click', (event) => event.stopPropagation());
    pop.querySelector('.ytmls-track-offset-close').addEventListener('click', closeTrackTimingPopover);
    trackTimingAddPointEl.addEventListener('click', addCurrentTrackTimingPoint);
    const resetButton = pop.querySelector('[data-reset]');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        const confirmed = window.confirm('この曲の補正ポイントと補正値をすべて削除します。\n本当に削除しますか？');
        if (confirmed) resetCurrentTrackTimingPoints();
      });
    }
    renderTrackTimingPoints();

    document.addEventListener('click', (event) => {
      if (!trackTimingPopoverEl || trackTimingPopoverEl.hidden) return;
      if (trackTimingPopoverEl.contains(event.target) || (trackTimingButtonEl && trackTimingButtonEl.contains(event.target))) return;
      closeTrackTimingPopover();
    });
    window.addEventListener('resize', positionTrackTimingPopover, { passive: true });
  }

  function resetLyricsScrollPosition() {
    if (!listEl) return;

    // 旧曲で開始済みの smooth scroll を確実に打ち切る。
    // CSS の scroll-behavior:smooth が有効なまま scrollTop=0 だけを行うと、
    // 高速な曲送り時に前のスクロールアニメーションが残って新曲を下へ引っ張ることがある。
    listEl.style.scrollBehavior = "auto";
    autoScrollUntil = performance.now() + 300;
    try {
      listEl.scrollTo({ top: 0, behavior: "auto" });
    } catch (_) {
      listEl.scrollTop = 0;
    }
    listEl.scrollTop = 0;
    if (lyricsRendererEl) lyricsRendererEl.scrollTop = 0;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!listEl) return;
        listEl.style.removeProperty("scroll-behavior");
      });
    });
  }

  function renderLines(options = {}) {
    if (!listEl) return;

    const resetScroll = Boolean(options.resetScroll);
    if (resetScroll) {
      resetLyricsScrollPosition();
    }

    listEl.innerHTML = "";
    STATE.currentIndex = -1;
    STATE.currentWordIndex = -1;

    if (!STATE.lines.length) {
      if (STATE.isSearching) {
        const searching = document.createElement("div");
        searching.id = "ytmls-searching";

        const spinner = document.createElement("span");
        spinner.className = "ytmls-spinner";
        spinner.setAttribute("aria-hidden", "true");

        const textWrap = document.createElement("div");
        textWrap.className = "ytmls-searching-text";

        const main = document.createElement("div");
        main.className = "ytmls-searching-main";
        main.textContent = "歌詞を探し中…";

        const sub = document.createElement("div");
        sub.className = "ytmls-searching-sub";
        sub.textContent = STATE.statusText;

        textWrap.appendChild(main);
        textWrap.appendChild(sub);
        searching.appendChild(spinner);
        searching.appendChild(textWrap);
        listEl.appendChild(searching);
      } else {
        const empty = document.createElement("div");
        empty.id = "ytmls-empty";
        const main = document.createElement("div");
        main.className = "ytmls-empty-main";
        main.textContent = "カスタム歌詞を表示できませんでした";
        const sub = document.createElement("div");
        sub.className = "ytmls-empty-sub";
        sub.textContent = STATE.statusText || "追跡できる同期歌詞が見つかりませんでした";
        empty.appendChild(main);
        empty.appendChild(sub);
        listEl.appendChild(empty);
      }
      return;
    }

    STATE.lines.forEach((line, i) => {
      const div = document.createElement("div");
      div.className = "ytmls-line";
      div.dataset.index = String(i);
      if (line.agent) div.dataset.agent = line.agent;
      if (line.dir) div.dir = line.dir;

      if (Array.isArray(line.words) && line.words.length) {
        div.classList.add("ytmls-rich-line");
        line.words.forEach((word, wi) => {
          const span = document.createElement("span");
          span.className = "ytmls-word";
          if (word.background) span.classList.add("ytmls-background-word");
          span.dataset.wordIndex = String(wi);
          span.textContent = word.text || "";
          div.appendChild(span);
        });
      } else {
        div.textContent = line.text || "♪";
      }

      if (line.time != null) {
        div.title = "クリックまたはEnter/Spaceでこの位置へ移動";
        div.tabIndex = 0;
        div.setAttribute('role', 'button');
        div.setAttribute('aria-label', (line.text || editableLineText(line) || '間奏') + '：この位置へ移動');
        div.addEventListener('keydown', event => {
          if ((event.key === 'Enter' || event.key === ' ') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat) div.click();
          }
        });
        const renderedTrackKey = STATE.lastDisplayedTrackKey;
        const renderedVideoId = STATE.displayedVideoId;
        div.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          // 古い曲の歌詞DOMが一瞬残っていても、前曲へ誤シークしない。
          const currentVideoId = getAuthoritativeVideoId();
          if (!STATE.enabled || renderedTrackKey !== STATE.lastDisplayedTrackKey) return;
          if (!renderedVideoId || !currentVideoId || renderedVideoId !== currentVideoId) {
            detectImmediateTrackTransition();
            tick();
            return;
          }

          const video = getVideoElement();
          // 曲切り替え中は旧media要素のcurrentTimeを直接触らない。
          if (!Number.isFinite(line.time) || !canTrackCurrentPlayback(video)) return;
          // 表示側は currentTime + offset で追跡するため、クリック時は逆算して実再生位置へシーク。
          const duration = getAuthoritativeDuration(video);
          let target = playbackTimeForLyricsTime(line.time, duration);
          if (Number.isFinite(duration) && duration > 0) {
            target = Math.min(target, Math.max(0, duration - 0.05));
          }
          // v1.7.2: DOMのvideoが前曲要素でも、現在のYouTubeプレイヤー本体だけをseekする。
          // bridge側でもvideoId一致を再確認するため、前曲へ誤シークできない。
          if (requestPlayerSeek(currentVideoId, target)) {
            updateHighlight(target, true);
          }
        });
      }

      listEl.appendChild(div);
    });

    const video = getVideoElement();
    if (video && STATE.hasSync && canTrackCurrentPlayback(video)) {
      updateHighlight(getAuthoritativePlaybackTime(video) || 0, true);
    }
    // Track plain lyrics first, before dictionary initialization can block rendering.
    void refreshLyricsReadings();
    if (typeof scheduleTrackingRealignment === "function") scheduleTrackingRealignment();
  }

  function refreshSearchingSubtext() {
    if (!listEl || !STATE.isSearching) return;
    const sub = listEl.querySelector(".ytmls-searching-sub");
    if (sub) sub.textContent = STATE.statusText;
  }
