  // ---------- 文字列正規化・検索候補 ----------
  function uniq(values) {
    return [...new Set(values.map((v) => (v || "").trim()).filter(Boolean))];
  }

  function normalizeForCompare(value) {
    return (value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[\s\-‐‑‒–—―_・･·•:：/\\|,，.。!?！？()（）\[\]【】{}「」『』]/g, "");
  }

  function cleanTitle(value) {
    let s = (value || "").normalize("NFKC").trim();
    s = s.replace(
      /[\s　]*[\(\[【（][^\)\]】）]*(official|music\s*video|mv|pv|audio|visualizer|lyric|lyrics|歌詞|full|short|remaster(?:ed)?|live|字幕|和訳)[^\)\]】）]*[\)\]】）]/gi,
      ""
    );
    s = s.replace(/[\s　]+(?:official\s*)?(?:music\s*)?(?:video|mv|pv|audio|visualizer|lyrics?)\s*$/gi, "");
    s = s.replace(/[\s　]*[-–—｜|]\s*(?:official\s*)?(?:music\s*)?(?:video|mv|pv|audio|visualizer|lyrics?).*$/gi, "");
    return s.replace(/\s{2,}/g, " ").trim();
  }

  function stripFeaturing(value) {
    return (value || "")
      .replace(/[\s　]*[\(\[【（]?\s*(?:feat\.?|ft\.?|featuring)\s+[^\)\]】）]+[\)\]】）]?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function stripAllBrackets(value) {
    return (value || "")
      .replace(/\s*[\(（\[【][^\)）\]】]*[\)）\]】]\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanArtist(value) {
    return (value || "")
      .normalize("NFKC")
      .replace(/\s*[-–—]\s*Topic\s*$/i, "")
      .replace(/\s*VEVO\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function titleVariants(title) {
    const cleaned = cleanTitle(title);
    const noFeat = stripFeaturing(cleaned);
    const noBrackets = stripAllBrackets(noFeat);
    const beforeSlash = noBrackets.split(/\s+[\/｜|]\s+/)[0]?.trim();
    return uniq([title, cleaned, noFeat, noBrackets, beforeSlash]);
  }

  function artistVariants(artist) {
    const cleaned = cleanArtist(artist);
    const firstArtist = cleaned.split(/\s*(?:,|、|&|＆|×| x |\/|／)\s*/i)[0]?.trim();
    return uniq([artist, cleaned, firstArtist]);
  }

  // ---------- LRC ----------
  function parseLRC(lrcText) {
    const lines = [];
    let globalOffset = 0;
    const offsetMatch = (lrcText || "").match(/\[offset:([+-]?\d+(?:\.\d+)?)\]/i);
    if (offsetMatch) {
      const raw = Number(offsetMatch[1]);
      // LRC標準はms。ただし一部ソースは秒小数を返すため、小さい小数は秒として扱う。
      globalOffset = Number.isFinite(raw) ? (Math.abs(raw) < 20 && String(offsetMatch[1]).includes(".") ? raw : raw / 1000) : 0;
    }

    const timeTagRe = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;

    (lrcText || "").split(/\r?\n/).forEach((rawLine) => {
      const tags = [...rawLine.matchAll(timeTagRe)];
      if (!tags.length) return;

      // BetterLyrics/Musixmatch系の拡張ワードタグは表示本文から除去。
      const text = rawLine
        .replace(timeTagRe, "")
        .replace(/<[^>]+>/g, "")
        .trim();

      tags.forEach((m) => {
        const minutes = parseInt(m[1], 10);
        const seconds = parseFloat(m[2]);
        lines.push({
          time: Math.max(0, minutes * 60 + seconds + globalOffset),
          end: null,
          text,
          words: [],
        });
      });
    });

    lines.sort((a, b) => a.time - b.time);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].end == null) lines[i].end = lines[i + 1]?.time ?? null;
    }
    return lines;
  }

  // ---------- TTML (Better Lyrics / BiniLyrics / Unison) ----------
  function parseTtmlTime(value) {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;

    if (/^\d+(?:\.\d+)?ms$/i.test(s)) return Number.parseFloat(s) / 1000;
    if (/^\d+(?:\.\d+)?s$/i.test(s)) return Number.parseFloat(s);

    const parts = s.split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const sec = Number(parts[2]);
      if ([h, m, sec].every(Number.isFinite)) return h * 3600 + m * 60 + sec;
    }
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const sec = Number(parts[1]);
      if ([m, sec].every(Number.isFinite)) return m * 60 + sec;
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function detectDirection(lang) {
    const base = (lang || "").toLowerCase().split(/[-_]/)[0];
    return ["ar", "he", "fa", "ur"].includes(base) ? "rtl" : "auto";
  }

  function getAttrAny(el, names) {
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value != null) return value;
    }
    return null;
  }

  function collectTimedSpans(element, inheritedBackground, output) {
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node;
      const localName = (el.localName || el.tagName || "").toLowerCase();
      if (localName !== "span") continue;

      const role = getAttrAny(el, ["ttm:role", "role"]);
      const isBackground = inheritedBackground || role === "x-bg";
      const begin = parseTtmlTime(el.getAttribute("begin"));
      const end = parseTtmlTime(el.getAttribute("end"));
      const hasTimedChild = Array.from(el.children).some(
        (child) => (child.localName || child.tagName || "").toLowerCase() === "span" && child.getAttribute("begin")
      );

      if (begin != null && !hasTimedChild) {
        output.push({
          text: el.textContent || "",
          time: begin,
          end: end != null ? end : begin,
          background: isBackground,
        });
      } else {
        collectTimedSpans(el, isBackground, output);
      }
    }
  }

  function parseTTML(ttmlString) {
    if (!ttmlString || typeof ttmlString !== "string") return { lines: [], syncLevel: "none" };

    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlString, "text/xml");
    if (doc.querySelector("parsererror")) return { lines: [], syncLevel: "none" };

    const root = doc.documentElement;
    const lang = getAttrAny(root, ["xml:lang", "lang"]) || "";
    const dir = detectDirection(lang);
    const lines = [];
    let hasWords = false;

    doc.querySelectorAll("p").forEach((p) => {
      const begin = parseTtmlTime(p.getAttribute("begin"));
      const end = parseTtmlTime(p.getAttribute("end"));
      if (begin == null) return;

      const words = [];
      collectTimedSpans(p, false, words);
      const text = (p.textContent || "").trim();
      if (!text && !words.length) return;

      if (words.length) hasWords = true;
      lines.push({
        time: begin,
        end: end != null ? end : (words.length ? words[words.length - 1].end : null),
        text: text || words.map((w) => w.text).join(""),
        words,
        agent: getAttrAny(p, ["ttm:agent", "agent"]) || "",
        dir,
      });
    });

    lines.sort((a, b) => a.time - b.time);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].end == null) lines[i].end = lines[i + 1]?.time ?? null;
    }

    // TTMLのspanタイミングは実質ワード/音節同期。Better Lyrics本体は音節同期として扱う。
    return { lines, syncLevel: hasWords ? "syllable" : (lines.length ? "line" : "none") };
  }

  function parseRichLrcWithWordRows(lrcText) {
    // Bini/YouLy+系で [mm:ss]行の次に <word:start:end|...> が来る形式を軽くサポート。
    const rows = (lrcText || "").split(/\r?\n/);
    const base = parseLRC(lrcText);
    if (!base.length) return { lines: [], syncLevel: "none" };

    let baseCursor = 0;
    let pendingLineIndices = [];
    for (const raw of rows) {
      const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)];
      if (tags.length) {
        pendingLineIndices = Array.from({ length: tags.length }, (_, index) => baseCursor + index);
        baseCursor += tags.length;
        continue;
      }
      if (!pendingLineIndices.length || !/^<.*>$/.test(raw.trim())) continue;
      const body = raw.trim().slice(1, -1);
      const pieces = body.split("|");
      const words = [];
      for (const piece of pieces) {
        const m = piece.match(/^(.*?):([0-9.]+):([0-9.]+)$/);
        if (!m) continue;
        words.push({
          text: m[1],
          time: Number(m[2]),
          end: Number(m[3]),
          background: false,
        });
      }
      if (words.length) {
        const firstLine = base[pendingLineIndices[0]];
        for (const lineIndex of pendingLineIndices) {
          const line = base[lineIndex];
          if (!line) continue;
          const shift = firstLine && Number.isFinite(firstLine.time) && Number.isFinite(line.time)
            ? line.time - firstLine.time
            : 0;
          line.words = words.map((word) => ({
            ...word,
            time: word.time + shift,
            end: word.end + shift,
          }));
        }
      }
      pendingLineIndices = [];
    }

    const hasWords = base.some((line) => line.words && line.words.length);
    return { lines: base, syncLevel: hasWords ? "word" : "line" };
  }
