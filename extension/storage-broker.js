// All user-data mutations run in one service-worker queue, including other tabs.
const USER_DATA_KEYS = [
  'ytmlsTrackTimingOffsetsV174', 'ytmlsManualSearchOverridesV190',
  'ytmlsLyricsEditsV199', 'ytmlsPinnedLyricsV200', 'ytmlsLocalLyricsV200', 'ytmlsManualReadingsV256',
];
let userDataQueue = Promise.resolve();
const userUndo = new Map();
let undoSequence = 0;
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
  if (message.action === 'undo') {
    const item = userUndo.get(message.token);
    if (!item || Date.now() > item.expires) throw new Error('取り消しの有効期限が切れました。');
    const data = await localDataCall('get', [item.key]);
    const map = {...(data[item.key] || {})};
    if (JSON.stringify(map[item.id] ?? null) !== item.after) throw new Error('保存後に変更されています。上書きを防ぐため取り消せません。');
    if (item.before == null) delete map[item.id]; else map[item.id] = item.before;
    await localDataCall('set', {[item.key]:map});
    userUndo.delete(message.token);
    return {ok:true,data:{[item.key]:map}};
  }
  if (message.action === 'readReadings') {
    await mutateUserData({action:'migrateReadings'});
    const data = await localDataCall('get', ['ytmlsManualReadingsV256']);
    return {ok:true,data:{entries:data.ytmlsManualReadingsV256?.[String(message.videoId || '')]?.entries || []}};
  }
  if (message.action === 'migrateReadings') {
    const marker = await localDataCall('get', ['ytmlsReadingsMigratedV262']);
    if (marker.ytmlsReadingsMigratedV262 === true) return {ok:true,data:{}};
    const all = await localDataCall('get', null);
    const key = 'ytmlsManualReadingsV256', map = {...(all[key] || {})};
    const oldKeys = Object.keys(all).filter(k => k.startsWith('ytmls_manual_readings_') && Array.isArray(all[k]));
    for (const old of oldKeys) {
      const id = old.slice('ytmls_manual_readings_'.length);
      if (!id || ['__proto__','constructor','prototype'].includes(id)) continue;
      if (!Object.prototype.hasOwnProperty.call(map,id) && all[old].length) map[id] = {entries:all[old],updatedAt:Date.now()};
    }
    if (oldKeys.length) {
      YTMLSBackupValidation.local({[key]:map});
      await localDataCall('set', {[key]:map});
      await localDataCall('remove', oldKeys);
    }
    await localDataCall('set', {ytmlsReadingsMigratedV262:true});
    return {ok:true,data:{}};
  }
  const keys = message.action === 'entry'
    ? (message.key === 'ytmlsLocalLyricsV200' ? [message.key, 'ytmlsLyricsEditsV199'] : USER_DATA_KEYS.filter(key => key === message.key))
    : message.action === 'nudgeTiming' ? ['ytmlsTrackTimingOffsetsV174']
    : message.action === 'edit' ? ['ytmlsLyricsEditsV199']
    : message.action === 'deleteLocal' ? USER_DATA_KEYS.slice(2)
    : message.action === 'restore' ? [] : USER_DATA_KEYS;
  const data = keys.length ? await localDataCall('get', keys) : {};
  const next = Object.fromEntries(USER_DATA_KEYS.map(key => [key, isMap(data[key]) ? { ...data[key] } : {}]));
  const changed = {};
  const undoKey = message.action === 'edit' ? 'ytmlsLyricsEditsV199'
    : message.action === 'nudgeTiming' ? 'ytmlsTrackTimingOffsetsV174'
    : message.action === 'entry' && ['ytmlsTrackTimingOffsetsV174','ytmlsManualReadingsV256'].includes(message.key) ? message.key : null;
  const before = undoKey ? JSON.parse(JSON.stringify(data[undoKey]?.[String(message.videoId || '')] ?? null)) : null;
  const id = String(message.videoId || '');
  const safeId = id && !['__proto__', 'prototype', 'constructor'].includes(id);
  if (message.action === 'nudgeTiming' && safeId) {
    if (![100, -100].includes(message.deltaMs)) throw new Error('補正量が不正です。');
    const key = 'ytmlsTrackTimingOffsetsV174';
    const entry = next[key][id];
    const clamp = value => Math.max(-20000, Math.min(20000, Math.round((Number(value) || 0) / 100) * 100));
    const byPosition = new Map();
    for (const point of (Array.isArray(entry?.points) ? entry.points : [])) {
      const raw = Number(point && (point.position ?? point.progress ?? point.ratio));
      if (!Number.isFinite(raw)) continue;
      const position = Math.max(0, Math.min(1, raw));
      if (position >= 1) continue;
      byPosition.set(Math.round(position * 1000000), { position, offsetMs: clamp(point?.offsetMs) });
    }
    const points = [...byPosition.values()].sort((a,b) => a.position - b.position);
    if (!points.length) points.push({ position: 0, offsetMs: clamp(isMap(entry) ? entry.offsetMs : entry) });
    if (points[0].position > 0) points.unshift({ position: 0, offsetMs: points[0].offsetMs });
    const offsets = points.map(point => point.offsetMs);
    const delta = Math.max(-20000 - Math.min(...offsets), Math.min(20000 - Math.max(...offsets), message.deltaMs));
    if (!delta) return { ok: true, data: { [key]: next[key] } };
    for (const point of points) point.offsetMs += delta;
    if (points.length === 1 && points[0].offsetMs === 0) delete next[key][id];
    else next[key][id] = {
      ...(isMap(entry) ? entry : {}), points, offsetMs: points[0].offsetMs,
      endOffsetMs: points[points.length - 1].offsetMs,
      title: String(message.title || entry?.title || ''), artist: String(message.artist || entry?.artist || ''), updatedAt: Date.now(),
    };
    changed[key] = next[key];
  } else if (message.action === 'restore') {
    YTMLSBackupValidation.local(message.data);
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
    if (message.key === 'ytmlsManualReadingsV256' && message.entry != null) YTMLSBackupValidation.local({[message.key]:{[id]:message.entry}});
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
  let undoToken;
  if (undoKey && message.captureUndo && JSON.stringify(before) !== JSON.stringify(changed[undoKey]?.[id] ?? null)) {
    for (const [token,item] of userUndo) if (Date.now() > item.expires) userUndo.delete(token);
    while (userUndo.size >= 30) userUndo.delete(userUndo.keys().next().value);
    undoToken = String(++undoSequence) + ':' + Date.now();
    userUndo.set(undoToken, {key:undoKey,id,before,after:JSON.stringify(changed[undoKey]?.[id] ?? null),expires:Date.now()+60000});
  }
  return { ok: true, data: changed, undoToken };
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
