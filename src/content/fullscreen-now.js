// ---------- 全画面歌詞ビュー：Mac の「再生中」画面 ----------
// Left: large artwork, title and artist, the song position, playback buttons and volume.
// Right: the lyrics. Buttons go through apple-shell.js (YouTube Music's own hidden buttons and
// the player's volume); without it they fall back to the <video>.
function fullscreenNowControls() {
 return globalThis.ytmlsAppleControls || null;
}
function fullscreenNowIcon(name) {
 const icons = fullscreenNowControls()?.icons;
 if (icons?.[name]) return icons[name];
 const paths = {play: '<path d="M8 5.2v13.6l11-6.8z"/>', pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1"/><rect x="13.7" y="5" width="3.8" height="14" rx="1"/>', prev: '<path d="M11.5 6v12L3.5 12zm9 0v12l-8-6z"/>', next: '<path d="M12.5 6v12l8-6zm-9 0v12l8-6z"/>'};
 return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths[name] || ''}</svg>`;
}
function fullscreenNowTime(seconds) {
 if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
 const s = Math.floor(seconds);
 return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function buildFullscreenNowPlaying(box) {
 const head = box.querySelector('.ytmls-full-head');
 if (!head) return;
 box.classList.add('ytmls-full-mac');
 const now = document.createElement('section');
 now.className = 'ytmls-full-now';
 now.setAttribute('aria-label', '再生中');
 head.replaceWith(now);
 now.append(head);

 const progress = document.createElement('div');
 progress.className = 'ytmls-full-progress';
 progress.setAttribute('role', 'slider');
 progress.setAttribute('aria-label', '再生位置');
 progress.tabIndex = 0;
 progress.innerHTML = '<span class="ytmls-full-progress-track"><span class="ytmls-full-progress-fill"></span></span><span class="ytmls-full-progress-times"><span class="ytmls-full-elapsed">0:00</span><span class="ytmls-full-remaining"></span></span>';
 let seeking = false;
 const ratioAt = event => {
  const rect = progress.querySelector('.ytmls-full-progress-track').getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
 };
 const seekTo = ratio => {
  const media = getVideoElement();
  const duration = getAuthoritativeDuration(media);
  if (!Number.isFinite(duration) || duration <= 0) return;
  const id = getAuthoritativeVideoId();
  if (id) requestPlayerSeek(id, ratio * duration);
  else if (media) media.currentTime = ratio * duration;
 };
 progress.addEventListener('pointerdown', event => { seeking = true; progress.setPointerCapture?.(event.pointerId); progress.classList.add('is-seeking'); progress.style.setProperty('--progress', String(ratioAt(event))); event.preventDefault(); });
 progress.addEventListener('pointermove', event => { if (seeking) progress.style.setProperty('--progress', String(ratioAt(event))); });
 const finish = event => { if (!seeking) return; seeking = false; progress.classList.remove('is-seeking'); seekTo(ratioAt(event)); };
 progress.addEventListener('pointerup', finish);
 progress.addEventListener('pointercancel', finish);
 progress.addEventListener('keydown', event => {
  const step = {ArrowRight: 5, ArrowLeft: -5}[event.key];
  if (step === undefined) return;
  event.preventDefault(); event.stopPropagation();
  const media = getVideoElement(), duration = getAuthoritativeDuration(media), time = getAuthoritativePlaybackTime(media);
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(time)) seekTo(Math.min(1, Math.max(0, (time + step) / duration)));
 });
 box.nowSeeking = () => seeking;

 const transport = document.createElement('div');
 transport.className = 'ytmls-full-transport';
 const control = (name, label, fn) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ytmls-full-transport-${name}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = fullscreenNowIcon(name);
  button.addEventListener('click', fn);
  transport.append(button);
  return button;
 };
 const run = name => () => {
  const controls = fullscreenNowControls();
  if (controls) { controls.transport[name](); return; }
  const media = getVideoElement();
  if (name === 'play' && media) media.paused ? media.play() : media.pause();
 };
 control('prev', '前へ', run('prev'));
 box.nowPlayButton = control('play', '再生', run('play'));
 control('next', '次へ', run('next'));

 now.append(progress, transport);
 const volume = fullscreenNowControls()?.createVolumeControl?.('ytmls-full-volume');
 if (volume) now.append(volume);
 // Like the Mac's full screen player: the controls (and the pointer) fade away after a few still
 // seconds and come back as soon as the mouse moves or a key is pressed. Not while one is in use.
 let idleTimer = 0;
 const wake = () => {
  box.classList.remove('ytmls-full-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
   if (practiceFullscreen !== box || seeking || box.matches(':has(.ytmls-full-size:hover, .ytmls-full-now:hover, .ytmls-full-corner:hover, :focus-visible)')) { wake(); return; }
   box.classList.add('ytmls-full-idle');
  }, 3000);
 };
 for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) box.addEventListener(type, wake, {passive: true});
 wake();
 updateFullscreenNowPlaying(box);
 const loop = () => {
  if (practiceFullscreen !== box || box.inert) return;
  updateFullscreenNowPlaying(box);
  // Five times a second, not every frame: the bar and the times barely move between frames.
  box.nowTimer = setTimeout(() => { box.nowFrame = requestAnimationFrame(loop); }, 200);
 };
 box.nowFrame = requestAnimationFrame(loop);
}
function updateFullscreenNowPlaying(box) {
 const progress = box.querySelector('.ytmls-full-progress');
 if (!progress) return;
 const media = getVideoElement();
 const duration = getAuthoritativeDuration(media);
 const time = getAuthoritativePlaybackTime(media);
 const known = Number.isFinite(duration) && duration > 0 && Number.isFinite(time);
 if (!box.nowSeeking?.()) {
  const ratio = (known ? Math.min(1, Math.max(0, time / duration)) : 0).toFixed(4);
  if (progress.style.getPropertyValue('--progress') !== ratio) progress.style.setProperty('--progress', ratio);
 }
 const elapsed = known ? fullscreenNowTime(time) : '0:00';
 const remaining = known ? `-${fullscreenNowTime(duration - time)}` : '';
 const elapsedEl = progress.querySelector('.ytmls-full-elapsed'), remainingEl = progress.querySelector('.ytmls-full-remaining');
 if (elapsedEl.textContent !== elapsed) elapsedEl.textContent = elapsed;
 if (remainingEl.textContent !== remaining) remainingEl.textContent = remaining;
 const valueText = known ? `${elapsed} / ${fullscreenNowTime(duration)}` : '';
 if (progress.getAttribute('aria-valuetext') !== valueText) progress.setAttribute('aria-valuetext', valueText);
 const playing = Boolean(media && !media.paused);
 const button = box.nowPlayButton;
 if (button && button.dataset.playing !== String(playing)) {
  button.dataset.playing = String(playing);
  button.innerHTML = fullscreenNowIcon(playing ? 'pause' : 'play');
  const label = playing ? '一時停止' : '再生';
  button.title = label; button.setAttribute('aria-label', label);
 }
}
