  function lyricCandidateIdentity(result) {
    if (result && result._candidateId) return String(result._candidateId);
    const preview = lyricsTextForLanguage(result).slice(0, 180);
    return `${result && result._providerKey || ""}::${result && result._source || ""}::${result && result.syncLevel || ""}::${preview}`;
  }

  function syncLevelShortLabel(syncLevel) {
    if (syncLevel === "syllable") return "音節";
    if (syncLevel === "word") return "単語";
    if (syncLevel === "line") return "行";
    return "同期なし";
  }

  function candidateRecommendationScore(result, info = null, expectedLanguage = "") {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return 0;

    const syncScore = result.syncLevel === "syllable"
      ? 40
      : result.syncLevel === "word"
        ? 32
        : result.syncLevel === "line"
          ? 22
          : 0;

    const expected = expectedLanguage || inferTrackLanguage(info || STATE.activeSearchInfo || STATE.activeBaseInfo);
    const fit = lyricsLanguageFit(result, info || STATE.activeSearchInfo, expected);
    const languageScore = fit >= 10 ? 25 : fit >= 0 ? 15 : 0;

    const priorityIndex = providerPriority(result._providerKey);
    const providerScore = Math.max(4, 20 - priorityIndex * 4);

    const lineCount = result.lines.length;
    const completenessScore = lineCount >= 40 ? 15 : lineCount >= 20 ? 12 : lineCount >= 8 ? 8 : 4;
    const sanitizedPenalty = Math.min(8, Number(result._translationRowsRemoved) || 0);

    return Math.max(0, Math.min(100,
      syncScore + languageScore + providerScore + completenessScore - sanitizedPenalty
    ));
  }

  function recommendationLabel(score) {
    if (score >= 85) return "最もおすすめ";
    if (score >= 70) return "おすすめ";
    if (score >= 55) return "良好";
    if (score >= 40) return "候補";
    return "要確認";
  }

  function upsertLyricsCandidate(result) {
    if (!result || !Array.isArray(result.lines) || !result.lines.length) return;
    if (!Number.isFinite(Number(result._recommendationScore))) {
      result._recommendationScore = candidateRecommendationScore(result);
    }
    const id = lyricCandidateIdentity(result);
    const entry = { id, result };
    const existingIndex = STATE.lyricCandidates.findIndex((item) => item.id === id);
    if (existingIndex >= 0) STATE.lyricCandidates[existingIndex] = entry;
    else STATE.lyricCandidates.push(entry);
    STATE.lyricCandidates.sort((a, b) =>
      (Number(b.result._recommendationScore || 0) - Number(a.result._recommendationScore || 0)) ||
      (providerPriority(a.result._providerKey) - providerPriority(b.result._providerKey)) ||
      (resultQuality(b.result) - resultQuality(a.result))
    );
    updateLyricsToolsUi();
  }

  function updateLyricsToolsUi() {
    if (typeof ensureReadingEditButton === 'function') ensureReadingEditButton();
    if (exportLyricsButtonEl) {
      exportLyricsButtonEl.disabled = !STATE.hasSync || !STATE.lines.length || STATE.contextInvalidated;
      exportLyricsButtonEl.title = exportLyricsButtonEl.disabled ? '同期歌詞が表示されると保存できます' : '表示中の歌詞を書き出す';
    }
    if (candidateButtonEl) {
      const count = STATE.lyricCandidates.length;
      // The count is a small badge; rebuilt only when it changes.
      if (typeof candidateButtonEl.replaceChildren !== "function") candidateButtonEl.textContent = `歌詞候補 ${count}`;
      else if (candidateButtonEl.dataset.count !== String(count)) {
        candidateButtonEl.dataset.count = String(count);
        const badge = document.createElement("span");
        badge.className = "ytmls-count";
        badge.textContent = String(count);
        candidateButtonEl.replaceChildren("歌詞候補 ", badge);
        candidateButtonEl.setAttribute("aria-label", `歌詞候補 ${count}件`);
      }
      candidateButtonEl.disabled = count === 0;
      candidateButtonEl.title = count ? "取得した同期歌詞から選択" : "候補を検索中です";
    }
    if (editLyricsButtonEl) {
      editLyricsButtonEl.disabled = !STATE.hasLyricsResult || !Array.isArray(STATE.lines) || !STATE.lines.length;
      editLyricsButtonEl.title = editLyricsButtonEl.disabled
        ? "同期歌詞を表示すると編集できます"
        : "歌詞の文章をタイミングを変えずに編集";
    }
    if (localLyricsButtonEl) {
      const info = STATE.activeBaseInfo || STATE.activeSearchInfo;
      const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
      const ready = Boolean(videoId && STATE.lastTrackKey);
      localLyricsButtonEl.disabled = !ready;
      localLyricsButtonEl.title = ready ? "LRCの追加・読み込み・同期歌詞作成" : "曲の読み込みが完了すると使用できます";
    }
    if (lyricsToolsEl) lyricsToolsEl.hidden = !STATE.enabled;
    updateDiagnosticsSummary();
    if (typeof updateHelpfulUi === "function") updateHelpfulUi();
  }

  function closeLyricsToolsPane() {
    authorShortcutController?.abort();
    authorShortcutController = null;
    if (!lyricsToolsPaneEl) return;
    lyricsToolsPaneEl.hidden = true;
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneMode = "";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
  }

  function selectLyricsCandidate(candidateId) {
    const candidate = STATE.lyricCandidates.find((item) => item.id === candidateId);
    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    if (!candidate || !info || !STATE.lastTrackKey) return;
    STATE.manualSelectedCandidateId = candidateId;
    STATE.activeCandidateId = candidateId;
    if (applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration)) {
      // ローカル歌詞は専用ストレージが正本。通常キャッシュへ複製すると、
      // 削除後にキャッシュから復活するため保存しない。
      if (candidate.result._providerKey !== "local") {
        const baseCacheKey = lyricsCacheKey(STATE.activeBaseInfo || info);
        const searchCacheKey = lyricsCacheKey(info);
        if (baseCacheKey) rememberLyricsInCache(baseCacheKey, candidate.result);
        if (searchCacheKey && searchCacheKey !== baseCacheKey) rememberLyricsInCache(searchCacheKey, candidate.result);
      }
    }
    closeLyricsToolsPane();
  }

  function renderCandidatePane() {
    if (candidateSaveBusy) return;
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "candidates") {
      closeLyricsToolsPane();
      return;
    }
    lyricsToolsPaneMode = "candidates";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "true");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "同期歌詞を選択";
    lyricsToolsPaneEl.appendChild(heading);

    const recommendationNote = document.createElement("div");
    recommendationNote.className = "ytmls-recommendation-note";
    recommendationNote.textContent = "おすすめ度は、同期精度・言語一致・提供元の優先順位・歌詞行数から自動計算した目安です。";
    lyricsToolsPaneEl.appendChild(recommendationNote);
    if (STATE.isCollectingCandidates) {
      const collecting = document.createElement("div");
      collecting.className = "ytmls-recommendation-note ytmls-candidate-collecting";
      collecting.setAttribute("role", "status");
      collecting.textContent = "ほかの提供元の候補を探しています…";
      lyricsToolsPaneEl.appendChild(collecting);
    }

    const pinMessage = document.createElement("div");
    pinMessage.className = "ytmls-local-message";
    pinMessage.setAttribute("role", "status");
    lyricsToolsPaneEl.appendChild(pinMessage);

    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    const pinned = getPinnedLyricsEntry(videoId);

    for (const candidate of STATE.lyricCandidates) {
      const result = candidate.result;
      const row = document.createElement("div");
      row.className = "ytmls-candidate-row";
      row.dataset.candidateId = candidate.id;
      if (pinned && pinned.candidateId === candidate.id) row.dataset.pinned = "true";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ytmls-candidate-item ytmls-candidate-select";
      if (candidate.id === STATE.activeCandidateId) button.dataset.active = "true";

      const textWrap = document.createElement("span");
      textWrap.className = "ytmls-candidate-text";

      const label = document.createElement("span");
      label.className = "ytmls-candidate-label";
      label.textContent = result._source || "歌詞";

      const meta = document.createElement("span");
      meta.className = "ytmls-candidate-meta";
      const lineCount = Array.isArray(result.lines) ? result.lines.length : 0;
      meta.textContent = `${syncLevelShortLabel(result.syncLevel)}同期 • ${lineCount}行`;

      const score = Number(result._recommendationScore || candidateRecommendationScore(result));
      const badge = document.createElement("span");
      badge.className = "ytmls-recommendation-badge";
      badge.dataset.level = score >= 85 ? "high" : score >= 70 ? "medium" : "low";
      badge.textContent = `おすすめ度 ${score} • ${recommendationLabel(score)}`;

      textWrap.append(label, meta);
      button.append(textWrap, badge);
      button.addEventListener("click", () => selectLyricsCandidate(candidate.id));

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "ytmls-candidate-pin";
      const isPinned = Boolean(pinned && pinned.candidateId === candidate.id);
      // A drawn pin (CSS) instead of the emoji; filled while this candidate is pinned.
      pinButton.textContent = isPinned ? "固定済み（解除）" : "この歌詞を固定";
      pinButton.dataset.pinned = String(isPinned);
      pinButton.setAttribute("aria-label", isPinned ? `${result._source || "この歌詞"}の固定を解除` : `${result._source || "この歌詞"}をこの曲で固定`);
      pinButton.addEventListener("click", async () => {
        if (!videoId || candidateSaveBusy) return;
        candidateSaveBusy = true;
        const controls = Array.from(lyricsToolsPaneEl.querySelectorAll("button"));
        const disabledStates = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        try {
        if (isPinned) {
          const removed = await deletePinnedLyricsEntry(videoId);
          if (!removed.ok) {
            pinMessage.textContent = removed.message;
            pinMessage.dataset.error = "true";
            pinButton.disabled = false;
            return;
          }
          deleteLyricsCacheForVideoId(videoId);
          if (String(getAuthoritativeVideoId() || "") !== videoId) return;
          closeLyricsToolsPane();
          restartLyricsSearch("固定を解除し、歌詞候補を検索中…");
          return;
        }
        const saved = await savePinnedLyricsCandidate(videoId, candidate, info);
        if (!saved.ok) {
          pinMessage.textContent = saved.message;
          pinMessage.dataset.error = "true";
          pinButton.disabled = false;
          return;
        }
        if (String(getAuthoritativeVideoId() || "") === videoId) selectLyricsCandidate(candidate.id);
        } finally {
          candidateSaveBusy = false;
          controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
        }
      });

      row.append(button, pinButton);
      lyricsToolsPaneEl.appendChild(row);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-close";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);
    lyricsToolsPaneEl.appendChild(close);
    if (typeof collectMoreCandidates === "function") void collectMoreCandidates();
  }

  // Re-render the open candidate list in place (renderCandidatePane toggles when called directly).
  function refreshCandidatePane() {
    updateLyricsToolsUi();
    candidateRefreshPending = false;
    if (!lyricsToolsPaneEl || lyricsToolsPaneEl.hidden || lyricsToolsPaneMode !== "candidates" || candidateSaveBusy) return;
    if (lyricsToolsPaneEl.dataset.morphing === "closing") return;
    if (candidatePointerDown) {
      candidateRefreshPending = true;
      return;
    }
    // Keep keyboard focus on the same control of the same candidate across the rebuild.
    const focused = document.activeElement;
    const focusedRow = focused && lyricsToolsPaneEl.contains(focused) ? focused.closest(".ytmls-candidate-row") : null;
    const focusedClass = focused && lyricsToolsPaneEl.contains(focused)
      ? ["ytmls-candidate-select", "ytmls-candidate-pin", "ytmls-tools-close"].find((name) => focused.classList.contains(name))
      : "";
    const focusedId = focusedRow ? focusedRow.dataset.candidateId : "";
    const scrollTop = lyricsToolsPaneEl.scrollTop;
    lyricsToolsPaneMode = "";
    renderCandidatePane();
    lyricsToolsPaneEl.scrollTop = scrollTop;
    if (focusedClass) {
      const rows = Array.from(lyricsToolsPaneEl.querySelectorAll(".ytmls-candidate-row"));
      const scope = focusedId ? rows.find((row) => row.dataset.candidateId === focusedId) : lyricsToolsPaneEl;
      const target = scope && scope.querySelector(`.${focusedClass}`);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderManualSearchPane() {
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "manual") {
      closeLyricsToolsPane();
      return;
    }
    lyricsToolsPaneMode = "manual";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "true");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const baseInfo = STATE.activeBaseInfo || getTrackInfo();
    const effectiveInfo = effectiveSearchInfo(baseInfo) || baseInfo || { title: "", artist: "", videoId: "" };

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "検索条件を修正";

    const form = document.createElement("form");
    form.className = "ytmls-manual-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.required = true;
    titleInput.placeholder = "曲名";
    titleInput.value = effectiveInfo.title || "";
    titleInput.setAttribute("aria-label", "曲名");

    const artistInput = document.createElement("input");
    artistInput.type = "text";
    artistInput.required = true;
    artistInput.placeholder = "アーティスト";
    artistInput.value = effectiveInfo.artist || "";
    artistInput.setAttribute("aria-label", "アーティスト");

    const actions = document.createElement("div");
    actions.className = "ytmls-manual-actions";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ytmls-tools-primary";
    submit.textContent = "この条件で検索";

    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "ytmls-tools-secondary";
    auto.textContent = "自動検出に戻す";
    auto.disabled = !effectiveInfo._manualSearch;
    auto.addEventListener("click", () => {
      const videoId = String((baseInfo && baseInfo.videoId) || getAuthoritativeVideoId() || "");
      if (!videoId) return;
      delete STATE.manualSearchOverrides[videoId];
      saveManualSearchOverrides(videoId);
      deleteLyricsCacheForVideoId(videoId);
      closeLyricsToolsPane();
      restartLyricsSearch("自動検出の曲情報で再検索中…");
    });

    actions.append(submit, auto);
    form.append(titleInput, artistInput, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const videoId = String((baseInfo && baseInfo.videoId) || getAuthoritativeVideoId() || "");
      const title = titleInput.value.trim();
      const artist = artistInput.value.trim();
      if (!videoId || !title || !artist) return;
      STATE.manualSearchOverrides[videoId] = { title, artist, ts: Date.now() };
      saveManualSearchOverrides(videoId);
      deleteLyricsCacheForVideoId(videoId);
      closeLyricsToolsPane();
      restartLyricsSearch(`手動条件で再検索中… ${title} - ${artist}`);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-close";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);

    lyricsToolsPaneEl.append(heading, form, close);
    requestAnimationFrame(() => titleInput.focus());
  }



  function activeOriginalLyricsCandidate() {
    return STATE.lyricCandidates.find((candidate) => candidate.id === STATE.activeCandidateId) || null;
  }

  function renderLyricsEditPane() {
    if (!lyricsToolsPaneEl || !STATE.hasLyricsResult || !STATE.lines.length) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "edit") {
      closeLyricsToolsPane();
      return;
    }

    const candidate = activeOriginalLyricsCandidate();
    const info = STATE.activeSearchInfo || STATE.activeBaseInfo;
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    if (!candidate || !info || !videoId || !STATE.lastTrackKey) return;

    lyricsToolsPaneMode = "edit";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "true");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "false");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const originalLines = candidate.result.lines || [];
    if (!originalLines.length) {
      closeLyricsToolsPane();
      return;
    }
    const savedEdit = getLyricsEditEntry(videoId, candidate.id);

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "歌詞を書き換え・削除";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "1行が1つのタイミングです。不要な行は空欄にして保存すると表示から削除されます。改行の数は変えないでください。";

    const form = document.createElement("form");
    form.className = "ytmls-edit-form";

    const textarea = document.createElement("textarea");
    textarea.className = "ytmls-edit-textarea";
    textarea.value = originalLines.map((line, index) => {
      if (savedEdit && Object.prototype.hasOwnProperty.call(savedEdit.replacements, index)) {
        return String(savedEdit.replacements[index] ?? "");
      }
      return editableLineText(line).trim();
    }).join("\n");
    textarea.setAttribute("aria-label", "歌詞の文章");
    textarea.spellcheck = false;

    const message = document.createElement("div");
    message.className = "ytmls-edit-message";
    message.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "ytmls-tools-primary";
    save.textContent = "変更を保存";

    const deleteSelectedLines = document.createElement("button");
    deleteSelectedLines.type = "button";
    deleteSelectedLines.className = "ytmls-tools-secondary";
    deleteSelectedLines.textContent = "選択行を削除";
    deleteSelectedLines.title = "カーソルがある行、または選択範囲の行を空欄にします";
    deleteSelectedLines.addEventListener("click", () => {
      const value = textarea.value.replace(/\r/g, "");
      const lines = value.split("\n");
      const selectionStart = Math.max(0, Number(textarea.selectionStart) || 0);
      const selectionEnd = Math.max(selectionStart, Number(textarea.selectionEnd) || selectionStart);
      const startLine = value.slice(0, selectionStart).split("\n").length - 1;
      const adjustedEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
        ? selectionEnd - 1
        : selectionEnd;
      const endLine = value.slice(0, adjustedEnd).split("\n").length - 1;
      for (let index = startLine; index <= endLine && index < lines.length; index++) lines[index] = "";
      textarea.value = lines.join("\n");
      const caret = lines.slice(0, startLine).reduce((length, line) => length + line.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      message.textContent = startLine === endLine
        ? `${startLine + 1}行目を削除対象にしました。「変更を保存」で確定します。`
        : `${startLine + 1}〜${endLine + 1}行目を削除対象にしました。「変更を保存」で確定します。`;
      delete message.dataset.error;
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ytmls-tools-secondary";
    reset.textContent = "元の歌詞に戻す";
    reset.disabled = !getLyricsEditEntry(videoId, candidate.id);
    reset.addEventListener("click", async () => {
      if (!window.confirm("この歌詞候補に保存した書き換えを削除し、元の歌詞に戻しますか？")) return;
      reset.disabled = save.disabled = true;
      try {
        await deleteLyricsEditEntry(videoId, candidate.id);
        if (videoId !== getAuthoritativeVideoId()) return;
        applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
        closeLyricsToolsPane();
      } catch (error) { message.textContent = `保存できませんでした: ${error.message}`; }
      finally { reset.disabled = save.disabled = false; }
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-secondary";
    close.textContent = "キャンセル";
    close.addEventListener("click", closeLyricsToolsPane);

    actions.append(save, deleteSelectedLines, reset, close);
    form.append(textarea, message, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const editedTexts = textarea.value.replace(/\r/g, "").split("\n").map((line) => line.trim());
      if (editedTexts.length !== originalLines.length) {
        message.textContent = `行数が変わっています（元 ${originalLines.length}行 / 編集後 ${editedTexts.length}行）。不要な行の文字だけを空にし、改行は残してください。`;
        message.dataset.error = "true";
        return;
      }
      if (!editedTexts.some(Boolean)) {
        message.textContent = "歌詞をすべて空にはできません。";
        message.dataset.error = "true";
        return;
      }

      const replacements = {};
      originalLines.forEach((line, index) => {
        if (editedTexts[index] !== editableLineText(line).trim()) replacements[index] = editedTexts[index];
      });
      if (save.disabled) return;
      reset.disabled = save.disabled = true;
      try {
        await saveLyricsEditEntry(videoId, candidate.id, replacements, info, candidate.result._source || "", originalLines.length);
        if (videoId !== getAuthoritativeVideoId()) return;
        applyLyricsResult(candidate.result, info, STATE.lastTrackKey, STATE.searchGeneration);
        closeLyricsToolsPane();
      } catch (error) { message.textContent = `保存できませんでした: ${error.message}`; message.dataset.error = "true"; }
      finally { reset.disabled = save.disabled = false; }
    });

    lyricsToolsPaneEl.append(heading, note, form);
    requestAnimationFrame(() => textarea.focus());
  }



  // Solve playback + correction(playback) = lyric time on each linear segment.
  // Unlike iterative subtraction this also handles very steep correction changes.




  function renderLrcExportPane() {
    if (!lyricsToolsPaneEl || !STATE.hasSync || !STATE.lines.length) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "export") { closeLyricsToolsPane(); return; }
    closeLyricsToolsPane();
    lyricsToolsPaneMode = "export";
    lyricsToolsPaneEl.hidden = false;
    const content = document.createElement("div");
    content.className = "ytmls-export-content";
    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "現在の歌詞をLRCで保存";
    const note = document.createElement("p");
    note.textContent = "保存済みの編集・行削除を反映し、行同期LRCとして出力します。補正を反映したLRCを再登録する場合、曲の補正を0に戻してください。";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    label.append(checkbox, " 曲ごとのタイミング補正を反映する");
    const download = document.createElement("button");
    download.className = "ytmls-tools-primary";
    download.textContent = "LRCをダウンロード";
    const message = document.createElement("div");
    message.setAttribute("role", "status");
    download.addEventListener("click", () => {
      try {
        const videoId = getAuthoritativeVideoId();
        if (!STATE.hasSync || !videoId || videoId !== STATE.displayedVideoId) throw new Error("曲の歌詞が読み込まれるまでお待ちください。");
        const info = STATE.activeSearchInfo || STATE.activeBaseInfo || {};
        const lrc = buildExportLrc(STATE.lines, info, getTrackTimingPoints(videoId), getAuthoritativeDuration(getVideoElement()), checkbox.checked);
        const blob = new Blob([lrc], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = (String(info.title || videoId).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "lyrics") + ".lrc";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        message.textContent = "LRCを書き出しました。公開・共有する場合は歌詞の権利にご注意ください。";
      } catch (error) { message.textContent = error.message; }
    });
    const close = document.createElement("button");
    close.textContent = "閉じる";
    close.className = "ytmls-tools-close";
    close.addEventListener("click", closeLyricsToolsPane);
    content.append(heading, note, label, download, message, close);
    lyricsToolsPaneEl.appendChild(content);
  }

  function roundLrcSeconds(seconds) {
    return Math.max(0, Math.round((Number(seconds) || 0) * 100)) / 100;
  }

  function plainLyricsRows(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line
        .replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, "")
        .trim())
      .filter((line) => line && !/^\[(?:ar|al|ti|by|offset|re|ve):/i.test(line));
  }

  function applyLocalLyricsNow(info, result) {
    if (!info || !result || !STATE.lastTrackKey) return false;
    // 保存の完了待ち中に別曲へ移った場合、その曲の検索世代や候補を変更しない。
    if (!info.videoId || String(getAuthoritativeVideoId() || "") !== String(info.videoId)) return false;
    // 進行中の外部検索を無効化し、完了時にローカル歌詞を上書き・消去させない。
    const generation = ++STATE.searchGeneration;
    STATE.lyricCandidates = STATE.lyricCandidates.filter((candidate) => candidate.id !== result._candidateId);
    upsertLyricsCandidate(result);
    STATE.manualSelectedCandidateId = result._candidateId;
    const applied = applyLyricsResult(result, info, STATE.lastTrackKey, generation);
    if (applied) STATE.isSearching = false;
    return applied;
  }

  function renderSyncLyricsAuthoring(info, rows) {
    if (!lyricsToolsPaneEl || !info || !info.videoId || !rows.length) return;
    const videoId = String(info.videoId);
    lyricsToolsPaneMode = "sync-author";
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "♪ 同期歌詞作成モード";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "曲を再生し、表示中の行を歌い始めた瞬間に「この行を記録して次へ」を押してください。補正前の再生時刻を記録します。";

    const progress = document.createElement("div");
    progress.className = "ytmls-sync-progress";
    const progressBar = document.createElement("progress");
    progressBar.className = "ytmls-author-progress";
    progressBar.max = rows.length;
    progressBar.setAttribute("aria-label", "同期歌詞の記録進捗");
    note.textContent += " Space：記録して次へ ／ Ctrl+Z：1行戻す（文字入力中は通常の入力操作を優先します）。";

    const currentLine = document.createElement("div");
    currentLine.className = "ytmls-sync-current-line";

    const timeline = document.createElement("div");
    timeline.className = "ytmls-sync-timeline";

    const message = document.createElement("div");
    message.className = "ytmls-local-message";
    message.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const record = document.createElement("button");
    record.type = "button";
    record.className = "ytmls-tools-primary";
    record.textContent = "この行を記録して次へ";

    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "ytmls-tools-secondary";
    undo.textContent = "1行戻す";

    const seekStart = document.createElement("button");
    seekStart.type = "button";
    seekStart.className = "ytmls-tools-secondary";
    seekStart.textContent = "曲の先頭へ";

    const restart = document.createElement("button");
    restart.type = "button";
    restart.className = "ytmls-tools-secondary";
    restart.textContent = "記録をやり直す";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "ytmls-tools-primary";
    save.textContent = "同期歌詞を保存";

    const times = new Array(rows.length).fill(null);
    let nextIndex = 0;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ytmls-tools-secondary";
    cancel.textContent = "入力画面に戻る";
    cancel.addEventListener("click", () => {
      const draftText = rows.map((text, index) =>
        Number.isFinite(times[index]) ? `${formatLrcTimestamp(times[index])}${text}` : text
      ).join("\n");
      STATE.localLyricsDrafts[videoId] = draftText;
      renderLocalLyricsPane({ draftText });
    });

    const renderAuthorState = () => {
      const completed = nextIndex >= rows.length;
      progress.textContent = `${Math.min(nextIndex, rows.length)} / ${rows.length} 行を記録済み`;
      progressBar.value = Math.min(nextIndex, rows.length);
      currentLine.dataset.index = String(Math.min(nextIndex, rows.length - 1));
      currentLine.textContent = completed ? "すべての行を記録しました。内容を保存できます。" : rows[nextIndex];
      // 行DOMは初回だけ作成し、記録・取り消し時は表示値だけ更新する。
      if (!timeline.children.length) rows.forEach((text, index) => {
        const row = document.createElement("div");
        row.className = "ytmls-sync-timeline-row";
        if (index === nextIndex && !completed) row.dataset.current = "true";
        const time = document.createElement("span");
        time.className = "ytmls-sync-recorded-time";
        time.textContent = Number.isFinite(times[index]) ? formatLrcTimestamp(times[index]) : "[--:--.--]";
        const lyric = document.createElement("span");
        lyric.textContent = text;
        row.append(time, lyric);
        timeline.appendChild(row);
      });
      Array.from(timeline.children).forEach((row, index) => {
        const active = index === nextIndex && !completed;
        if (active) row.dataset.current = "true";
        else delete row.dataset.current;
        const label = Number.isFinite(times[index]) ? formatLrcTimestamp(times[index]) : "[--:--.--]";
        if (row.firstChild.textContent !== label) row.firstChild.textContent = label;
      });
      record.disabled = completed;
      undo.disabled = nextIndex === 0;
      save.disabled = !completed;
    };

    record.addEventListener("click", () => {
      const currentVideoId = String(getAuthoritativeVideoId() || "");
      if (!currentVideoId || currentVideoId !== videoId) {
        // Keep the button usable: recording resumes once the original track plays again.
        message.textContent = "別の曲が再生されているため記録できません。元の曲に戻してから記録してください。";
        message.dataset.error = "true";
        return;
      }
      const currentTime = getAuthoritativePlaybackTime(getVideoElement());
      if (!Number.isFinite(currentTime)) {
        message.textContent = "現在の再生時刻を取得できませんでした。";
        message.dataset.error = "true";
        return;
      }
      const roundedTime = roundLrcSeconds(currentTime);
      if (nextIndex > 0 && roundedTime <= times[nextIndex - 1]) {
        message.textContent = "前の行より前、または同じ時刻です。再生位置を進めてから記録してください。";
        message.dataset.error = "true";
        return;
      }
      times[nextIndex] = roundedTime;
      nextIndex += 1;
      message.textContent = nextIndex >= rows.length ? "全行を記録しました。「同期歌詞を保存」で確定してください。" : "";
      delete message.dataset.error;
      renderAuthorState();
    });

    undo.addEventListener("click", () => {
      if (nextIndex <= 0) return;
      nextIndex -= 1;
      times[nextIndex] = null;
      message.textContent = `${nextIndex + 1}行目を記録し直せます。`;
      delete message.dataset.error;
      renderAuthorState();
    });

    seekStart.addEventListener("click", () => {
      requestPlayerSeek(videoId, 0);
      message.textContent = "曲の先頭へ移動しました。再生して記録を始めてください。";
      delete message.dataset.error;
    });

    restart.addEventListener("click", () => {
      times.fill(null);
      nextIndex = 0;
      message.textContent = "記録を最初からやり直します。";
      delete message.dataset.error;
      renderAuthorState();
    });

    save.addEventListener("click", async () => {
      if (times.some((time) => !Number.isFinite(time))) return;
      if (String(getAuthoritativeVideoId() || "") !== videoId) {
        message.textContent = "曲が切り替わっているため保存できません。";
        message.dataset.error = "true";
        return;
      }
      const lrc = rows.map((text, index) => `${formatLrcTimestamp(times[index])}${text}`).join("\n");
      save.disabled = true;
      const stored = await saveLocalLyricsEntry(videoId, lrc, info);
      if (!stored.ok) {
        message.textContent = stored.message;
        message.dataset.error = "true";
        save.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (applyLocalLyricsNow(info, stored.result) && save.isConnected) closeLyricsToolsPane();
    });

    actions.append(record, undo, seekStart, restart, save, cancel);
    lyricsToolsPaneEl.append(heading, note, progress, progressBar, currentLine, timeline, message, actions);
    // One active handler only; never intercept typing or another track's controls.
    if (authorShortcutController) authorShortcutController.abort();
    authorShortcutController = new AbortController();
    document.addEventListener("keydown", event => {
      if (!record.isConnected || lyricsToolsPaneEl.hidden || !isLyricsPanelActive() || !STATE.enabled ||
          String(getAuthoritativeVideoId() || "") !== videoId || event.isComposing ||
          event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (authorShortcutTargetsControl(event.target, record)) return;
      const space = event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      const back = event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      if (!space && !back) return;
      if ((space ? record : undo).disabled) {
        // After every line is recorded, Space must not scroll the page or toggle playback.
        if (space) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) (space ? record : undo).click();
    }, { capture: true, signal: authorShortcutController.signal });
    renderAuthorState();
  }

  function authorShortcutTargetsControl(target, record) {
    const control = target?.closest?.('button, a, [role="button"]');
    return Boolean(control && control !== record && lyricsToolsPaneEl?.contains(control));
  }

  function renderLocalLyricsPane(options = {}) {
    if (!lyricsToolsPaneEl) return;
    if (!lyricsToolsPaneEl.hidden && lyricsToolsPaneMode === "local") {
      closeLyricsToolsPane();
      return;
    }

    const info = STATE.activeBaseInfo || STATE.activeSearchInfo || getTrackInfo();
    const videoId = String((info && info.videoId) || getAuthoritativeVideoId() || "");
    if (!info || !videoId || !STATE.lastTrackKey) return;

    lyricsToolsPaneMode = "local";
    if (candidateButtonEl) candidateButtonEl.setAttribute("aria-pressed", "false");
    if (manualSearchButtonEl) manualSearchButtonEl.setAttribute("aria-pressed", "false");
    if (editLyricsButtonEl) editLyricsButtonEl.setAttribute("aria-pressed", "false");
    if (localLyricsButtonEl) localLyricsButtonEl.setAttribute("aria-pressed", "true");
    lyricsToolsPaneEl.replaceChildren();
    lyricsToolsPaneEl.hidden = false;

    const heading = document.createElement("div");
    heading.className = "ytmls-tools-heading";
    heading.textContent = "ローカル歌詞を追加";

    const note = document.createElement("div");
    note.className = "ytmls-edit-note";
    note.textContent = "[00:14.32]歌詞 の形式で貼り付けるか、.lrcファイルを読み込んでください。この曲だけに保存され、常に最優先で表示されます。";

    const textarea = document.createElement("textarea");
    textarea.className = "ytmls-local-lrc-textarea";
    textarea.setAttribute("aria-label", "ローカルLRC歌詞");
    textarea.placeholder = "[00:14.32]最初の歌詞\n[00:18.75]次の歌詞";
    textarea.spellcheck = false;
    const suppliedDraft = options && typeof options.draftText === "string" ? options.draftText : null;
    const hasRememberedDraft = Object.prototype.hasOwnProperty.call(STATE.localLyricsDrafts, videoId);
    textarea.value = suppliedDraft != null
      ? suppliedDraft
      : hasRememberedDraft
        ? STATE.localLyricsDrafts[videoId]
        : (getLocalLyricsEntry(videoId) || {}).rawLrc || "";
    textarea.addEventListener("input", () => {
      STATE.localLyricsDrafts[videoId] = textarea.value;
    });

    const fileRow = document.createElement("label");
    fileRow.className = "ytmls-local-file-row";
    const fileLabel = document.createElement("span");
    fileLabel.textContent = ".lrcファイルを読み込む";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".lrc,text/plain";
    fileInput.className = "ytmls-local-lrc-file";
    fileRow.append(fileLabel, fileInput);

    const message = document.createElement("div");
    message.className = "ytmls-local-message";
    message.setAttribute("role", "status");

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > LOCAL_LYRICS_MAX_CHARS * 4) {
        message.textContent = "LRCファイルが大きすぎます。";
        message.dataset.error = "true";
        return;
      }
      try {
        textarea.value = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
        STATE.localLyricsDrafts[videoId] = textarea.value;
        message.textContent = `${file.name} を読み込みました。`;
        delete message.dataset.error;
      } catch (_) {
        message.textContent = "LRCファイルを読み込めませんでした。";
        message.dataset.error = "true";
      }
    });

    const actions = document.createElement("div");
    actions.className = "ytmls-edit-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "ytmls-tools-primary";
    save.textContent = "ローカル歌詞を保存";
    save.addEventListener("click", async () => {
      save.disabled = true;
      const stored = await saveLocalLyricsEntry(videoId, textarea.value, info);
      if (!stored.ok) {
        message.textContent = stored.message;
        message.dataset.error = "true";
        save.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (applyLocalLyricsNow(info, stored.result) && save.isConnected) closeLyricsToolsPane();
    });

    const createSync = document.createElement("button");
    createSync.type = "button";
    createSync.className = "ytmls-tools-secondary ytmls-sync-create-button";
    createSync.textContent = "♪ 同期歌詞作成モード";
    createSync.addEventListener("click", () => {
      const rows = plainLyricsRows(textarea.value);
      if (!rows.length) {
        message.textContent = "同期を付ける歌詞を1行ずつ入力してください。";
        message.dataset.error = "true";
        return;
      }
      STATE.localLyricsDrafts[videoId] = textarea.value;
      renderSyncLyricsAuthoring(info, rows);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ytmls-tools-secondary";
    remove.textContent = "ローカル歌詞を削除";
    remove.disabled = !getLocalLyricsEntry(videoId);
    remove.addEventListener("click", async () => {
      if (!window.confirm("この曲に保存したローカル歌詞を本当に削除しますか？")) return;
      remove.disabled = true;
      const removed = await deleteLocalLyricsEntry(videoId);
      if (!removed.ok) {
        message.textContent = removed.message;
        message.dataset.error = "true";
        remove.disabled = false;
        return;
      }
      delete STATE.localLyricsDrafts[videoId];
      if (String(getAuthoritativeVideoId() || "") !== videoId || !remove.isConnected) return;
      closeLyricsToolsPane();
      restartLyricsSearch("ローカル歌詞を削除し、通常の歌詞を検索中…");
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ytmls-tools-secondary";
    close.textContent = "閉じる";
    close.addEventListener("click", closeLyricsToolsPane);

    actions.append(save, createSync, remove, close);
    lyricsToolsPaneEl.append(heading, note, textarea, fileRow, message, actions);
    requestAnimationFrame(() => textarea.focus());
  }

  function diagnosticSnapshot() {
    let version = "unknown";
    try {
      version = chrome.runtime.getManifest().version || version;
    } catch (_) {}
    const videoId = String(getAuthoritativeVideoId() || STATE.displayedVideoId || "");
    const player = getFreshPlayerSnapshot();
    return {
      version,
      health: lyricsHealthState(),
      videoId: videoId || "none",
      provider: STATE.source || "none",
      sync: STATE.syncLevel || "none",
      candidates: STATE.lyricCandidates.length,
      offsetPoints: videoId ? getTrackTimingPoints(videoId).length : 0,
      playerSource: String((player && player.timeSource) || (getVideoElement() ? "media" : "none")),
      pinned: Boolean(getPinnedLyricsEntry(videoId)),
      local: Boolean(getLocalLyricsEntry(videoId)),
    };
  }

  function diagnosticText(snapshot = diagnosticSnapshot()) {
    return [
      `Extension: ${snapshot.version}`,
      `State: ${snapshot.health.label}`,
      `Video ID: ${snapshot.videoId}`,
      `Provider: ${snapshot.provider}`,
      `Sync: ${snapshot.sync}`,
      `Candidates: ${snapshot.candidates}`,
      `Offset points: ${snapshot.offsetPoints}`,
      `Player source: ${snapshot.playerSource}`,
      `Pinned lyrics: ${snapshot.pinned ? "yes" : "no"}`,
      `Local lyrics: ${snapshot.local ? "yes" : "no"}`,
      `Glass lens: ${typeof glassLensDiagnostics === "function" ? glassLensDiagnostics() : "n/a"}`,
      `Guide layout: ${guideLayoutDiagnostics()}`,
      `Player page layout: ${playerPageLayoutDiagnostics()}`,
      `Mac toolbar: ${macToolbarDiagnostics()}`,
      `Mac pages: ${macPagesDiagnostics()}`,
    ].join("\n");
  }

  // Mac-style screen: how many of YouTube Music's parts that the Apple-style rules target are on the
  // page (counts and tag names only), to see which ones the real page uses.
  function macPagesDiagnostics() {
    try {
      const count = (selector) => document.querySelectorAll(selector).length;
      const queue = document.querySelector("ytmusic-player-queue-item");
      const menu = document.querySelector("ytmusic-menu-popup-renderer");
      return [
        `queueItems=${count("ytmusic-player-queue-item")}`,
        queue ? `queueItem=[${["song-title", "byline", "duration"].map(c => `${c}:${queue.querySelector("." + c) ? "y" : "n"}`).join(",")} selected:${count("ytmusic-player-queue-item[selected]")} state:${queue.getAttribute("play-button-state") || "-"}]` : "queueItem=none",
        `shelfHeaders=${count("ytmusic-carousel-shelf-basic-header-renderer")}`,
        `twoRow=${count("ytmusic-two-row-item-renderer")}`,
        `listRows=${count("ytmusic-responsive-list-item-renderer")}`,
        `chips=${count("ytmusic-chip-cloud-chip-renderer")}`,
        `playButtons=${count("ytmusic-item-thumbnail-overlay-renderer ytmusic-play-button-renderer")}`,
        `headers=${["ytmusic-responsive-header-renderer", "ytmusic-detail-header-renderer", "ytmusic-immersive-header-renderer", "ytmusic-visual-header-renderer"].map(n => `${n.replace(/^ytmusic-|-header-renderer$/g, "")}:${count(n)}`).join(",")}`,
        `pageButtons=[filled:${count(":is(ytmusic-browse-response, ytmusic-search-page) .yt-spec-button-shape-next--filled")} tonal:${count(":is(ytmusic-browse-response, ytmusic-search-page) .yt-spec-button-shape-next--tonal")} outline:${count(":is(ytmusic-browse-response, ytmusic-search-page) .yt-spec-button-shape-next--outline")}]`,
        `cardShelf=${count("ytmusic-card-shelf-renderer")}`,
        `autoplay=${(() => { const t = [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-toggle-button, ytmusic-player-page [role="switch"]')]; return t.length ? `${t.length}:${t.map(x => (x.hasAttribute('checked') || x.getAttribute('aria-pressed') === 'true') ? 'on' : 'off').join('/')}` : 'none'; })()}`,
        `albumPills=${document.querySelectorAll('.ytmls-am-album-actions').length}`,
        `page=${(() => { const pg = document.querySelector('ytmusic-app-layout > ytmusic-player-page'); if (!pg) return 'none'; const cs = getComputedStyle(pg), r = pg.getBoundingClientRect(); return `[${cs.position} left:${cs.left} ml:${cs.marginLeft} pl:${cs.paddingLeft} x:${Math.round(r.left)} w:${Math.round(r.width)} shift:${pg.style.getPropertyValue('--ytmls-am-page-shift') || '-'}]`; })()}`,
        `menu=${menu ? `${menu.parentElement?.localName || "-"} items:${[...new Set([...menu.querySelectorAll("[class], *")].map(el => el.localName).filter(n => /^ytmusic-.*item/.test(n)))].join("/")}` : "closed"}`,
      ].join(" ");
    } catch (_) {
      return "error";
    }
  }

  // Mac-style screen (apple-shell.js): for each playback button, whether YouTube Music's own button
  // was found, and what is actually under our button (something on top would take the clicks).
  function macToolbarDiagnostics() {
    try {
      if (!document.getElementById("ytmls-am")) return "off";
      const bar = document.querySelector("ytmusic-player-bar");
      const describe = (el) => el ? `${el.localName}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""}` : "none";
      return [["play", "#play-pause-button"], ["prev", ".previous-button"], ["next", ".next-button"], ["shuffle", ".shuffle"], ["repeat", ".repeat"]].map(([name, selector]) => {
        const ours = document.querySelector(`#ytmls-am .ytmls-am-${name}`);
        const native = bar?.querySelector(selector);
        let hit = "hidden";
        const rect = ours?.getBoundingClientRect();
        if (rect?.width) {
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          hit = top && (top === ours || ours.contains(top)) ? "ok" : describe(top);
        }
        return `${name}: native=${native ? describe(native) : "missing"} hit=${hit}`;
      }).join("; ") + "; shuffle: " + (() => {
        // How YouTube Music's shuffle button shows on / off (attribute names and values; no titles of songs).
        const el = bar?.querySelector(".shuffle");
        if (!el) return "missing";
        const attrs = el2 => el2 ? [...el2.attributes].filter(a => a.name !== "style").map(a => `${a.name}=${String(a.value).slice(0, 40)}`).join(" ") : "-";
        return `[${attrs(el)}] inner[${attrs(el.querySelector("button"))}]`;
      })() + "; gap: " + (() => {
        // What sits in the space between the sidebar and the toolbar (a strip was reported there).
        const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ytmls-am-side")) || 0;
        return [-10, -4, 2, 8].map(dx => `${dx}=${describe(document.elementFromPoint(Math.max(0, side + dx), 30))}`).join(",");
      })();
    } catch (_) {
      return "error";
    }
  }

  // How the Now Playing page is built (to find the comments): tab labels, the page's columns, and
  // anything whose tag or id says "comment". Element names, ids, classes and sizes only.
  function playerPageLayoutDiagnostics() {
    try {
      const page = document.querySelector("ytmusic-player-page");
      if (!page) return "no player page";
      const box = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`; };
      const describe = (el) => `${el.localName}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].slice(0, 3).join(".") : ""}(${box(el)})`;
      const tabs = [...page.querySelectorAll("tp-yt-paper-tab")].map(tab => `${tab.textContent.replace(/\s+/g, " ").trim().slice(0, 12)}${tab.classList.contains("ytmls-tab-hidden") ? "[hidden]" : ""}`);
      const columns = [...(page.querySelector("#content, .content") || page).children].map(describe);
      const comments = [];
      const walker = document.createTreeWalker(page, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.nextNode(); el && comments.length < 6; el = walker.nextNode()) {
        if (el.closest("#ytmls-panel")) continue;
        if (/comment/i.test(el.localName) || /comment/i.test(el.id || "")) {
          const chain = []; for (let p = el.parentElement; p && p !== page && chain.length < 4; p = p.parentElement) chain.push(describe(p));
          comments.push(`${describe(el)} < ${chain.join(" < ")}`);
        }
      }
      const av = page.querySelector("ytmusic-av-toggle");
      const avText = av ? `mode=${av.getAttribute("playback-mode") || "-"} disabled=${av.hasAttribute("toggle-disabled")} buttons=${[...av.querySelectorAll(".song-button, .video-button")].map(b => `${describe(b)}[pressed=${b.getAttribute("aria-pressed") || "-"} disabled=${b.disabled || b.hasAttribute("disabled")} aria-disabled=${b.getAttribute("aria-disabled") || "-"}] in ${describe(b.parentElement)}`).join(" , ")}` : "none";
      return `tabs=[${tabs.join(" | ")}] columns=[${columns.join(", ")}] comments=[${comments.join(" ; ") || "none"}] av=[${avText}]`;
    } catch (_) {
      return "error";
    }
  }

  // How YouTube Music builds its side menu, to style it without guessing: element names, ids, slots,
  // classes and sizes only (never titles such as playlist names).
  function guideLayoutDiagnostics() {
    try {
      const describe = (el) => {
        if (!el?.localName) return "?";
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
        const attrs = ["slot", "active", "mini", "collapsed", "opened", "persistent", "hidden"].filter((a) => el.hasAttribute?.(a)).map((a) => `[${a}]`).join("");
        return `${el.localName}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${el.getAttribute?.("slot") ? `{slot=${el.getAttribute("slot")}}` : ""}${attrs}`;
      };
      const chain = (el) => {
        const parts = [];
        for (let n = el; n && n.localName !== "ytmusic-app-layout" && parts.length < 9; n = n.parentElement) {
          const r = n.getBoundingClientRect?.();
          parts.push(`${describe(n)}(${r ? Math.round(r.width) + "x" + Math.round(r.height) : ""})`);
        }
        return parts.reverse().join(" > ");
      };
      const inner = (el, depth = 0) => {
        if (!el || depth > 2) return "";
        const kids = [...el.children].slice(0, 4).map((c) => describe(c) + (c.children.length && depth < 2 ? "{" + inner(c, depth + 1) + "}" : ""));
        return kids.join(",");
      };
      const layout = document.querySelector("ytmusic-app-layout");
      const layoutAttrs = layout ? [...layout.attributes].map((a) => a.name).filter((n) => /guide|drawer|mini/.test(n)).join(",") : "none";
      const entries = [...document.querySelectorAll("ytmusic-guide-entry-renderer, ytmusic-mini-guide-entry-renderer")].filter((e) => e.getBoundingClientRect().width > 0);
      const first = entries[0];
      return [
        `layout[${layoutAttrs}]`,
        `renderers=${[...document.querySelectorAll("ytmusic-guide-renderer, ytmusic-mini-guide-renderer")].map((r) => describe(r) + (r.getBoundingClientRect().width ? "" : "(hidden)")).join("|") || "none"}`,
        `visibleEntries=${entries.length}`,
        first ? `entry: ${chain(first)}` : "entry: none",
        first ? `entryInside: ${inner(first)}` : "",
        ...["guide-renderer", "mini-guide-renderer"].map((id) => {
          const r = document.getElementById(id);
          if (!r) return `${id}: none`;
          const box = r.getBoundingClientRect();
          return `${id}(${Math.round(box.width)}x${Math.round(box.height)}): ${inner(r)}`;
        }),
        `sections: ${[...document.querySelectorAll("#guide-renderer ytmusic-guide-section-renderer")].map((sec) => `[${[...sec.children].map(describe).join(",")}]`).join(" ") || "none"}`,
      ].filter(Boolean).join(" ; ");
    } catch (e) {
      return "error " + (e?.message || e);
    }
  }

  function updateDiagnosticsSummary() {
    if (!diagnosticsSummaryEl) return;
    const snapshot = diagnosticSnapshot();
    const sync = syncLevelShortLabel(snapshot.sync);
    const summary = `状態：${snapshot.health.label}  •  曲ID：${snapshot.videoId}  •  歌詞：${snapshot.provider}  •  同期：${sync}  •  候補：${snapshot.candidates}件`;
    if (diagnosticsSummaryEl.textContent !== summary) diagnosticsSummaryEl.textContent = summary;
    // Construct the detailed tooltip only when requested.
  }

  async function copyDiagnostics() {
    const text = diagnosticText();
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (_) {}
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { copied = document.execCommand("copy"); } catch (_) {}
      textarea.remove();
    }
    if (!diagnosticsCopyButtonEl) return;
    const original = "診断情報をコピー";
    diagnosticsCopyButtonEl.textContent = copied ? "コピーしました" : "コピーできませんでした";
    window.setTimeout(() => {
      if (diagnosticsCopyButtonEl) diagnosticsCopyButtonEl.textContent = original;
    }, 1800);
  }

  function closeMoreMenu(more) {
    if (!more?.open) return;
    const menu=more.querySelector('.ytmls-more-menu');
    const summary=more.querySelector(':scope > summary');
    if (!menu || typeof glassMorph !== 'function' || !glassMorphAllowed(menu)) { more.open=false; return; }
    if (more.dataset.closing==='true') return;
    more.dataset.closing='true';menu.style.pointerEvents='none';
    // Shrink back into the "その他" button.
    const settle=()=>{delete more.dataset.closing;menu.style.removeProperty('pointer-events');};
    glassMorph(menu, summary, {closing: true, onDone: () => {more.open=false;settle();}, onCancel: settle});
  }

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement("div");
    panelEl.id = "ytmls-panel";
    panelEl.dataset.sync = "none";

    statusEl = document.createElement("div");
    statusEl.id = "ytmls-status";
    // Announce status changes only; a live panel would read every lyric line on each render.
    statusEl.setAttribute("aria-live", "polite");
    statusEl.textContent = STATE.statusText;
    panelEl.appendChild(statusEl);

    lyricsToolsEl = document.createElement("div");
    lyricsToolsEl.id = "ytmls-tools";

    candidateButtonEl = document.createElement("button");
    candidateButtonEl.type = "button";
    candidateButtonEl.className = "ytmls-tool-button";
    candidateButtonEl.setAttribute("aria-pressed", "false");
    candidateButtonEl.addEventListener("click", renderCandidatePane);

    manualSearchButtonEl = document.createElement("button");
    manualSearchButtonEl.type = "button";
    manualSearchButtonEl.className = "ytmls-tool-button";
    manualSearchButtonEl.textContent = "手動検索";
    manualSearchButtonEl.dataset.icon = "search";
    manualSearchButtonEl.setAttribute("aria-pressed", "false");
    manualSearchButtonEl.addEventListener("click", renderManualSearchPane);

    editLyricsButtonEl = document.createElement("button");
    editLyricsButtonEl.type = "button";
    editLyricsButtonEl.className = "ytmls-tool-button";
    editLyricsButtonEl.textContent = "歌詞編集";
    editLyricsButtonEl.dataset.icon = "pencil";
    editLyricsButtonEl.setAttribute("aria-pressed", "false");
    editLyricsButtonEl.addEventListener("click", renderLyricsEditPane);

    localLyricsButtonEl = document.createElement("button");
    localLyricsButtonEl.type = "button";
    localLyricsButtonEl.className = "ytmls-tool-button ytmls-local-lyrics-button";
    localLyricsButtonEl.textContent = "歌詞を追加";
    localLyricsButtonEl.dataset.icon = "plus";
    localLyricsButtonEl.setAttribute("aria-pressed", "false");
    localLyricsButtonEl.addEventListener("click", renderLocalLyricsPane);

    exportLyricsButtonEl = document.createElement("button");
    exportLyricsButtonEl.type = "button";
    exportLyricsButtonEl.className = "ytmls-tool-button";
    exportLyricsButtonEl.textContent = "LRC保存";
    exportLyricsButtonEl.dataset.icon = "download";
    exportLyricsButtonEl.addEventListener("click", renderLrcExportPane);
    const more = document.createElement("details");
    more.id = "ytmls-more";
    const moreToggle = document.createElement("summary");
    moreToggle.className = "ytmls-tool-button";
    moreToggle.textContent = "その他";
    // The chevron is its own element (the summary's ::after holds the glass behind the label).
    const moreChevron = document.createElement("span");
    moreChevron.className = "ytmls-more-chevron";
    moreChevron.setAttribute("aria-hidden", "true");
    moreToggle.append(moreChevron);
    moreToggle.addEventListener('click',event=>{
      if(!more.open)return;
      event.preventDefault();
      // Pressed again while it shrinks back: grow out of the button again instead of ignoring the press.
      if(more.dataset.closing==='true'&&typeof stopGlassMorph==='function'){stopGlassMorph(menu);fitMoreMenu(more,menu);glassMorph(menu,moreToggle);return;}
      closeMoreMenu(more);
    });
    const menu = document.createElement("div");
    menu.className = "ytmls-more-menu";
    function menuGroup(title, id) {
      const group = document.createElement('div');
      group.id = id;
      group.className = 'ytmls-menu-group';
      group.setAttribute('role', 'group');
      const label = document.createElement('div');
      label.className = 'ytmls-menu-label';
      label.id = id + '-label';
      label.textContent = title;
      group.setAttribute('aria-labelledby', label.id);
      group.append(label);
      return group;
    }
    const displayGroup = menuGroup('表示', 'ytmls-practice-controls');
    const playbackGroup = menuGroup('再生・同期', 'ytmls-playback-menu');
    const lyricsGroup = menuGroup('歌詞の検索・編集', 'ytmls-lyrics-menu');
    lyricsGroup.append(manualSearchButtonEl, localLyricsButtonEl, editLyricsButtonEl);
    const storageGroup = menuGroup('保存・診断', 'ytmls-storage-menu');
    const shareLyricsButtonEl = document.createElement("button");
    shareLyricsButtonEl.type = "button";
    shareLyricsButtonEl.className = "ytmls-tool-button";
    shareLyricsButtonEl.id = "ytmls-share-lyrics";
    shareLyricsButtonEl.textContent = "歌詞を共有";
    shareLyricsButtonEl.title = "選んだ行を、ジャケットの色のカード画像にしてコピー・保存";
    shareLyricsButtonEl.addEventListener("click", () => { closeMoreMenu(more); openShareCard(); });
    storageGroup.append(shareLyricsButtonEl, exportLyricsButtonEl);
    // The menu draws the glass and its rim; the body inside scrolls (so the rim never scrolls away).
    const menuBody = document.createElement("div");
    menuBody.className = "ytmls-more-body";
    menuBody.append(displayGroup, playbackGroup, lyricsGroup, storageGroup);
    menu.append(menuBody);
    more.append(moreToggle, menu);
    lyricsToolsEl.append(candidateButtonEl, more);
    for (const button of [candidateButtonEl, manualSearchButtonEl, editLyricsButtonEl, localLyricsButtonEl, exportLyricsButtonEl]) {
      button.addEventListener("click", () => { closeMoreMenu(more); });
    }
    document.addEventListener("click", event => {
      if (more.open && !more.contains(event.target)) closeMoreMenu(more);
    });
    more.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeMoreMenu(more); moreToggle.focus(); event.stopPropagation(); }
    });
    panelEl.appendChild(lyricsToolsEl);

    diagnosticsEl = document.createElement("div");
    diagnosticsEl.id = "ytmls-diagnostics";
    diagnosticsSummaryEl = document.createElement("span");
    diagnosticsSummaryEl.className = "ytmls-diagnostics-summary";
    diagnosticsSummaryEl.addEventListener("mouseenter", () => { diagnosticsSummaryEl.title = diagnosticText(); });
    diagnosticsSummaryEl.addEventListener("focus", () => { diagnosticsSummaryEl.title = diagnosticText(); });
    diagnosticsCopyButtonEl = document.createElement("button");
    diagnosticsCopyButtonEl.type = "button";
    diagnosticsCopyButtonEl.className = "ytmls-diagnostics-button";
    diagnosticsCopyButtonEl.textContent = "診断情報をコピー";
    diagnosticsCopyButtonEl.addEventListener("click", copyDiagnostics);
    diagnosticsEl.append(diagnosticsSummaryEl, diagnosticsCopyButtonEl);
    const diagnosticDetails = document.createElement("details");
    diagnosticDetails.className = "ytmls-diagnostic-details";
    const diagnosticToggle = document.createElement("summary");
    diagnosticToggle.textContent = "診断情報";
    diagnosticToggle.dataset.icon = "info";
    diagnosticDetails.append(diagnosticToggle, diagnosticsEl);
    storageGroup.append(diagnosticDetails);
    more.addEventListener("toggle", () => {
      if (more.open) fitMoreMenu(more, menu);
      else diagnosticDetails.open = false;
    });
    // Grow out of the button as soon as it opens (a mutation runs before the next paint).
    if (typeof MutationObserver === "function") new MutationObserver(() => {
      if (!more.open || more.dataset.closing === "true") return;
      fitMoreMenu(more, menu);
      if (typeof glassMorph === "function") glassMorph(menu, moreToggle);
    }).observe(more, { attributes: true, attributeFilter: ["open"] });

    lyricsToolsPaneEl = document.createElement("div");
    lyricsToolsPaneEl.id = "ytmls-tools-pane";
    lyricsToolsPaneEl.hidden = true;
    // Tool panes grow out of the button that opened them (a menu item counts as "その他").
    let toolPaneAnchor = null;
    lyricsToolsEl.addEventListener("click", event => {
      const button = event.target.closest?.("button, summary");
      if (button) toolPaneAnchor = button.closest(".ytmls-more-menu") ? moreToggle : button;
    }, true);
    // Closing by hand ("閉じる", the same button again, Escape) shrinks back into that button.
    // Switching to another pane or closing for other reasons stays instant.
    const closeToolPaneByHand = () => {
      if (lyricsToolsPaneEl.hidden || lyricsToolsPaneEl.dataset.morphing === "closing" || candidateSaveBusy) return false;
      const anchor = toolPaneAnchor?.isConnected && toolPaneAnchor.getClientRects().length ? toolPaneAnchor : candidateButtonEl;
      if (typeof glassMorph !== "function" || !glassMorphAllowed(lyricsToolsPaneEl)) return false;
      const mode = lyricsToolsPaneMode;
      // Lift the pane out of the layout where it is, so the lyrics move back at once and the
      // glass shrinks over them (instead of leaving a gap that closes with a jump at the end).
      const pane = lyricsToolsPaneEl;
      const lifted = { position: "absolute", top: `${pane.offsetTop}px`, left: `${pane.offsetLeft}px`, width: `${pane.offsetWidth}px`, height: `${pane.offsetHeight}px`, margin: "0", zIndex: "31" };
      if (pane.offsetParent) Object.assign(pane.style, lifted);
      pane.style.pointerEvents = "none";
      const unlift = () => { for (const key of ["position", "top", "left", "width", "height", "margin", "z-index", "pointer-events"]) pane.style.removeProperty(key); };
      glassMorph(pane, anchor, { closing: true, onCancel: unlift, onDone: () => {
        unlift();
        // Another pane opened meanwhile: keep it.
        if (lyricsToolsPaneMode === mode) closeLyricsToolsPane();
      } });
      return true;
    };
    lyricsToolsPaneEl.addEventListener("click", event => {
      if (!event.target.closest?.(".ytmls-tools-close")) return;
      if (closeToolPaneByHand()) { event.stopImmediatePropagation(); event.preventDefault(); }
    }, true);
    lyricsToolsEl.addEventListener("click", event => {
      const button = event.target.closest?.("#ytmls-tools > .ytmls-tool-button[aria-pressed='true']");
      if (button && closeToolPaneByHand()) { event.stopImmediatePropagation(); event.preventDefault(); }
    }, true);
    // Escape closes the pane, but not while a Japanese conversion is open or a field is in use
    // (Escape there belongs to the IME or the field, and closing would drop unsaved text).
    lyricsToolsPaneEl.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (lyricsToolsPaneEl.hidden || candidateSaveBusy) return;
      event.stopPropagation();
      if (!closeToolPaneByHand() && lyricsToolsPaneEl.dataset.morphing !== "closing") closeLyricsToolsPane();
      (toolPaneAnchor?.isConnected ? toolPaneAnchor : candidateButtonEl)?.focus();
    });
    // Another pane replacing the contents during a hand close takes over: stop the shrink.
    if (typeof MutationObserver === "function") new MutationObserver(() => {
      if (lyricsToolsPaneEl.dataset.morphing === "closing" && typeof stopGlassMorph === "function") stopGlassMorph(lyricsToolsPaneEl);
    }).observe(lyricsToolsPaneEl, { childList: true });
    if (typeof MutationObserver === "function") new MutationObserver(() => {
      if (lyricsToolsPaneEl.hidden) { lyricsToolsPaneEl.wasShown = false; return; }
      if (lyricsToolsPaneEl.wasShown) return;
      lyricsToolsPaneEl.wasShown = true;
      if (typeof glassMorph === "function") glassMorph(lyricsToolsPaneEl, toolPaneAnchor?.isConnected ? toolPaneAnchor : candidateButtonEl);
    }).observe(lyricsToolsPaneEl, { attributes: true, attributeFilter: ["hidden"] });
    // Rebuilding the candidate list under a press would swallow the click: wait until it ends.
    lyricsToolsPaneEl.addEventListener("pointerdown", () => { candidatePointerDown = true; });
    const endCandidatePress = () => {
      if (!candidatePointerDown) return;
      candidatePointerDown = false;
      if (candidateRefreshPending) setTimeout(refreshCandidatePane, 0);
    };
    window.addEventListener("pointerup", endCandidatePress, true);
    window.addEventListener("pointercancel", endCandidatePress, true);
    panelEl.appendChild(lyricsToolsPaneEl);

    listEl = document.createElement("div");
    listEl.id = "ytmls-list";
    panelEl.appendChild(listEl);
    bindScrollInteraction();

    applySettings();
    updateLyricsToolsUi();
    renderLines();
  }

  function ensureLyricsMount() {
    maintainExternalLyricsTab();
    const renderer = externalLyricsOpen ? externalLyricsHost : findLyricsRenderer();
    if (!renderer) {
      if (lyricsRendererEl) lyricsRendererEl.classList.remove("ytmls-replaced");
      lyricsRendererEl = null;
      if (panelEl) { panelEl.style.display = "none"; panelEl.remove(); }
      lyricsWasVisible = false;
      return;
    }

    createPanel();

    if (lyricsRendererEl !== renderer) {
      if (lyricsRendererEl) lyricsRendererEl.classList.remove("ytmls-replaced");
      lyricsRendererEl = renderer;
    }

    if (panelEl && panelEl.parentElement !== renderer) {
      renderer.prepend(panelEl);
      renderLines();
    }

    // 歌詞タブを開き直した時、古いスクロール位置（特に最下部）をそのまま使わない。
    const isVisible = isLyricsPanelActive() && renderer.getClientRects().length > 0 && getComputedStyle(renderer).display !== "none";
    if (isVisible && !lyricsWasVisible) {
      // Give the next animation frame time to restart before the watchdog checks.
      trackingDisplayResumedAt = performance.now();
      // v1.7.1: 「歌詞」タブを開いた瞬間にも実再生曲と表示歌詞を照合する。
      // 前曲DOM/歌詞が裏で残っていても、そのまま見せず次曲検索へ切り替える。
      const activeVideoId = getAuthoritativeVideoId();
      if (STATE.hasLyricsResult && STATE.displayedVideoId && activeVideoId && STATE.displayedVideoId !== activeVideoId) {
        STATE.searchGeneration += 1;
        STATE.lastTrackKey = null;
        STATE.trackCandidateKey = "";
        STATE.trackCandidateSince = 0;
        setTimeout(() => {
          if (!STATE.enabled) return;
          clearLyricsForNewTrack("次の曲の歌詞を読み込み中…");
          tick();
        }, 0);
      } else if (STATE.hasLyricsResult) {
        requestAnimationFrame(() => {
          const media = getVideoElement();
          if (STATE.hasSync && media && canTrackCurrentPlayback(media)) {
            STATE.currentIndex = -1;
            STATE.currentWordIndex = -1;
            updateHighlight(getAuthoritativePlaybackTime(media) || 0, true);
          } else if (listEl) {
            listEl.scrollTop = 0;
          }
        });
      }
    }
    lyricsWasVisible = isVisible;

    applySettings();
  }

  function isLyricsPanelActive() {
    if (externalLyricsOpen && STATE.enabled && lyricsRendererEl === externalLyricsHost && panelEl?.parentElement === externalLyricsHost) return true;
    if (!lyricsRendererEl || !lyricsRendererEl.isConnected ||
        lyricsRendererEl.getAttribute("page-type") !== "MUSIC_PAGE_TYPE_TRACK_LYRICS" ||
        panelEl?.parentElement !== lyricsRendererEl) return false;
    const selected = getSelectedPlayerTab();
    if (!selected) return true; // Older layouts expose only the renderer's page-type.
    return isLyricsLabelText(tabLabel(selected));
  }

  let bridgeEnabledSetting;
  function applySettings() {
    if (bridgeEnabledSetting !== STATE.enabled) {
      bridgeEnabledSetting = STATE.enabled;
      sendToPlayerBridge({type:'tracking-config',enabled:STATE.enabled===true});
    }
    if (listEl) listEl.style.fontSize = STATE.fontSize + "px";
    if (panelEl) {
      panelEl.dataset.sync = STATE.syncLevel || "none";
      panelEl.dataset.trackingMode = STATE.trackingEnabled ? "auto" : "off";
      panelEl.dataset.wordTracking = STATE.wordTrackingStyle || "smooth";
      panelEl.dataset.wordGlow = STATE.wordGlow === false ? "off" : "on";
      panelEl.dataset.focusFade = STATE.focusFade ? "on" : "off";
    }

    // v1.8.0: 拡張が有効な間はYouTube Music標準歌詞へフォールバックしない。
    // 外部同期歌詞が見つからない場合も、標準歌詞を露出させず拡張パネルに状態を表示する。
    const shouldReplaceNative = STATE.enabled && isLyricsPanelActive();

    if (panelEl) panelEl.style.display = shouldReplaceNative ? "flex" : "none";
    if (!shouldReplaceNative) {
      const more = panelEl?.querySelector("#ytmls-more");
      if (more) more.open = false;
    }
    if (lyricsRendererEl) {
      lyricsRendererEl.classList.toggle("ytmls-replaced", shouldReplaceNative);
    }
    if (document.documentElement) {
      document.documentElement.setAttribute("data-ytmls-enabled", STATE.enabled ? "true" : "false");
    }
    if (resyncButtonEl) resyncButtonEl.hidden = !STATE.enabled;
    if (trackTimingButtonEl) trackTimingButtonEl.hidden = !STATE.enabled;
    updateLyricsToolsUi();
    if (!STATE.enabled) {
      closeExternalLyrics();
      if (externalLyricsButton) externalLyricsButton.hidden = true;
      closeTrackTimingPopover();
      closeLyricsToolsPane();
    }
  }

  function setStatus(text) {
    if (STATE.contextInvalidated) text = CONTEXT_RELOAD_MESSAGE;
    // すでに歌詞を表示できている間は、裏検索の進捗表示で見出しを上書きしない。
    // 歌詞候補を開いたときの裏の候補集めでも同じ。
    if (STATE.hasLyricsResult && (STATE.isSearching || STATE.isCollectingCandidates) &&
        /(探し中|検索中|確認中|準備中|探索中)/.test(String(text || ""))) {
      return;
    }
    STATE.statusText = text;
    if (statusEl) statusEl.textContent = text;
    updatePlayerBarHealth();
    updateDiagnosticsSummary();
  }

  function sourceLabel(source, syncLevel) {
    if (syncLevel === "syllable") return `${source} • 音節追跡中`;
    if (syncLevel === "word") return `${source} • 単語追跡中`;
    if (syncLevel === "line") return `${source} • 行追跡中`;
    return `${source} • 同期なし`;
  }
