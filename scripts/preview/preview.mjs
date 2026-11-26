// Screenshots of the extension on a stand-in YouTube Music page (no network needed).
// Usage: node scripts/preview/preview.mjs [outDir] [scene...]
// Scenes: panel, menu, morph, fold, drag, wall, tap, candidates, readings, timing, fullscreen, popup, backup, light
// PREVIEW_EVAL='<js>' runs in the page before the scenes and prints the result.
// PREVIEW_SEED='<json>' adds entries to chrome.storage.local before the page opens.
import {createRequire} from 'node:module';
let chromium;
try { ({chromium} = createRequire(import.meta.url)('playwright')); } catch (_) {
  console.error('Playwright が見つかりません。NODE_PATH=$(npm root -g) を付けて実行するか、playwright を入れてください。');
  process.exit(1);
}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extDir = path.join(root, 'extension');
const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'ytmls-preview'));
const wanted = new Set(process.argv.slice(3));
const want = name => !wanted.size || wanted.has(name);
fs.mkdirSync(outDir, {recursive: true});

const VIDEO_ID = 'preview0001';
const LRC = [
  '[00:00.50]夜明け前の街を歩いてく', '[00:04.00]まだ誰も知らない歌を', '[00:07.50]胸の奥で鳴らしながら',
  '[00:11.00]運命なんて信じないけど', '[00:14.50]Hold on, the light is coming', '[00:18.00]君の声が聞こえる気がした',
  '[00:21.50]遠くで揺れる信号の青', '[00:25.00]ひとつずつ数えて', '[00:28.50]明日へ続く道を', '[00:32.00]二人で選んだ',
  '[00:35.50]Don\'t let go of this moment', '[00:39.00]何度でも思い出して', '[00:42.50]この空の色を',
].join('\n');
let COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544"><defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5e7e"/><stop offset=".5" stop-color="#7b3fe4"/><stop offset="1" stop-color="#1fb6c9"/></linearGradient>
<radialGradient id="s" cx=".3" cy=".3" r=".6"><stop offset="0" stop-color="#ffd36e" stop-opacity=".9"/><stop offset="1" stop-color="#ffd36e" stop-opacity="0"/></radialGradient></defs>
<rect width="544" height="544" fill="url(#g)"/><rect width="544" height="544" fill="url(#s)"/><circle cx="380" cy="360" r="110" fill="#0b1030" opacity=".55"/></svg>`;
// PREVIEW_COVER=yellow: a bright, busy yellow cover (sky, field, figures) to judge glass over light artwork.
const YELLOW_COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544"><rect width="544" height="544" fill="#f4e04a"/>
<rect width="544" height="190" fill="#9fd3f0"/><path d="M0 200q140-40 272 0t272-10v354H0z" fill="#d9c93a"/>
<circle cx="270" cy="300" r="90" fill="#f6b73c"/><rect x="230" y="330" width="80" height="170" fill="#6b4a2a"/>
<circle cx="120" cy="380" r="50" fill="#5a6ea8"/><circle cx="430" cy="420" r="40" fill="#222"/><text x="300" y="90" font-size="44" font-weight="900" fill="#7a2a14">NOTTEKE!</text></svg>`;
if (process.env.PREVIEW_COVER === 'yellow') COVER = YELLOW_COVER;
const LIGHT_COVER = COVER.replace('#ff5e7e', '#fff3c4').replace('#7b3fe4', '#ffd9e6').replace('#1fb6c9', '#cdeffd');

function page(light) {
  return `<!doctype html><html${light ? '' : ' dark'}><head><meta charset="utf-8"><title>YouTube Music</title>
<style>
 html,body{margin:0;height:100%;background:#030303;color:#fff;font-family:Roboto,Arial,sans-serif;overflow:hidden}
 ytmusic-app{display:block;height:100%}
 ytmusic-nav-bar{position:fixed;top:0;left:0;right:0;height:64px;display:flex;align-items:center;padding:0 24px;background:#030303;z-index:3}
 ytmusic-player-page{position:fixed;top:64px;left:72px;right:0;bottom:72px;display:flex;gap:48px;padding:24px 48px;box-sizing:border-box}
 #player{flex:1;display:flex;align-items:center;justify-content:center}
 #song-image img{width:min(40vw,480px);aspect-ratio:1;border-radius:8px}
 #side-panel{width:min(38vw,560px);display:flex;flex-direction:column;min-height:0}
 tp-yt-paper-tabs{display:flex;gap:0;border-bottom:1px solid #333}
 tp-yt-paper-tab{flex:1;text-align:center;padding:14px 0;font-weight:500;color:#aaa;cursor:pointer}
 tp-yt-paper-tab[aria-selected="true"]{color:#fff;border-bottom:2px solid #fff}
 #tab-renderer{flex:1;min-height:0;overflow:auto;display:block}
 ytmusic-player-bar{position:fixed;left:0;right:0;bottom:0;height:72px;overflow:visible;background:#212121;display:flex;align-items:center;gap:16px;padding:0 16px;z-index:4}
 ytmusic-player-bar .thumbnail-image-wrapper img{width:40px;height:40px;border-radius:2px}
 .middle-controls{display:flex;align-items:center;gap:12px;flex:1}
 .middle-controls-buttons{display:flex;gap:8px;align-items:center}
 ytmusic-search-box{display:block;margin-left:140px;width:480px;height:40px}
 ytmusic-search-box .search-box{height:100%;box-sizing:border-box;border:1px solid #ffffff26;border-radius:8px;background:#ffffff1a;display:flex;align-items:center;padding:0 14px}
 ytmusic-search-box input{flex:1;background:none;border:0;color:#fff;font-size:15px;outline:none}
 ytmusic-mini-guide-renderer{position:fixed;left:6px;top:76px;z-index:3;display:flex;flex-direction:column;gap:6px}
 ytmusic-mini-guide-entry-renderer{display:block;width:56px}
 tp-yt-paper-item{display:block;text-align:center;font-size:10px;padding:8px 0;border-radius:8px;line-height:1.6}
 ytmusic-mini-guide-entry-renderer[active] tp-yt-paper-item{background:#ffffff1f}
 #progress-bar{position:absolute;left:0;right:0;top:-6px;height:14px;display:block;cursor:pointer}
 #sliderContainer{position:relative;height:100%}
 #sliderBar{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:block}
 #progressContainer{position:relative;height:2px;background:var(--paper-slider-container-color,#ffffff33)}
 #secondaryProgress,#primaryProgress{position:absolute;inset:0;transform-origin:left}
 #secondaryProgress{background:var(--paper-slider-secondary-color,#ffffff55);transform:scaleX(.7)}
 #primaryProgress{background:var(--paper-slider-active-color,red);transform:scaleX(.4)}
 #sliderKnob{position:absolute;left:40%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;opacity:0;transition:opacity .2s}
 #progress-bar:hover #sliderKnob{opacity:1}
 #sliderKnobInner{width:100%;height:100%;border-radius:50%;background:var(--paper-slider-knob-color,red)}
 ytmusic-player-bar .title{font-weight:500}.byline{color:#aaa;font-size:14px}
</style></head><body><ytmusic-app>
<ytmusic-nav-bar>YouTube Music<ytmusic-search-box><div class="search-box"><input id="input" placeholder="曲、アルバム、アーティスト、ポッドキャストを検索"></div></ytmusic-search-box></ytmusic-nav-bar>
<ytmusic-mini-guide-renderer><ytmusic-mini-guide-entry-renderer active><tp-yt-paper-item>⌂<br>ホーム</tp-yt-paper-item></ytmusic-mini-guide-entry-renderer><ytmusic-mini-guide-entry-renderer><tp-yt-paper-item>◎<br>探索</tp-yt-paper-item></ytmusic-mini-guide-entry-renderer><ytmusic-mini-guide-entry-renderer><tp-yt-paper-item>▢<br>ライブラリ</tp-yt-paper-item></ytmusic-mini-guide-entry-renderer></ytmusic-mini-guide-renderer>
<ytmusic-player-page player-page-open_ player-ui-state="PLAYER_PAGE_OPEN">
 <div id="player"><ytmusic-player><div id="song-image"><img src="https://i.ytimg.com/vi/${VIDEO_ID}/cover.svg"></div>
  <div id="movie_player"><video class="html5-main-video" muted></video></div></ytmusic-player></div>
 <div id="side-panel"><tp-yt-paper-tabs id="tabs">
  <tp-yt-paper-tab role="tab" aria-selected="false"><div class="tab-content">次のコンテンツ</div></tp-yt-paper-tab>
  <tp-yt-paper-tab role="tab" aria-selected="true"><div class="tab-content">歌詞</div></tp-yt-paper-tab>
  <tp-yt-paper-tab role="tab" aria-selected="false"><div class="tab-content">関連</div></tp-yt-paper-tab></tp-yt-paper-tabs>
  <ytmusic-tab-renderer id="tab-renderer" page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"><div class="lyrics-placeholder"></div></ytmusic-tab-renderer></div>
</ytmusic-player-page>
<ytmusic-player-bar class="ytmusic-app"><tp-yt-paper-slider id="progress-bar"><div id="sliderContainer"><tp-yt-paper-progress id="sliderBar"><div id="progressContainer"><div id="secondaryProgress"></div><div id="primaryProgress"></div></div></tp-yt-paper-progress><div id="sliderKnob"><div id="sliderKnobInner"></div></div></div></tp-yt-paper-slider><div class="thumbnail-image-wrapper"><img class="image" src="https://i.ytimg.com/vi/${VIDEO_ID}/cover.svg"></div>
 <div class="middle-controls"><div class="content-info-wrapper"><div class="title ytmusic-player-bar">夜明けのうた</div><div class="byline ytmusic-player-bar">Preview Artist • Preview Album • 2026</div></div>
 <div class="middle-controls-buttons"></div></div></ytmusic-player-bar>
</ytmusic-app>
<script>
 const start = performance.now() - ${'${START}'} * 1000;
 const p = document.getElementById('movie_player');
 p.getVideoData = () => ({video_id: '${VIDEO_ID}', title: '夜明けのうた', author: 'Preview Artist'});
 p.getCurrentTime = () => (performance.now() - start) / 1000;
 p.getDuration = () => 200; p.getPlayerState = () => 1; p.getPlaybackRate = () => 1;
 // Tabs select on click or tap, like YouTube Music's paper-tabs.
 for (const t of document.querySelectorAll('tp-yt-paper-tab')) for (const type of ['click', 'tap']) t.addEventListener(type, () => {
  for (const o of document.querySelectorAll('tp-yt-paper-tab')) o.setAttribute('aria-selected', String(o === t));
 });
 navigator.mediaSession.metadata = new MediaMetadata({title: '夜明けのうた', artist: 'Preview Artist'});
</script></body></html>`;
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmls-profile-'));
const context = await chromium.launchPersistentContext(userData, {
  headless: true, channel: 'chromium', viewport: {width: 1440, height: 900}, deviceScaleFactor: Number(process.env.PREVIEW_SCALE) || 1,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let light = false;
await context.route('https://music.youtube.com/**', route => route.fulfill({contentType: 'text/html', body: page(light).replace('${START}', '19.2')}));
await context.route('https://i.ytimg.com/**', route => route.fulfill({contentType: 'image/svg+xml', headers: {'access-control-allow-origin': '*'}, body: light ? LIGHT_COVER : COVER}));
await context.route(url => !/^(https:\/\/(music\.youtube\.com|i\.ytimg\.com)|chrome-extension:|data:|blob:)/.test(url.href), route => route.abort());

let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extId = new URL(worker.url()).host;
await worker.evaluate(async ({id, lrc, seed}) => {
  await chrome.storage.local.set({ytmlsLocalLyricsV200: {[id]: {rawLrc: lrc, title: '夜明けのうた', artist: 'Preview Artist', updatedAt: Date.now()}}, ...seed});
}, {id: VIDEO_ID, lrc: LRC, seed: JSON.parse(process.env.PREVIEW_SEED || '{}')});

const shots = [];
async function open() {
  const tab = await context.newPage();
  await tab.goto(`https://music.youtube.com/watch?v=${VIDEO_ID}`);
  await tab.waitForSelector('#ytmls-panel .ytmls-line.ytmls-active', {timeout: 20000});
  await tab.waitForTimeout(1500);
  return tab;
}
async function shot(tab, name, clip) {
  const file = path.join(outDir, `${name}.png`);
  await tab.screenshot({path: file, clip}); shots.push(file);
}

const tab = await open();
if (process.env.PREVIEW_SCRIPT) await (await import(path.resolve(process.env.PREVIEW_SCRIPT))).run(tab, (...a) => console.log(...a.map(x => typeof x === 'string' ? x : JSON.stringify(x))));
if (process.env.PREVIEW_EVAL) console.log(JSON.stringify(await tab.evaluate(process.env.PREVIEW_EVAL), null, 1));
if (want('panel')) await shot(tab, 'panel');
if (want('menu')) {
  await tab.click('#ytmls-more summary').catch(() => {});
  await tab.waitForTimeout(400); await shot(tab, 'menu');
  await tab.keyboard.press('Escape'); await tab.click('#ytmls-more summary').catch(() => {});
}
if (want('drag')) {
  // Hold Medium, slide to Large, release: the bead follows and the size changes.
  await tab.click('#ytmls-more summary'); await tab.waitForTimeout(800);
  const box = async label => (await tab.locator('.ytmls-size-presets button', {hasText: label}).boundingBox());
  const mid = await box('中'), big = await box('大');
  const y = mid.y + mid.height / 2;
  await tab.mouse.move(mid.x + mid.width / 2, y); await tab.mouse.down(); await tab.waitForTimeout(260);
  for (let i = 1; i <= 6; i++) { await tab.mouse.move(mid.x + mid.width / 2 + (big.x - mid.x) * i / 10, y); await tab.waitForTimeout(16); }
  await shot(tab, 'drag-moving', {x: mid.x - 140, y: mid.y - 30, width: 340, height: 90});
  for (let i = 7; i <= 10; i++) { await tab.mouse.move(mid.x + mid.width / 2 + (big.x - mid.x) * i / 10, y); await tab.waitForTimeout(16); }
  await tab.waitForTimeout(300);
  await shot(tab, 'drag-holding', {x: mid.x - 140, y: mid.y - 30, width: 340, height: 90});
  await tab.mouse.up(); await tab.waitForTimeout(700);
  await shot(tab, 'drag-released', {x: mid.x - 140, y: mid.y - 30, width: 340, height: 90});
  console.log('pressed after drag:', await tab.evaluate(() => document.querySelector('.ytmls-size-presets button[aria-pressed="true"]')?.textContent));
  await tab.click('#ytmls-more summary');
}
if (want('wall')) {
  // Quick slide (no hold) from Medium past the right end: rubber band and squash, then the bounce back.
  await tab.click('#ytmls-more summary'); await tab.waitForTimeout(800);
  const mid = await tab.locator('.ytmls-size-presets button', {hasText: '中'}).boundingBox();
  const y = mid.y + mid.height / 2, x0 = mid.x + mid.width / 2;
  const clip = {x: mid.x - 140, y: mid.y - 30, width: 380, height: 90};
  await tab.mouse.move(x0, y); await tab.mouse.down();
  for (let i = 1; i <= 12; i++) { await tab.mouse.move(x0 + i * 22, y); await tab.waitForTimeout(16); }
  await tab.waitForTimeout(250); await shot(tab, 'wall-pulled', clip);
  await tab.mouse.up();
  for (const t of [60, 140, 600]) { await tab.waitForTimeout(t); await shot(tab, `wall-release-${t}`, clip); }
  console.log('pressed after wall:', await tab.evaluate(() => document.querySelector('.ytmls-size-presets button[aria-pressed="true"]')?.textContent));
  await tab.click('#ytmls-more summary');
}
if (want('tap')) {
  // A light tap (quick press, no movement) selects a size and slides the bead there.
  await tab.click('#ytmls-more summary'); await tab.waitForTimeout(800);
  const small = await tab.locator('.ytmls-size-presets button', {hasText: '小'}).boundingBox();
  await tab.mouse.click(small.x + small.width / 2, small.y + small.height / 2, {delay: 40});
  await tab.waitForTimeout(800);
  console.log('after tap:', JSON.stringify(await tab.evaluate(() => ({
    pressed: document.querySelector('.ytmls-size-presets button[aria-pressed="true"]')?.textContent,
    bead: document.querySelector('.ytmls-seg-thumb')?.style.transform,
    target: document.querySelector('.ytmls-size-presets button[aria-pressed="true"]')?.offsetLeft}))));
  await tab.click('#ytmls-more summary');
}
if (want('morph')) {
  // Frames of the menu growing out of "その他", the timing popover out of its button, and shrinking back.
  const frames = async (name, clip, open) => {
    // Animations started during the scene run 4x slower so the frames are evenly spaced (names keep real time).
    // Every animation that starts during the scene runs 4x slower, so the frames are evenly spaced
    // (names keep real time). The extension runs in its own world, so watch document.getAnimations().
    await tab.evaluate(() => {
      const seen = new WeakSet(document.getAnimations());
      window.__ytmlsSlow = true; window.__t0 = performance.now();
      const loop = () => {
        if (!window.__ytmlsSlow) return;
        for (const a of document.getAnimations()) if (!seen.has(a)) { seen.add(a); a.playbackRate = .25; }
        requestAnimationFrame(loop);
      };
      loop();
    });
    await open();
    for (const t of [30, 90, 160, 260, 600]) {
      await tab.waitForFunction(ms => performance.now() - window.__t0 >= ms * 4, t, {polling: 16});
      await shot(tab, `${name}-${t}`, clip);
      if (process.env.PREVIEW_DEBUG) console.log(name, t, await tab.evaluate(() => JSON.stringify({pane: document.getElementById('ytmls-tools-pane')?.hidden, full: !!document.getElementById('ytmls-fullscreen'), anims: document.getAnimations().map(a => a.effect?.target?.id || a.effect?.target?.className).slice(0, 4)})));
    }
    await tab.evaluate(() => { window.__ytmlsSlow = false; for (const a of document.getAnimations()) if (a.playbackRate !== 1) a.playbackRate = 1; });
  };
  const menuClip = {x: 1060, y: 120, width: 330, height: 600};
  await frames('morph-pane-open', {x: 840, y: 120, width: 560, height: 360}, () => tab.evaluate(() => [...document.querySelectorAll('#ytmls-tools .ytmls-tool-button')].find(b => b.textContent.includes('候補'))?.click()));
  await tab.waitForTimeout(300);
  await frames('morph-pane-close', {x: 840, y: 120, width: 560, height: 360}, () => tab.evaluate(() => [...document.querySelectorAll('#ytmls-tools-pane button')].find(b => b.textContent.trim() === '閉じる')?.click()));
  await tab.waitForTimeout(300);
  await frames('morph-menu-open', menuClip, () => tab.click('#ytmls-more summary'));
  await frames('morph-menu-close', menuClip, () => tab.click('#ytmls-more summary'));
  await tab.waitForTimeout(400);
  await frames('morph-timing-open', {x: 260, y: 260, width: 400, height: 640}, () => tab.evaluate(() => document.querySelector('#ytmls-track-offset-button')?.click()));
  await tab.keyboard.press('Escape'); await tab.waitForTimeout(400);
  await tab.waitForTimeout(300);
  const whole = {x: 0, y: 0, width: 1440, height: 900};
  await tab.click('#ytmls-more summary'); await tab.waitForTimeout(600);
  await frames('morph-full-open', whole, () => tab.evaluate(() => [...document.querySelectorAll('#ytmls-practice-controls button')].find(b => b.textContent.includes('全画面'))?.click()));
  await tab.waitForTimeout(600);
  await frames('morph-full-close', whole, () => tab.evaluate(() => document.querySelector('.ytmls-full-close')?.click()));
}
if (want('candidates')) {
  await tab.evaluate(() => [...document.querySelectorAll('#ytmls-tools .ytmls-tool-button')].find(b => b.textContent.includes('候補'))?.click());
  await tab.waitForTimeout(500); await shot(tab, 'candidates');
  await tab.evaluate(() => document.querySelector('#ytmls-tools-pane .ytmls-tools-close')?.click());
}
if (want('readings')) {
  await tab.evaluate(() => document.getElementById('ytmls-reading-edit')?.click());
  await tab.waitForTimeout(500); await shot(tab, 'readings');
  await tab.waitForTimeout(300);
  await frames('morph-pane-close', {x: 840, y: 120, width: 560, height: 360}, () => tab.evaluate(() => [...document.querySelectorAll('#ytmls-tools-pane button')].find(b => b.textContent.trim() === '閉じる')?.click()));
  await tab.waitForTimeout(300);
  const whole = {x: 0, y: 0, width: 1440, height: 900};
  await tab.click('#ytmls-more summary'); await tab.waitForTimeout(600);
  await frames('morph-full-open', whole, () => tab.evaluate(() => [...document.querySelectorAll('#ytmls-practice-controls button')].find(b => b.textContent.includes('全画面'))?.click()));
  await tab.waitForTimeout(600);
  await frames('morph-full-close', whole, () => tab.evaluate(() => document.querySelector('.ytmls-full-close')?.click()));
}
if (want('timing')) {
  await tab.evaluate(() => document.querySelector('#ytmls-track-offset-button')?.click());
  await tab.waitForTimeout(500); await shot(tab, 'timing');
  await tab.keyboard.press('Escape');
}
if (want('fullscreen')) {
  await tab.evaluate(() => { if (typeof openPracticeFullscreen === 'function') openPracticeFullscreen(); });
  await tab.evaluate(() => {
    const more = document.querySelector('#ytmls-more'); if (more) more.open = true;
    [...document.querySelectorAll('#ytmls-practice-controls button')].find(b => b.textContent.includes('全画面'))?.click();
  });
  await tab.waitForTimeout(1200); await shot(tab, 'fullscreen');
  await tab.keyboard.press('Escape');
}
await tab.close();
if (want('light')) {
  light = true; const t = await open(); await shot(t, 'light'); await t.close(); light = false;
}
for (const scheme of ['light', 'dark']) {
  if (want('popup')) {
    const p = await context.newPage(); await p.emulateMedia({colorScheme: scheme}); await p.setViewportSize({width: 640, height: 600});
    await p.goto(`chrome-extension://${extId}/popup.html`); await p.waitForTimeout(800);
    await shot(p, `popup-${scheme}`); await p.close();
  }
  if (want('fold') && scheme === 'dark') {
    // A disclosure in the settings popup opening and closing (4x slower; names keep real time).
    const p = await context.newPage(); await p.emulateMedia({colorScheme: scheme}); await p.setViewportSize({width: 640, height: 600});
    await p.goto(`chrome-extension://${extId}/popup.html`); await p.waitForTimeout(800);
    for (const phase of ['open', 'close']) {
      await p.evaluate(() => {
        const seen = new WeakSet(document.getAnimations()); window.__slow = true; window.__t0 = performance.now();
        const loop = () => { if (!window.__slow) return; for (const a of document.getAnimations()) if (!seen.has(a)) { seen.add(a); a.playbackRate = .25; } requestAnimationFrame(loop); };
        loop(); document.querySelector('.help-details > summary').click();
      });
      for (const t of [40, 120, 220, 600]) {
        await p.waitForFunction(ms => performance.now() - window.__t0 >= ms * 4, t, {polling: 16});
        await shot(p, `fold-${phase}-${t}`, {x: 158, y: 290, width: 482, height: 200});
      }
      await p.evaluate(() => { window.__slow = false; });
    }
    await p.close();
  }
  if (want('backup')) {
    const p = await context.newPage(); await p.emulateMedia({colorScheme: scheme});
    await p.goto(`chrome-extension://${extId}/backup.html`); await p.waitForTimeout(800);
    await shot(p, `backup-${scheme}`); await p.close();
  }
}
await context.close();
fs.rmSync(userData, {recursive: true, force: true});
console.log(shots.join('\n'));
