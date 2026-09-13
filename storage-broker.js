// All user-data mutations run in one service-worker queue, including other tabs.
const USER_DATA_KEYS = [
  'ytmlsTrackTimingOffsetsV174', 'ytmlsManualSearchOverridesV190',
  'ytmlsLyricsEditsV199', 'ytmlsPinnedLyricsV200', 'ytmlsLocalLyricsV200',
];
let userDataQueue = Promise.resolve();
const isMap = value => value && typeof value === 'object' && !Array.isArray(value);
function localDataCall(method, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local[method](value, result => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}
async function mutateUserData(message) {
  const keys = message.action === 'entry'
    ? (message.key === 'ytmlsLocalLyricsV200' ? [message.key, 'ytmlsLyricsEditsV199'] : USER_DATA_KEYS.filter(key => key === message.key))
    : message.action === 'edit' ? ['ytmlsLyricsEditsV199']
    : message.action === 'deleteLocal' ? USER_DATA_KEYS.slice(2)
    : message.action === 'restore' ? [] : USER_DATA_KEYS;
  const data = keys.length ? await localDataCall('get', keys) : {};
  const next = Object.fromEntries(USER_DATA_KEYS.map(key => [key, isMap(data[key]) ? { ...data[key] } : {}]));
  const changed = {};
  const id = String(message.videoId || '');
  const safeId = id && !['__proto__', 'prototype', 'constructor'].includes(id);
  if (message.action === 'restore') {
    for (const key of USER_DATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(message.data || {}, key)) {
        if (!isMap(message.data[key])) throw new Error('保存データの形式が不正です。');
        changed[key] = message.data[key];
      }
    }
  } else if (message.action === 'deleteTracks') {
    if (!Array.isArray(message.videoIds) || !message.videoIds.every(v => typeof v === 'string')) throw new Error('曲IDが不正です。');
    for (const key of USER_DATA_KEYS) {
      for (const trackId of message.videoIds) delete next[key][trackId];
      changed[key] = next[key];
    }
  } else if (message.action === 'deleteLocal' && safeId) {
    delete next.ytmlsLocalLyricsV200[id];
    if (next.ytmlsPinnedLyricsV200[id]?.candidateId === `local::${id}`) delete next.ytmlsPinnedLyricsV200[id];
    const track = next.ytmlsLyricsEditsV199[id];
    if (track?.candidates) {
      delete track.candidates[`local::${id}`];
      if (!Object.keys(track.candidates).length) delete next.ytmlsLyricsEditsV199[id];
    }
    for (const key of USER_DATA_KEYS.slice(2)) changed[key] = next[key];
  } else if (message.action === 'entry' && safeId && USER_DATA_KEYS.includes(message.key)) {
    if (message.entry == null) delete next[message.key][id];
    else {
      if (!isMap(message.entry)) throw new Error('保存データの形式が不正です。');
      next[message.key][id] = message.entry;
    }
    changed[message.key] = next[message.key];
    if (message.key === 'ytmlsLocalLyricsV200' && message.entry != null) {
      const track = next.ytmlsLyricsEditsV199[id];
      if (track?.candidates) {
        delete track.candidates[`local::${id}`];
        if (!Object.keys(track.candidates).length) delete next.ytmlsLyricsEditsV199[id];
        changed.ytmlsLyricsEditsV199 = next.ytmlsLyricsEditsV199;
      }
    }
  } else if (message.action === 'edit' && safeId) {
    const candidateId = String(message.candidateId || '');
    if (!candidateId || ['__proto__', 'prototype', 'constructor'].includes(candidateId)) throw new Error('候補IDが不正です。');
    const track = next.ytmlsLyricsEditsV199[id] || { candidates: {} };
    track.candidates = isMap(track.candidates) ? { ...track.candidates } : {};
    if (message.entry == null) delete track.candidates[candidateId];
    else track.candidates[candidateId] = message.entry;
    track.updatedAt = Date.now();
    if (Object.keys(track.candidates).length) next.ytmlsLyricsEditsV199[id] = track;
    else delete next.ytmlsLyricsEditsV199[id];
    changed.ytmlsLyricsEditsV199 = next.ytmlsLyricsEditsV199;
  } else throw new Error('未対応の保存操作です。');
  await localDataCall('set', changed);
  return { ok: true, data: changed };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'YTMLS_USER_DATA') return;
  if (sender.id !== chrome.runtime.id) { respond({ ok: false, error: '許可されていない送信元です。' }); return; }
  const operation = userDataQueue.then(() => mutateUserData(message));
  // One failed operation must not poison subsequent saves.
  userDataQueue = operation.catch(() => {});
  operation.then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
