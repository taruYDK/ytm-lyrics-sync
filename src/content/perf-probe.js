// ---------- Where the time goes (for the diagnostics) ----------
// Chrome reports every animation frame that took longer than 50ms, with the scripts that ran in it
// (which file and function) and the time spent on style and layout. The last 20 seconds are kept,
// so "全体が重い" reports can say whether this extension, YouTube Music or the drawing is the cause.
// Nothing is measured until 診断情報 is opened (perfProbeStart): normal playback pays nothing.
// Chrome keeps the recent slow frames itself, so the first copy still shows them.
const perfProbeFrames = [];
globalThis.ytmlsPerfOn = false;
// Time this extension's own regular work takes (per second over the last 20 seconds), measured
// around each loop: apple-shell.js and the content script add to it through ytmlsPerfAdd.
const perfProbeOwn = new Map();
globalThis.ytmlsPerfAdd = (name, ms) => {
 const now = performance.now(), slot = Math.floor(now / 1000);
 let entry = perfProbeOwn.get(name);
 if (!entry) { entry = {slots: new Map(), max: 0}; perfProbeOwn.set(name, entry); }
 entry.slots.set(slot, (entry.slots.get(slot) || 0) + ms);
 if (ms > entry.max) entry.max = ms;
 for (const key of entry.slots.keys()) if (key < slot - 20) entry.slots.delete(key);
};
function perfProbeOwnText() {
 const slot = Math.floor(performance.now() / 1000);
 const rows = [...perfProbeOwn].map(([name, entry]) => {
  let total = 0;
  for (const [key, ms] of entry.slots) if (key >= slot - 20) total += ms;
  return [name, total / 20, entry.max];
 }).filter(row => row[1] > 0).sort((a, b) => b[1] - a[1]);
 return `own=[${rows.map(([name, perSecond, max]) => `${name}: ${perSecond.toFixed(1)}ms/s max ${Math.round(max)}ms`).join(' ; ') || 'none'}]`;
}
function perfProbeStart() {
 if (globalThis.ytmlsPerfOn) return;
 globalThis.ytmlsPerfOn = true;
 if (typeof PerformanceObserver !== 'function') return;
 const keep = entry => {
  perfProbeFrames.push(entry);
  const cutoff = performance.now() - 20000;
  while (perfProbeFrames.length && (perfProbeFrames[0].startTime < cutoff || perfProbeFrames.length > 400)) perfProbeFrames.shift();
 };
 try { new PerformanceObserver(list => list.getEntries().forEach(keep)).observe({type: 'long-animation-frame', buffered: true}); }
 catch (_) {
  try { new PerformanceObserver(list => list.getEntries().forEach(keep)).observe({type: 'longtask', buffered: true}); } catch (__) {}
 }
}
// Things that could pile up song after song (a report said it gets heavier after changing songs).
function perfProbeCounts() {
 const q = selector => document.querySelectorAll(selector).length;
 const heap = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '-';
 const segments = typeof glassSegmentAttachCount === 'number' ? glassSegmentAttachCount : '-';
 const ambient = typeof globalThis.ytmlsAmbientStats === 'function' ? globalThis.ytmlsAmbientStats() : 'ambient=-';
 return `counts=[nodes=${q('*')} ours=${q('[id^="ytmls"], [class*="ytmls"]')} canvases=${q('canvas')} imgs=${q('img')} lyricLines=${q('.ytmls-line')} thumbs=${q('.ytmls-seg-thumb')} lenses=${q('.ytmls-seg-lens')} segmentsAttached=${segments} ${ambient} heap=${heap} songs=${perfProbeSongs.size}]`;
}
const perfProbeSongs = new Set();
// Songs played in this tab (one cheap look every few seconds), to compare the counts after several songs.
setInterval(() => {
 if (document.hidden || !globalThis.ytmlsPerfOn) return;
 try { const id = typeof getAuthoritativeVideoId === 'function' ? getAuthoritativeVideoId() : ''; if (id) perfProbeSongs.add(id); } catch (_) {}
}, 4000);
function perfProbeDiagnostics() {
 if (!globalThis.ytmlsPerfOn) { perfProbeStart(); return `measuring=started (診断情報を開いたまま 20 秒ほど使ってからもう一度コピー) ${perfProbeFramesText()} ${perfProbeCounts()}`; }
 return `${perfProbeFramesText()} ${perfProbeOwnText()} ${perfProbeCounts()}`;
}
function perfProbeFramesText() {
 const cutoff = performance.now() - 20000;
 const frames = perfProbeFrames.filter(entry => entry.startTime >= cutoff);
 if (!frames.length) return 'slowFrames20s=0';
 const total = frames.reduce((sum, entry) => sum + entry.duration, 0);
 // A frame: tasks and scripts, then (from renderStart) animation-frame callbacks, then (from
 // styleAndLayoutStart) style and layout, then painting (not timed here).
 const end = entry => entry.startTime + entry.duration;
 const layout = frames.reduce((sum, entry) => sum + (entry.styleAndLayoutStart ? Math.max(0, end(entry) - entry.styleAndLayoutStart) : 0), 0);
 const render = frames.reduce((sum, entry) => sum + (entry.renderStart && entry.styleAndLayoutStart ? Math.max(0, entry.styleAndLayoutStart - entry.renderStart) : 0), 0);
 const bySource = new Map();
 let scriptTotal = 0;
 for (const entry of frames) for (const script of entry.scripts || []) {
  const file = String(script.sourceURL || '').replace(/^.*\//, '').replace(/[?#].*$/, '') || '?';
  const owner = /^chrome-extension:/.test(script.sourceURL || '') ? 'ext' : 'page';
  const key = `${owner}:${file}:${script.sourceFunctionName || script.invoker || '?'}`;
  bySource.set(key, (bySource.get(key) || 0) + script.duration);
  scriptTotal += script.duration;
 }
 const top = [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, ms]) => `${key}=${Math.round(ms)}`).join(' ');
 const worst = Math.max(...frames.map(entry => entry.duration));
 return `slowFrames20s=${frames.length} total=${Math.round(total)}ms worst=${Math.round(worst)}ms scripts=${Math.round(scriptTotal)}ms rafCallbacks=${Math.round(render)}ms styleLayout=${Math.round(layout)}ms top=[${top || 'none'}]`;
}
