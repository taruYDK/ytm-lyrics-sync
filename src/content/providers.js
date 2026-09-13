  // ---------- Better Lyrics 2.3.3 現行バックエンド ----------
  const BETTER_LYRICS_V2_BASE = "https://lyrics.api.dacubeking.com/";
  const BETTER_LYRICS_JWT_KEY = "ytmlsBetterLyricsJwt";

  function parseJwtExpiry(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return 0;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
      const data = JSON.parse(atob(padded));
      return Number(data.exp || 0);
    } catch (_) {
      return 0;
    }
  }

  function storageLocalGet(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get([key], (data) => resolve(data ? data[key] : null)); }
      catch (_) { resolve(null); }
    });
  }

  function storageLocalSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); }
      catch (_) { resolve(); }
    });
  }

  function getTurnstileToken(trackKey) {
    return new Promise((resolve) => {
      if (trackKey !== STATE.lastTrackKey) return resolve(null);
      const iframe = document.createElement("iframe");
      iframe.src = BETTER_LYRICS_V2_BASE + "challenge";
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:.01;pointer-events:none;z-index:-1";
      iframe.setAttribute("aria-hidden", "true");

      let done = false;
      const finish = (token) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        try { iframe.remove(); } catch (_) {}
        resolve(token || null);
      };
      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.origin !== "https://lyrics.api.dacubeking.com") return;
        if (event.data && event.data.type === "turnstile-token") finish(String(event.data.token || ""));
        else if (event.data && (event.data.type === "turnstile-error" || event.data.type === "turnstile-timeout")) finish(null);
      };
      const timer = setTimeout(() => finish(null), 12000);
      window.addEventListener("message", onMessage);
      document.body.appendChild(iframe);
    });
  }

  async function getBetterLyricsJwt(trackKey, forceNew = false) {
    if (!forceNew) {
      const saved = await storageLocalGet(BETTER_LYRICS_JWT_KEY);
      if (typeof saved === "string" && saved) {
        const exp = parseJwtExpiry(saved);
        if (exp > Date.now() / 1000 + 60) return saved;
      }
    }

    setStatus("Better Lyrics本体と同じ認証を準備中…");
    refreshSearchingSubtext();
    const challengeToken = await getTurnstileToken(trackKey);
    if (!challengeToken || trackKey !== STATE.lastTrackKey) return null;

    const res = await fetchJson(BETTER_LYRICS_V2_BASE + "verify-turnstile", {
      method: "POST",
      body: JSON.stringify({ token: challengeToken }),
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      timeoutMs: 15000,
    });
    const jwt = res.ok && res.data && typeof res.data.jwt === "string" ? res.data.jwt : null;
    if (jwt) await storageLocalSet({ [BETTER_LYRICS_JWT_KEY]: jwt });
    return jwt;
  }

  function angleTimeToSeconds(tag) {
    const m = String(tag || "").match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function parseInlineTimedLrc(lrcText) {
    const base = parseLRC(lrcText);
    if (!base.length) return { lines: [], syncLevel: "none" };
    const rawRows = String(lrcText || "").split(/\r?\n/).filter((x) => /\[\d{1,2}:\d{2}/.test(x));
    let bi = 0;
    for (const raw of rawRows) {
      if (!base[bi]) break;
      const lineTags = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
      const expandedCount = Math.max(1, lineTags.length);
      const content = raw.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+\s*/, "");
      const tagRe = /<(\d{1,2}:\d{2}(?:\.\d+)?)>/g;
      const matches = [...content.matchAll(tagRe)];
      if (matches.length >= 2) {
        const words = [];
        for (let i = 0; i < matches.length - 1; i++) {
          const start = angleTimeToSeconds(matches[i][1]);
          const end = angleTimeToSeconds(matches[i + 1][1]);
          const text = content.slice(matches[i].index + matches[i][0].length, matches[i + 1].index).trim();
          if (text && start != null && end != null && end >= start) {
            words.push({ text, time: start, end, background: false });
          }
        }
        if (words.length) {
          const firstLineTime = Number(base[bi].time);
          for (let copyIndex = 0; copyIndex < expandedCount; copyIndex++) {
            const line = base[bi + copyIndex];
            if (!line) continue;
            const shift = Number.isFinite(firstLineTime) && Number.isFinite(line.time)
              ? line.time - firstLineTime
              : 0;
            line.words = words.map((word) => ({
              ...word,
              time: word.time + shift,
              end: word.end + shift,
            }));
            line.time = line.words[0].time;
            line.end = line.words[line.words.length - 1].end;
            line.text = line.words.map((x) => x.text).join("");
          }
        }
      }
      bi += expandedCount;
    }
    const hasWords = base.some((line) => line.words && line.words.length);
    return { lines: base, syncLevel: hasWords ? "word" : "line" };
  }

  function parseQrc(qrcText) {
    const lines = [];
    for (const raw of String(qrcText || "").split(/\r?\n/)) {
      const head = raw.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!head) continue;
      const lineStart = Number(head[1]) / 1000;
      const lineEnd = (Number(head[1]) + Number(head[2])) / 1000;
      const body = head[3] || "";
      const words = [];
      const wordRe = /([^()]+?)\((\d+),(\d+)\)/g;
      let m;
      while ((m = wordRe.exec(body))) {
        const text = m[1];
        const start = Number(m[2]) / 1000;
        const end = (Number(m[2]) + Number(m[3])) / 1000;
        if (text) words.push({ text, time: start, end, background: false });
      }
      const text = words.length ? words.map((x) => x.text).join("") : body.replace(/\(\d+,\d+\)/g, "").trim();
      if (text) lines.push({ time: lineStart, end: lineEnd, text, words });
    }
    return { lines, syncLevel: lines.some((x) => x.words.length) ? "word" : (lines.length ? "line" : "none") };
  }


  function parseBetterLyricsSse(raw, duration, info) {
    const candidates = [];
    const add = (result, priority) => {
      if (result && result.lines && result.lines.length) candidates.push({ ...result, priority });
    };

    const blocks = String(raw || "").split(/\n\n|\r\n\r\n/);
    for (const block of blocks) {
      let eventName = "";
      let dataText = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataText += line.slice(5).trim();
      }
      if (eventName !== "provider" || !dataText || dataText === "[DONE]") continue;
      let data;
      try { data = JSON.parse(dataText); } catch (_) { continue; }
      const provider = String(data && data.provider || "").toLowerCase();
      const results = data && data.results;
      if (!provider || !results) continue;

      if (provider === "golyrics" && results.lyrics) {
        let ttml = results.lyrics;
        try { const parsed = JSON.parse(ttml); if (parsed && parsed.ttml) ttml = parsed.ttml; } catch (_) {}
        const p = parseTTML(ttml);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics" }, p.syncLevel === "syllable" ? 100 : 80);
      }

      if (provider === "binimum" && results.lyrics) {
        const p = String(results.lyrics).includes("<tt") ? parseTTML(results.lyrics) : parseInlineTimedLrc(results.lyrics);
        const timing = String(results.timingType || "").toLowerCase();
        const level = timing === "syllable" ? "syllable" : p.syncLevel;
        add({ lines: p.lines, syncLevel: level, _source: "BiniLyrics (Better Lyrics経由)" }, level === "syllable" ? 95 : 75);
      }

      if (provider === "musixmatch") {
        if (typeof results.wordByWord === "string" && results.wordByWord.trim()) {
          const p = parseInlineTimedLrc(results.wordByWord);
          add({ lines: p.lines, syncLevel: p.syncLevel === "word" ? "word" : "line", _source: "Musixmatch (Better Lyrics経由)" }, p.syncLevel === "word" ? 90 : 58);
        }
        if (typeof results.synced === "string" && results.synced.trim()) {
          add({ lines: parseLRC(results.synced), syncLevel: "line", _source: "Musixmatch (Better Lyrics経由)" }, 60);
        }
      }

      if (provider === "lrclib") {
        if (typeof results.synced === "string" && results.synced.trim()) {
          add({ lines: parseLRC(results.synced), syncLevel: "line", _source: "LRCLIB (Better Lyrics経由)" }, 70);
        }
      }

      if (provider === "qq" && results.lyrics) {
        let decoded = results.lyrics;
        try { const x = JSON.parse(decoded); if (x && x.lyrics) decoded = x.lyrics; } catch (_) {}
        const p = parseQrc(decoded);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics Portato" }, p.syncLevel === "word" ? 88 : 62);
      }

      if (provider === "kugou" && results.lyrics) {
        let decoded = results.lyrics;
        try { const x = JSON.parse(decoded); if (x && x.lyrics) decoded = x.lyrics; } catch (_) {}
        const p = parseInlineTimedLrc(decoded);
        add({ lines: p.lines, syncLevel: p.syncLevel, _source: "Better Lyrics Legato" }, p.syncLevel === "word" ? 84 : 65);
      }

    }

    candidates.sort((a, b) => {
      const langA = lyricsLanguageFit(a, info);
      const langB = lyricsLanguageFit(b, info);
      if (langA !== langB) return langB - langA;
      return (b.priority || 0) - (a.priority || 0);
    });
    return candidates.find((candidate) => lyricsLanguageFit(candidate, info) >= 0) || null;
  }

  async function fetchFromBetterLyricsV2(info, duration, trackKey) {
    if (!info.videoId) return null;
    for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus("Better Lyrics 2.3.3と同じ同期ソースを検索中…");
      refreshSearchingSubtext();
      const jwt = await getBetterLyricsJwt(trackKey, authAttempt > 0);
      if (!jwt || trackKey !== STATE.lastTrackKey) return null;

      const body = new URLSearchParams();
      body.set("videoId", info.videoId);
      if (info.title) body.set("song", cleanTitle(info.title));
      if (info.artist) body.set("artist", cleanArtist(info.artist));
      if (duration) body.set("duration", String(Math.round(duration)));
      if (info.album) body.set("album", info.album);
      body.set("alwaysFetchMetadata", "true");
      body.set("token", jwt);

      const res = await fetchText(BETTER_LYRICS_V2_BASE + "v2/lyrics", {
        method: "POST",
        body: body.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        credentials: "include",
        timeoutMs: 22000,
      });
      if (res.status === 403 && authAttempt === 0) continue;
      if (!res.ok || typeof res.data !== "string") return null;
      return parseBetterLyricsSse(res.data, duration, info);
    }
    return null;
  }

  // ---------- Better Lyrics統合API: 同期JSONフォールバック ----------
  async function fetchFromBetterLyricsJson(info, duration, trackKey) {
    if (trackKey !== STATE.lastTrackKey) return null;
    setStatus("Better Lyricsの同期歌詞を追加確認中…");
    refreshSearchingSubtext();

    const p = new URLSearchParams();
    if (info.videoId) p.set("videoId", info.videoId);
    if (info.title) p.set("song", cleanTitle(info.title));
    if (info.artist) p.set("artist", cleanArtist(info.artist));
    if (info.album) p.set("album", info.album);
    if (duration) p.set("duration", String(Math.round(duration)));
    p.set("alwaysFetchMetadata", "true");

    const savedJwt = await storageLocalGet(BETTER_LYRICS_JWT_KEY);
    if (typeof savedJwt === "string" && savedJwt) p.set("token", savedJwt);

    const res = await fetchJson(BETTER_LYRICS_V2_BASE + "lyrics?" + p.toString(), {
      credentials: "include",
      timeoutMs: 18000,
    });
    if (!res.ok || !res.data || typeof res.data !== "object") return null;

    const data = res.data;
    const rich = data.musixmatchWordByWordLyrics;
    if (typeof rich === "string" && rich.trim()) {
      const parsed = parseInlineTimedLrc(rich);
      if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: "Musixmatch (Better Lyrics経由)" };
    }

    const syncedCandidates = [
      [data.goLyricsApiTtml, "Better Lyrics"],
      [data.musixmatchSyncedLyrics, "Musixmatch (Better Lyrics経由)"],
      [data.lrclibSyncedLyrics, "LRCLIB (Better Lyrics経由)"],
      [data.lyrics, "Better Lyrics"],
    ];
    for (const [raw, source] of syncedCandidates) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (raw.includes("<tt")) {
        let ttml = raw;
        try { const x = JSON.parse(raw); if (x && x.ttml) ttml = x.ttml; } catch (_) {}
        const parsed = parseTTML(ttml);
        if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: source };
      }
      if (/\[\d{1,2}:\d{2}/.test(raw)) {
        const parsed = parseInlineTimedLrc(raw);
        if (parsed.lines.length) return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: source };
      }
    }

    return null;
  }

  // ---------- Better Lyrics公式: 音節同期TTML ----------
  async function fetchFromBetterLyrics(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    const attempts = [];
    for (const title of titles) {
      for (const artist of artists) attempts.push({ title, artist });
    }

    for (let i = 0; i < attempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = attempts[i];
      setStatus(`Better Lyricsで音節同期を探し中… ${i + 1}/${attempts.length}`);
      refreshSearchingSubtext();

      const p = new URLSearchParams({ s: x.title, a: x.artist });
      if (info.album) p.set("al", info.album);
      if (duration) p.set("d", String(Math.round(duration)));

      const res = await fetchJson(`https://lyrics-api.boidu.dev/getLyrics?${p.toString()}`);
      if (res.ok && res.data && typeof res.data.ttml === "string") {
        if (hasSearchResultMetadata(res.data) && !searchResultMatchesTrack(res.data, x.title, x.artist, duration)) {
          await sleep(120);
          continue;
        }
        const parsed = parseTTML(res.data.ttml);
        if (parsed.lines.length) {
          return {
            lines: parsed.lines,
            syncLevel: parsed.syncLevel,
            _source: "Better Lyrics",
          };
        }
      }
      await sleep(120);
    }
    return null;
  }

  // ---------- Unison: Better Lyricsコミュニティ ----------
  function parseUnisonData(data) {
    if (!data) return null;
    const entry = data.success && data.data ? data.data : data.data || data;
    if (!entry || typeof entry.lyrics !== "string" || !entry.lyrics.trim()) return null;

    const format = String(entry.format || "").toLowerCase();
    const syncType = String(entry.syncType || entry.sync_type || "").toLowerCase();

    if (format === "ttml" || entry.lyrics.includes("<tt")) {
      const parsed = parseTTML(entry.lyrics);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: syncType === "richsync" ? "syllable" : parsed.syncLevel,
          _source: "Unison",
        };
      }
    }

    if (format === "lrc" || syncType === "linesync" || /\[\d{1,2}:\d{2}/.test(entry.lyrics)) {
      const parsed = parseRichLrcWithWordRows(entry.lyrics);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: syncType === "richsync" ? "word" : parsed.syncLevel,
          _source: "Unison",
        };
      }
    }

    return null;
  }

  async function fetchFromUnison(info, duration, trackKey) {
    const urls = [];
    if (info.videoId) {
      urls.push(`https://unison.boidu.dev/lyrics?v=${encodeURIComponent(info.videoId)}`);
    }

    const p = new URLSearchParams({ song: cleanTitle(info.title), artist: cleanArtist(info.artist) });
    if (info.album) p.set("album", info.album);
    if (duration) p.set("duration", String(Math.round(duration)));
    urls.push(`https://unison.boidu.dev/lyrics?${p.toString()}`);

    for (let i = 0; i < urls.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`Unisonでも同期歌詞を探し中… ${i + 1}/${urls.length}`);
      refreshSearchingSubtext();
      const res = await fetchJson(urls[i]);
      if (res.ok) {
        const parsed = parseUnisonData(res.data);
        if (parsed) return parsed;
      }
      await sleep(100);
    }
    return null;
  }

  // ---------- BiniLyrics: TTML/ワード同期 ----------
  async function fetchFromBiniLyrics(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    const attempts = [];
    for (const title of titles) {
      for (const artist of artists) attempts.push({ title, artist });
    }

    for (let i = 0; i < attempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = attempts[i];
      setStatus(`BiniLyricsでワード同期を探し中… ${i + 1}/${attempts.length}`);
      refreshSearchingSubtext();

      const p = new URLSearchParams({ track: x.title, artist: x.artist });
      if (info.album) p.set("album", info.album);
      if (duration) p.set("duration", String(Math.round(duration)));
      const res = await fetchJson(`https://lyrics-api.binimum.org/?${p.toString()}`);
      if (!res.ok || !res.data || !Array.isArray(res.data.results) || !res.data.results.length) {
        await sleep(100);
        continue;
      }

      const best = res.data.results[0];
      if (scoreResult(best, x.title, x.artist, duration) < 120) {
        await sleep(100);
        continue;
      }

      const lyricsUrl = best.lyricsUrl || best.lyrics_url || "";
      if (!/^https:\/\/lyrics-storage\.binimum\.org\//i.test(lyricsUrl)) {
        await sleep(100);
        continue;
      }

      const textRes = await fetchText(lyricsUrl);
      if (!textRes.ok || typeof textRes.data !== "string" || !textRes.data.trim()) {
        await sleep(100);
        continue;
      }

      const raw = textRes.data.trim();
      if (raw.includes("<tt")) {
        const parsed = parseTTML(raw);
        if (parsed.lines.length) {
          return {
            lines: parsed.lines,
            syncLevel: String(best.timing_type || best.timingType || "").toLowerCase() === "word"
              ? "word"
              : parsed.syncLevel,
            _source: "BiniLyrics",
          };
        }
      }

      if (/\[\d{1,2}:\d{2}/.test(raw)) {
        const parsed = parseRichLrcWithWordRows(raw);
        if (parsed.lines.length) {
          return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: "BiniLyrics" };
        }
      }

      await sleep(100);
    }
    return null;
  }

  // ---------- LRCLIB: 絶対残す/粘り強く検索 ----------
  async function fetchFromLrclib(info, duration, trackKey) {
    const titles = titleVariants(info.title);
    const artists = artistVariants(info.artist);

    // 取得条件のartist表記がYouTubeチャンネル名になっている場合でも、
    // 曲名中心の全文検索ならLRCLIB上の正式アーティスト表記を見つけられる。
    // 多数の厳密GETを順番に試す前に実行し、「存在する歌詞」の初回表示を速くする。
    const fastQueries = uniq([
      `${titles[0] || info.title} ${artists[0] || ""}`,
      titles[0] || info.title,
      titles[titles.length - 1] || info.title,
    ]);
    for (let i = 0; i < fastQueries.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`LRCLIBで同期歌詞を高速検索中… ${i + 1}/${fastQueries.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ q: fastQueries[i] });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, info.title, info.artist, duration);
        if (candidate && candidate.syncedLyrics) {
          const lines = parseLRC(candidate.syncedLyrics);
          if (lines.length) return { lines, syncLevel: "line", _source: "LRCLIB" };
        }
      }
      await sleep(80);
    }

    const getAttempts = [];
    for (const t of titles.slice(0, 3)) {
      for (const a of artists.slice(0, 2)) {
        getAttempts.push({ t, a, album: info.album, duration });
        getAttempts.push({ t, a, album: "", duration });
        getAttempts.push({ t, a, album: "", duration: null });
      }
    }

    for (let i = 0; i < getAttempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = getAttempts[i];
      setStatus(`LRCLIBで同期歌詞を探し中… ${i + 1}/${getAttempts.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ track_name: x.t, artist_name: x.a });
      if (x.album) p.set("album_name", x.album);
      if (x.duration) p.set("duration", String(Math.round(x.duration)));
      const res = await fetchJson(`https://lrclib.net/api/get?${p.toString()}`);
      if (res.ok && res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
        if (res.data.syncedLyrics && scoreResult(res.data, x.t, x.a, x.duration) >= 120) {
          return {
            lines: parseLRC(res.data.syncedLyrics),
            syncLevel: "line",
            _source: "LRCLIB",
          };
        }
      }
      await sleep(150);
    }

    const structuredAttempts = [];
    for (const t of titles) {
      for (const a of artists) structuredAttempts.push({ t, a });
    }

    for (let i = 0; i < structuredAttempts.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      const x = structuredAttempts[i];
      setStatus(`LRCLIBで表記を変えて探し中… ${i + 1}/${structuredAttempts.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ track_name: x.t, artist_name: x.a });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, x.t, x.a, duration);
        if (candidate) {
          if (candidate.syncedLyrics) {
            return {
              lines: parseLRC(candidate.syncedLyrics),
              syncLevel: "line",
              _source: "LRCLIB",
            };
          }
        }
      }
      await sleep(130);
    }

    const queries = uniq([
      `${titles[0]} ${artists[0] || ""}`,
      `${titles[titles.length - 1]} ${artists[artists.length - 1] || ""}`,
      titles[titles.length - 1],
    ]);

    for (let i = 0; i < queries.length; i++) {
      if (trackKey !== STATE.lastTrackKey) return null;
      setStatus(`LRCLIBの広い検索で探し中… ${i + 1}/${queries.length}`);
      refreshSearchingSubtext();
      const p = new URLSearchParams({ q: queries[i] });
      const res = await fetchJson(`https://lrclib.net/api/search?${p.toString()}`);
      if (res.ok && Array.isArray(res.data)) {
        const candidate = bestSearchResult(res.data, info.title, info.artist, duration);
        if (candidate) {
          if (candidate.syncedLyrics) {
            return {
              lines: parseLRC(candidate.syncedLyrics),
              syncLevel: "line",
              _source: "LRCLIB",
            };
          }
        }
      }
      await sleep(130);
    }

    return null;
  }

  // ---------- Better Lyrics Kugou / QQ系 ----------
  async function fetchFromBoiduProvider(info, duration, trackKey, provider) {
    if (trackKey !== STATE.lastTrackKey) return null;
    const label = provider === "kugou" ? "Better Lyrics / Kugou" : "Better Lyrics / QQ";
    setStatus(`${label}でも同期歌詞を探し中…`);
    refreshSearchingSubtext();

    const p = buildBoiduParams(info, duration);
    const res = await fetchJson(`https://lyrics-api.boidu.dev/${provider}/getLyrics?${p.toString()}`);
    if (!res.ok || !res.data) return null;
    if (hasSearchResultMetadata(res.data) && !searchResultMatchesTrack(res.data, info.title, info.artist, duration)) return null;

    if (typeof res.data.ttml === "string") {
      const parsed = parseTTML(res.data.ttml);
      if (parsed.lines.length) {
        return {
          lines: parsed.lines,
          syncLevel: provider === "kugou" ? "line" : parsed.syncLevel,
          _source: label,
        };
      }
    }

    const lrc = res.data.syncedLyrics || res.data.lyrics || res.data.lrc;
    if (typeof lrc === "string" && /\[\d{1,2}:\d{2}/.test(lrc)) {
      const parsed = parseRichLrcWithWordRows(lrc);
      if (parsed.lines.length) {
        return { lines: parsed.lines, syncLevel: parsed.syncLevel, _source: label };
      }
    }
    return null;
  }

  // ---------- Karalyr: 追加同期候補 ----------
  async function fetchFromKaralyr(info, duration, trackKey) {
    const titles = titleVariants(info.title).slice(0, 3);
    const artists = artistVariants(info.artist).slice(0, 2);
    let attempt = 0;
    const total = titles.length * artists.length;

    for (const t of titles) {
      for (const a of artists) {
        if (trackKey !== STATE.lastTrackKey) return null;
        attempt++;
        setStatus(`別の同期歌詞DBも検索中… ${attempt}/${total}`);
        refreshSearchingSubtext();
        const p = new URLSearchParams({ track_name: t, artist_name: a });
        if (info.album) p.set("album_name", info.album);
        if (duration) p.set("duration", String(Math.round(duration)));
        const res = await fetchJson(`https://www.karalyr.com/api/get?${p.toString()}`);
        if (res.ok && res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
          if (res.data.syncedLyrics && (!hasSearchResultMetadata(res.data) || searchResultMatchesTrack(res.data, t, a, duration))) {
            return { lines: parseLRC(res.data.syncedLyrics), syncLevel: "line", _source: "Karalyr" };
          }
        }
        await sleep(100);
      }
    }
    return null;
  }
