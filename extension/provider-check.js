// Settings → 歌詞取得 → 提供元をテスト: asks each provider for a song every database has,
// through the background fetcher the content script uses, and shows whether it answered.
(() => {
  'use strict';
  const SONG = {title: 'Shape of You', artist: 'Ed Sheeran', duration: 233};
  const q = encodeURIComponent;
  const PROBES = [
    {label: 'Better Lyrics', url: `https://lyrics-api.boidu.dev/getLyrics?s=${q(SONG.title)}&a=${q(SONG.artist)}&d=${SONG.duration}`,
      found: data => typeof data?.ttml === 'string' && data.ttml.includes('<p')},
    {label: 'Better Lyrics（統合API）', url: `https://lyrics.api.dacubeking.com/lyrics?song=${q(SONG.title)}&artist=${q(SONG.artist)}&duration=${SONG.duration}`,
      found: data => Boolean(data && ['musixmatchWordByWordLyrics','musixmatchSyncedLyrics','lrclibSyncedLyrics','goLyricsApiTtml','lyrics'].some(key => typeof data[key] === 'string' && data[key].trim()))},
    {label: 'LRCLIB', url: `https://lrclib.net/api/get?track_name=${q(SONG.title)}&artist_name=${q(SONG.artist)}&duration=${SONG.duration}`,
      found: data => typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim() !== ''},
    {label: 'Unison', url: `https://unison.boidu.dev/lyrics?song=${q(SONG.title)}&artist=${q(SONG.artist)}&duration=${SONG.duration}`,
      found: data => typeof (data?.data?.lyrics ?? data?.lyrics) === 'string' && (data.data?.lyrics ?? data.lyrics).trim() !== ''},
    {label: 'BiniLyrics', url: `https://lrc.red/api/v1?track=${q(SONG.title)}&artist=${q(SONG.artist)}&duration=${SONG.duration}`,
      found: data => Array.isArray(data?.results) && data.results.length > 0},
    {label: 'Karalyr', url: `https://www.karalyr.com/api/get?track_name=${q(SONG.title)}&artist_name=${q(SONG.artist)}&duration=${SONG.duration}`,
      found: data => typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim() !== ''},
  ];
  const LABELS = {
    found: '歌詞あり', notfound: '応答あり・見つからず', offline: '接続できません', error: 'エラー',
    testing: '確認中…', nosong: '曲を再生するとテストできます', notab: 'YouTube Musicを開いてください',
  };

  // Classifies one background fetch result.
  function classify(response, probe) {
    if (!response || response.status === 0) return {state: 'offline'};
    if (response.status === 404) return {state: 'notfound'};
    if (!response.ok) return {state: 'error', status: response.status};
    return {state: probe.found(response.data) ? 'found' : 'notfound'};
  }

  async function runProbe(probe) {
    const started = performance.now();
    let response = null;
    try { response = await chrome.runtime.sendMessage({type: 'YTMLS_FETCH', url: probe.url, responseType: 'json', timeoutMs: 12000}); } catch (_) {}
    return {...classify(response, probe), ms: Math.round(performance.now() - started)};
  }

  async function runYouTubeMusicProbe() {
    let tabs = [];
    try { tabs = await chrome.tabs.query({url: 'https://music.youtube.com/*'}); } catch (_) {}
    if (!tabs.length) return {state: 'notab'};
    const started = performance.now();
    try {
      const result = await chrome.tabs.sendMessage(tabs[0].id, {type: 'YTMLS_TEST_YTM'});
      return {...(result || {state: 'notab'}), ms: Math.round(performance.now() - started), currentSong: true};
    } catch (_) { return {state: 'notab'}; }
  }

  function render(list, rows) {
    list.replaceChildren(...rows.map(({label, result}) => {
      const row = document.createElement('li');
      row.className = 'provider-test-row';
      row.dataset.state = result.state;
      const name = document.createElement('span'); name.className = 'provider-test-name'; name.textContent = label;
      const status = document.createElement('span'); status.className = 'provider-test-status';
      let text = LABELS[result.state] || result.state;
      if (result.state === 'error' && result.status) text += `（HTTP ${result.status}）`;
      if (result.currentSong && result.state === 'notfound') text = '接続は正常・再生中の曲の歌詞なし';
      if (Number.isFinite(result.ms) && result.state !== 'testing') text += `・${(result.ms / 1000).toFixed(1)}秒`;
      status.textContent = text;
      row.append(name, status);
      return row;
    }));
  }

  const button = document.getElementById('providerTestButton');
  const list = document.getElementById('providerTestResults');
  if (!button || !list) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const rows = [{label: 'YouTube Music（再生中の曲）', result: {state: 'testing'}}, ...PROBES.map(probe => ({label: probe.label, result: {state: 'testing'}}))];
    render(list, rows);
    const update = (index, result) => { rows[index].result = result; render(list, rows); };
    await Promise.all([
      runYouTubeMusicProbe().then(result => update(0, result)),
      ...PROBES.map((probe, index) => runProbe(probe).then(result => update(index + 1, result))),
    ]);
    button.disabled = false;
  });
})();
