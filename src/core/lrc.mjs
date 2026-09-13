export function editableLineText(line) {
  if (line && Array.isArray(line.words) && line.words.length) {
    return line.words.map((word) => String((word && word.text) || "")).join("");
  }
  return String((line && line.text) || "");
}

export function formatLrcTimestamp(seconds) {
  const centiseconds = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const minutes = Math.floor(centiseconds / 6000);
  const remainder = centiseconds - minutes * 6000;
  const wholeSeconds = Math.floor(remainder / 100);
  const fraction = remainder % 100;
  return `[${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}]`;
}

export function exportedPlaybackTime(lyricTime, points, duration) {
  if (lyricTime <= 0) return 0;
  if (!(duration > 0)) return Math.max(0, lyricTime - (points[0]?.offsetMs || 0) / 1000);
  const nodes = points.map(point => ({ t: point.position * duration, o: point.offsetMs / 1000 }));
  if (!nodes.length) return lyricTime;
  if (nodes[0].t > 0) nodes.unshift({ t: 0, o: nodes[0].o });
  const last = nodes[nodes.length - 1];
  nodes.push({ t: Math.max(duration, last.t, lyricTime + Math.abs(last.o)) + 1, o: last.o });
  if (nodes[0].t + nodes[0].o >= lyricTime) return 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    const ga = a.t + a.o, gb = b.t + b.o;
    if (ga <= lyricTime && gb >= lyricTime && gb > ga) {
      return Math.max(0, a.t + (lyricTime - ga) * (b.t - a.t) / (gb - ga));
    }
  }
  return Math.max(0, lyricTime - last.o);
}

export function buildExportLrc(lines, info, points, duration, applyOffsets) {
  const clean = text => String(text || "").replace(/[\r\n\[\]]/g, " ").trim();
  const rows = lines.filter(line => Number.isFinite(Number(line.time)))
    .map(line => ({ time: applyOffsets ? exportedPlaybackTime(Number(line.time), points, duration) : Math.max(0, Number(line.time)),
      text: editableLineText(line).replace(/[\r\n]+/g, " ").trim() }))
    .filter(line => line.text).sort((a, b) => a.time - b.time);
  if (!rows.length) throw new Error("書き出せる同期歌詞がありません。");
  return [`[ti:${clean(info.title)}]`, `[ar:${clean(info.artist)}]`, "[offset:0]", "",
    ...rows.map(line => formatLrcTimestamp(line.time) + line.text)].join("\r\n") + "\r\n";
}
