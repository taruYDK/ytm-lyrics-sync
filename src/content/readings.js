  // Reading annotations are display-only. Never write ruby text into STATE.lines.
  let lyricsReadingGeneration = 0;
  let japaneseTokenizerPromise = null;
  let englishReadingsPromise = null;
  const lyricsReadingCache = new Map();

  function getJapaneseReadingTokenizer() {
    if (!japaneseTokenizerPromise) japaneseTokenizerPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('日本語辞書の読み込みがタイムアウトしました')), 30000);
      try {
        globalThis.kuromoji.builder({ dicPath: chrome.runtime.getURL('vendor/kuromoji/dict/') }).build((error, tokenizer) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve(tokenizer);
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    return japaneseTokenizerPromise;
  }

  function getEnglishReadings() {
    if (!englishReadingsPromise) englishReadingsPromise = fetch(chrome.runtime.getURL('vendor/readings/english.json'))
      .then(response => { if (!response.ok) throw new Error('英語辞書を読み込めません'); return response.json(); });
    return englishReadingsPromise;
  }

  function showLyricsReadingStatus(message) {
    if (!lyricsToolsEl) return;
    let status = lyricsToolsEl.querySelector('#ytmls-reading-status');
    if (!status) {
      status = document.createElement('span'); status.id = 'ytmls-reading-status';
      status.setAttribute('role', 'status'); lyricsToolsEl.appendChild(status);
    }
    status.textContent = message; status.hidden = !message;
  }

  function putReadingParts(node, text, offset, ranges) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    const timed = node.classList?.contains('ytmls-word');
    if (timed) node.dataset.readingParts = 'true';
    for (const part of readingPartsForFragment(text, offset, ranges)) {
      const start = cursor; cursor += part.text.length;
      const progress = readingSegmentProgressCss(start, cursor, text.length);
      if (!part.reading) {
        if (!timed) { fragment.appendChild(document.createTextNode(part.text)); continue; }
        const plain = document.createElement('span'); plain.className = 'ytmls-reading-plain'; plain.textContent = part.text;
        plain.style.setProperty('--ytmls-part-progress', progress); fragment.appendChild(plain); continue;
      }
      const ruby = document.createElement('ruby'); ruby.className = 'ytmls-ruby';
      if (timed) ruby.style.setProperty('--ytmls-part-progress', progress);
      const base = document.createElement('rb'); base.textContent = part.text;
      const reading = document.createElement('rt'); reading.textContent = part.reading;
      reading.setAttribute('aria-hidden', 'true');
      ruby.append(base, reading); fragment.appendChild(ruby);
    }
    node.replaceChildren(fragment);
  }

  async function refreshLyricsReadings() {
    const generation = ++lyricsReadingGeneration;
    if (!listEl) return;
    const list = listEl, lines = STATE.lines, rows = Array.from(list.children);
    const ja = STATE.readingJapanese === true, en = STATE.readingEnglish === true;
    list.dataset.readings = ja || en ? 'on' : 'off';
    // Restore the original text for toggles, keeping timed span elements and their classes.
    for (let index = 0; index < lines.length; index++) {
      const row = rows[index], line = lines[index]; if (!row) continue;
      if (line.words?.length) {
        const spans = row.querySelectorAll('.ytmls-word');
        spans.forEach((span, wordIndex) => { span.textContent = line.words[wordIndex]?.text || ''; delete span.dataset.readingParts; });
      } else row.textContent = line.text || '♪';
    }
    ensureReadingEditButton();
    showLyricsReadingStatus('');
    if ((!ja && !en) || !lines.length) { scheduleTrackingRealignment(); return; }
    const texts = lines.map(line => editableLineText(line) || '♪');
    const needsJapanese = ja && texts.some(text => /[\p{Script=Han}々〆ヶ]/u.test(text));
    const needsEnglish = en && texts.some(text => /[A-Za-z]/.test(text));

    showLyricsReadingStatus('読み仮名を準備中…');
    const videoId = typeof getAuthoritativeVideoId === 'function' ? String(getAuthoritativeVideoId() || '') : '';
    const [japanese, english, manual] = await Promise.allSettled([
      needsJapanese ? getJapaneseReadingTokenizer() : Promise.resolve(null),
      needsEnglish ? getEnglishReadings() : Promise.resolve(null),
      loadManualReadings(videoId),
    ]);
    const current = () => generation === lyricsReadingGeneration && listEl === list && STATE.lines === lines && !STATE.contextInvalidated && (!videoId || String(getAuthoritativeVideoId() || '') === videoId);
    if (!current()) return;
    const tokenizer = japanese.status === 'fulfilled' ? japanese.value : null;
    const dictionary = english.status === 'fulfilled' ? english.value : null;
    let skipped = false;
    for (let index = 0; index < lines.length; index++) {
      if (!current()) return;
      const line = lines[index], row = rows[index], text = texts[index];
      if (!row || row.parentElement !== list) continue;
      if (text.length > 4000) { skipped = true; continue; }
      const key = `${Boolean(tokenizer)}:${Boolean(dictionary)}:${text}`;
      let ranges = lyricsReadingCache.get(key);
      if (!ranges) {
        try {
          ranges = [
            ...(tokenizer && /[\p{Script=Han}々〆ヶ]/u.test(text) ? japaneseReadingRanges(text, tokenizer.tokenize(text)) : []),
            ...(dictionary ? englishReadingRanges(text, dictionary) : []),
          ].sort((a,b) => a.start - b.start);
          // A Japanese token may contain Latin letters: prefer its contextual reading.
          ranges = ranges.filter((range, i, all) => !all.slice(0,i).some(previous => previous.end > range.start));
        } catch (_) { skipped = true; ranges = []; }
        lyricsReadingCache.set(key, ranges);
        if (lyricsReadingCache.size > 250) lyricsReadingCache.delete(lyricsReadingCache.keys().next().value);
      }
      const automatic = ranges;
      const occurrence = texts.slice(0,index).filter(t => t === text).length;
      const savedReadings = manual.status === 'fulfilled' ? manual.value.map(e => e && e.occurrence === undefined && e.text === text && texts.filter(t => t === text).length === 1 ? {...e, occurrence:0} : e) : [];
      ranges = layoutManualLineReadings(text, mergeManualReadings(text, ranges, savedReadings, ja, en, index, occurrence), ja, en, automatic);
      if (line.words?.length) {
        let offset = 0; const spans = row.querySelectorAll('.ytmls-word');
        line.words.forEach((word, wi) => {
          const wordText = String(word.text || '');
          if (spans[wi]) putReadingParts(spans[wi], wordText, offset, ranges);
          offset += wordText.length;
        });
      } else putReadingParts(row, text, 0, ranges);
      if (index % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!current()) return;
    const failed = japanese.status === 'rejected' || english.status === 'rejected' || manual.status === 'rejected';
    showLyricsReadingStatus(failed ? '辞書または保存済みの読み仮名を読み込めませんでした。ページを再読み込みしてください。'
      : skipped ? '長い行など、一部の読み仮名を省略しました。' : '');
    scheduleTrackingRealignment();
  }

  function loadManualReadings(videoId) {
    if (!videoId) return Promise.resolve([]);
    return sendUserDataMutation({action:'migrateReadings'}).then(data => data.ytmlsManualReadingsV256?.[videoId]?.entries || []);
  }

  function canEditLyricsReadings() {
    const videoId = String(getAuthoritativeVideoId() || '');
    return Boolean(STATE.enabled && !STATE.contextInvalidated && STATE.hasLyricsResult &&
      Array.isArray(STATE.lines) && STATE.lines.some(line => editableLineText(line).trim()) &&
      videoId && (!STATE.displayedVideoId || String(STATE.displayedVideoId) === videoId));
  }

  function ensureReadingEditButton() {
    if (!lyricsToolsEl) return;
    const existing = lyricsToolsEl.querySelector('#ytmls-reading-edit');
    if (existing) {
      existing.disabled = !canEditLyricsReadings();
      existing.title = existing.disabled ? '曲と歌詞の読み込みが完了すると編集できます' : '行ごとのふりがなを編集';
      return;
    }
    const button = document.createElement('button');
    button.className = 'ytmls-tool-button';
    button.id = 'ytmls-reading-edit'; button.type = 'button'; button.textContent = 'ふりがな編集';
    button.disabled = !canEditLyricsReadings();
    button.title = button.disabled ? '曲と歌詞の読み込みが完了すると編集できます' : '行ごとのふりがなを編集';
    button.addEventListener('click', () => { const more = lyricsToolsEl.querySelector('#ytmls-more'); if (more) more.open = false; openManualReadingEditor(); });
    const menu = lyricsToolsEl.querySelector('.ytmls-more-menu');
    if (menu) menu.appendChild(button);
  }

  async function openManualReadingEditor() {
    if (!canEditLyricsReadings()) return;
    const videoId = String(getAuthoritativeVideoId() || '');
    if (!videoId || !STATE.lines.length || !lyricsToolsPaneEl) return;
    closeLyricsToolsPane();
    const pane = lyricsToolsPaneEl, lines = STATE.lines;
    lyricsToolsPaneMode = 'readings'; pane.hidden = false;
    const heading = document.createElement('div'); heading.className = 'ytmls-tools-heading'; heading.textContent = 'ふりがな編集';
    const note = document.createElement('p');
    note.textContent = '行を選んで、読みを書き直すだけ。空にして保存すると、その行のふりがなを非表示にできます。';
    const form = document.createElement('form'); form.id = 'ytmls-reading-form';
    const select = document.createElement('select'); select.setAttribute('aria-label', '編集する歌詞行');
    lines.forEach((line, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${editableLineText(line)}`; select.appendChild(option); });
    const reading = document.createElement('textarea'); reading.id = 'ytmls-reading-text'; reading.rows = 3; reading.placeholder = 'この行の読みを入力'; reading.maxLength = 1000; reading.setAttribute('aria-label', 'この行のふりがな');
    const label = document.createElement('label'); label.htmlFor = reading.id; label.textContent = 'この行のふりがな';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'この行を保存'; save.className = 'ytmls-tool-button ytmls-reading-primary';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'この行を自動読みに戻す';
    const saved = document.createElement('div');
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.textContent = '読み込み中…';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '閉じる'; close.addEventListener('click', closeLyricsToolsPane);
    reset.className = close.className = 'ytmls-tool-button';
    const actions = document.createElement('div'); actions.className = 'ytmls-reading-actions'; actions.append(save, reset, close);
    form.append(select, label, reading, saved, actions, status); pane.append(heading, note, form);
    form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeLyricsToolsPane(); } });
    const current = () => form.isConnected && STATE.lines === lines && String(getAuthoritativeVideoId() || '') === videoId;
    let entries, tokenizer = null, dictionary = null;
    save.disabled = reset.disabled = select.disabled = reading.disabled = true;
    try {
      const results = await Promise.allSettled([loadManualReadings(videoId), getJapaneseReadingTokenizer(), getEnglishReadings()]);
      if (results[0].status === 'rejected') throw results[0].reason;
      entries = results[0].value; tokenizer = results[1].status === 'fulfilled' ? results[1].value : null; dictionary = results[2].status === 'fulfilled' ? results[2].value : null;
    }
    catch (_) { if (current()) status.textContent = '読み込みに失敗しました。閉じてから再度お試しください。'; return; }
    if (!current()) return;
    // Preserve legacy corrections on other identical lines when editing only one row.
    entries = entries.flatMap(e => !e ? [] : e.lineIndex !== undefined || !lines.some(line => editableLineText(line) === e.text) ? [e] : lines.flatMap((line, lineIndex) => editableLineText(line) === e.text ? [{...e, lineIndex}] : []));
    entries = entries.map(e => e.occurrence !== undefined || !Number.isInteger(e.lineIndex) || editableLineText(lines[e.lineIndex] || {}) !== e.text ? e : {...e, occurrence: lines.slice(0,e.lineIndex).filter(line => editableLineText(line) === e.text).length});
    const textForLine = () => editableLineText(lines[Number(select.value)]);
    const occurrenceForLine = () => lines.slice(0,Number(select.value)).filter(line => editableLineText(line) === textForLine()).length;
    const belongs = e => e && e.text === textForLine() && (e.occurrence !== undefined ? e.occurrence === occurrenceForLine() : e.lineIndex === undefined || e.lineIndex === Number(select.value));
    const update = () => {
      const text = textForLine();
      let automatic = [];
      try {
        automatic = [...(tokenizer ? japaneseReadingRanges(text, tokenizer.tokenize(text)) : []), ...(dictionary ? englishReadingRanges(text, dictionary) : [])].sort((a,b) => a.start - b.start);
        automatic = automatic.filter((r,i,all) => !all.slice(0,i).some(p => p.end > r.start));
      } catch (_) {}
      const ranges = mergeManualReadings(text, automatic, entries, true, true, Number(select.value), occurrenceForLine());
      const full = entries.findLast(e => belongs(e) && e.start === 0 && e.end === text.length);
      reading.value = full ? full.reading : readingPartsForFragment(text, 0, ranges).map(p => p.reading || p.text).join('');
      saved.textContent = entries.some(belongs) ? '手動の読みを保存済み' : '自動の読みを表示中。自由に書き直せます。';
    };
    if (STATE.currentIndex >= 0 && STATE.currentIndex < lines.length) select.value = String(STATE.currentIndex);
    update(); status.textContent = ''; save.disabled = reset.disabled = select.disabled = reading.disabled = false;
    select.addEventListener('change', () => { update(); status.textContent = ''; });
    async function persist(next) {
      if (!current()) { status.textContent = '曲や歌詞が変わりました。編集画面を開き直してください。'; return; }
      if (next.length > 2000) { status.textContent = '保存できる修正件数を超えました。'; return; }
      save.disabled = reset.disabled = select.disabled = reading.disabled = true;
      try {
        const info = STATE.activeBaseInfo || STATE.activeSearchInfo || {};
        await sendUserDataMutation({action:'entry', key:'ytmlsManualReadingsV256', videoId,
          entry: next.length ? {entries:next,title:info.title || '',artist:info.artist || '',updatedAt:Date.now()} : null});
        entries = next;
        if (current()) { update(); status.textContent = '保存しました。表示設定がONの読み仮名に反映します。'; refreshLyricsReadings(); }
      } catch (_) { if (current()) status.textContent = '保存できませんでした。もう一度お試しください。'; }
      finally { save.disabled = reset.disabled = select.disabled = reading.disabled = false; }
    }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (save.disabled) return;
      const text = textForLine();
      if (!text) { status.textContent = '文字のある行を選んでください。'; return; }
      const next = entries.filter(e => !belongs(e));
      next.push({text, occurrence: occurrenceForLine(), lineIndex: Number(select.value), start: 0, end: text.length, reading: reading.value.trim()});
      persist(next);
    });
    reset.addEventListener('click', () => persist(entries.filter(e => !belongs(e))));
    reading.focus();
  }
