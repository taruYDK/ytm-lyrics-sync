// ---------- Lyrics share card (like Apple Music's lyrics sharing) ----------
// Pick up to four lines; they are drawn on a card in the cover's colours with the song's artwork,
// title and artist, to copy as an image or save as a PNG. Everything is drawn here, in the page.
const SHARE_CARD_WIDTH = 1080, SHARE_CARD_HEIGHT = 1350, SHARE_MAX_LINES = 4;
const SHARE_FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Segoe UI", Roboto, sans-serif';
let shareCardEl = null;

function shareArtworkUrl() {
 const img = document.querySelector('ytmusic-player-bar img.image, ytmusic-player-bar .thumbnail-image-wrapper img, ytmusic-player #song-image img');
 const url = img?.currentSrc || img?.src || '';
 if (!/^https:\/\/[^/]*(ytimg\.com|googleusercontent\.com|ggpht\.com)\//.test(url)) return '';
 return url.replace(/=w\d+-h\d+(-[^/?#]*)?$/, '=w720-h720-l90-rj').replace(/\/(?:default|mqdefault|sddefault)\.jpg/, '/hqdefault.jpg');
}

// The cover, readable for drawing if the image server allows it (else null: the card uses the
// colours Music Glass took from it, or a plain dark gradient).
function loadShareArtwork(url) {
 return new Promise(resolve => {
  if (!url) { resolve(null); return; }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = url;
 });
}

function shareWrap(ctx, text, maxWidth) {
 const rows = [];
 for (const paragraph of String(text).split('\n')) {
  let row = '';
  for (const char of paragraph) {
   const next = row + char;
   if (ctx.measureText(next).width <= maxWidth || !row) { row = next; continue; }
   // Latin words break at the last space; Japanese breaks anywhere.
   const space = row.lastIndexOf(' ');
   if (space > 0 && /[A-Za-z0-9]/.test(char)) { rows.push(row.slice(0, space)); row = row.slice(space + 1) + char; }
   else { rows.push(row); row = char.trim() ? char : ''; }
  }
  if (row) rows.push(row);
 }
 return rows;
}

function auroraColors() {
 const style = getComputedStyle(document.documentElement);
 return ['--mg-aurora-1', '--mg-aurora-2', '--mg-aurora-3'].map(key => style.getPropertyValue(key).trim()).filter(Boolean).map(value => `rgb(${value})`);
}

function drawShareCard(canvas, {lines, title, artist, artwork}) {
 const W = SHARE_CARD_WIDTH, H = SHARE_CARD_HEIGHT;
 canvas.width = W; canvas.height = H;
 const ctx = canvas.getContext('2d');
 // Background: the cover blown up, blurred and deepened; without it, its colours as a gradient.
 const colors = auroraColors();
 const base = ctx.createLinearGradient(0, 0, W, H);
 base.addColorStop(0, colors[0] || '#5a2a48');
 base.addColorStop(.55, colors[1] || '#2b2440');
 base.addColorStop(1, colors[2] || '#161520');
 ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
 if (artwork) {
  const side = Math.min(artwork.naturalWidth, artwork.naturalHeight);
  ctx.save();
  ctx.filter = 'blur(70px) saturate(1.6) brightness(.72)';
  ctx.drawImage(artwork, (artwork.naturalWidth - side) / 2, (artwork.naturalHeight - side) / 2, side, side, -260, -200, H + 300, H + 300);
  ctx.restore();
 }
 const veil = ctx.createLinearGradient(0, 0, 0, H);
 veil.addColorStop(0, 'rgba(0,0,0,.12)'); veil.addColorStop(1, 'rgba(0,0,0,.42)');
 ctx.fillStyle = veil; ctx.fillRect(0, 0, W, H);

 const pad = 96;
 // Header: artwork with a soft shadow, then title and artist.
 const art = 168;
 ctx.save();
 ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
 ctx.beginPath(); ctx.roundRect(pad, pad, art, art, 22); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
 ctx.restore();
 if (artwork) {
  const side = Math.min(artwork.naturalWidth, artwork.naturalHeight);
  ctx.save(); ctx.beginPath(); ctx.roundRect(pad, pad, art, art, 22); ctx.clip();
  ctx.drawImage(artwork, (artwork.naturalWidth - side) / 2, (artwork.naturalHeight - side) / 2, side, side, pad, pad, art, art);
  ctx.restore();
 }
 const textX = pad + art + 36, textW = W - textX - pad;
 ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
 ctx.font = `700 44px ${SHARE_FONT}`;
 const titleRows = shareWrap(ctx, title || '', textW).slice(0, 2);
 let y = pad + 62;
 for (const row of titleRows) { ctx.fillText(row, textX, y); y += 54; }
 ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `500 34px ${SHARE_FONT}`;
 ctx.fillText(shareWrap(ctx, artist || '', textW)[0] || '', textX, y + 2);

 // The lines: large and heavy, fitted to the space between the header and the footer.
 const top = pad + art + 90, bottom = H - pad - 70, width = W - pad * 2;
 let size = 84, rows = [];
 for (; size >= 44; size -= 4) {
  ctx.font = `800 ${size}px ${SHARE_FONT}`;
  rows = lines.map(line => shareWrap(ctx, line, width));
  const height = rows.reduce((sum, group) => sum + group.length * size * 1.22, 0) + (rows.length - 1) * size * .5;
  if (height <= bottom - top) break;
 }
 const lineHeight = size * 1.22;
 const total = rows.reduce((sum, group) => sum + group.length * lineHeight, 0) + (rows.length - 1) * size * .5;
 y = top + Math.max(0, (bottom - top - total) / 2) + size;
 ctx.fillStyle = '#fff';
 ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 24;
 for (const group of rows) {
  for (const row of group) { ctx.fillText(row, pad, y); y += lineHeight; }
  y += size * .5;
 }
 ctx.shadowBlur = 0;
 // Footer.
 ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `600 28px ${SHARE_FONT}`;
 ctx.fillText('YT Music 歌詞シンクロ', pad, H - pad);
}

function closeShareCard() {
 if (!shareCardEl) return;
 const el = shareCardEl;
 shareCardEl = null;
 el.classList.remove('is-open');
 setTimeout(() => el.remove(), 220);
}

async function openShareCard() {
 if (shareCardEl || !STATE.lines.length) return;
 const title = STATE.lastDisplayedTitle || '', artist = STATE.lastDisplayedArtist || '';
 const texts = STATE.lines.map(line => String(line.text || '').trim());
 const current = typeof liveLyricsIndex === 'function' ? liveLyricsIndex() : -1;
 const selected = new Set();
 // Start with the line being sung and the next one (or the first lines that have words).
 const first = current >= 0 && texts[current] ? current : texts.findIndex(Boolean);
 for (let i = first; i >= 0 && i < texts.length && selected.size < 2; i++) if (texts[i]) selected.add(i);

 const el = document.createElement('div');
 el.id = 'ytmls-share';
 el.setAttribute('role', 'dialog');
 el.setAttribute('aria-modal', 'true');
 el.setAttribute('aria-label', '歌詞を共有');
 el.innerHTML = `<div class="ytmls-share-sheet">
  <div class="ytmls-share-head"><strong>歌詞を共有</strong><span class="ytmls-share-hint">行を選んでください（${SHARE_MAX_LINES}行まで）</span><button type="button" class="ytmls-share-close" aria-label="閉じる">×</button></div>
  <div class="ytmls-share-body"><div class="ytmls-share-lines" role="listbox" aria-multiselectable="true"></div><div class="ytmls-share-preview"><canvas></canvas></div></div>
  <div class="ytmls-share-actions"><span class="ytmls-share-status" role="status"></span><button type="button" class="ytmls-share-save">画像を保存</button><button type="button" class="ytmls-share-copy">画像をコピー</button></div>
 </div>`;
 document.body.append(el);
 shareCardEl = el;
 requestAnimationFrame(() => el.classList.add('is-open'));
 const canvas = el.querySelector('canvas');
 const status = el.querySelector('.ytmls-share-status');
 const list = el.querySelector('.ytmls-share-lines');
 const artwork = await loadShareArtwork(shareArtworkUrl());
 let exportable = true;
 const redraw = () => {
  const lines = [...selected].sort((a, b) => a - b).map(i => texts[i]);
  drawShareCard(canvas, {lines: lines.length ? lines : ['♪'], title, artist, artwork});
  try { canvas.getContext('2d').getImageData(0, 0, 1, 1); exportable = true; } catch (_) { exportable = false; }
 };
 texts.forEach((text, index) => {
  if (!text) return;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'ytmls-share-line';
  row.setAttribute('role', 'option');
  row.textContent = text;
  const sync = () => row.setAttribute('aria-selected', String(selected.has(index)));
  sync();
  row.addEventListener('click', () => {
   if (selected.has(index)) selected.delete(index);
   else if (selected.size < SHARE_MAX_LINES) selected.add(index);
   else { status.textContent = `${SHARE_MAX_LINES}行までです`; return; }
   status.textContent = '';
   sync(); redraw();
  });
  list.append(row);
  if (index === first) requestAnimationFrame(() => { list.scrollTop = Math.max(0, row.offsetTop - 80); });
 });
 redraw();
 const blob = () => new Promise((resolve, reject) => {
  if (!exportable) { reject(new Error('artwork')); return; }
  canvas.toBlob(value => value ? resolve(value) : reject(new Error('blob')), 'image/png');
 });
 el.querySelector('.ytmls-share-copy').addEventListener('click', async () => {
  try {
   const image = await blob();
   await navigator.clipboard.write([new ClipboardItem({'image/png': image})]);
   status.textContent = 'コピーしました';
  } catch (_) { status.textContent = 'コピーできませんでした。「画像を保存」を使ってください'; }
 });
 el.querySelector('.ytmls-share-save').addEventListener('click', async () => {
  try {
   const image = await blob();
   const link = document.createElement('a');
   link.href = URL.createObjectURL(image);
   link.download = `${(title || 'lyrics').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60)}.png`;
   link.click();
   setTimeout(() => URL.revokeObjectURL(link.href), 4000);
   status.textContent = '保存しました';
  } catch (_) { status.textContent = '保存できませんでした'; }
 });
 el.querySelector('.ytmls-share-close').addEventListener('click', closeShareCard);
 el.addEventListener('click', event => { if (event.target === el) closeShareCard(); });
 el.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeShareCard(); } });
 el.querySelector('.ytmls-share-close').focus();
}
