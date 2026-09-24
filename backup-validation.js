// Shared by the backup page and the service worker. Validation never changes input.
globalThis.YTMLSBackupValidation = (() => {
  const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fail = path => { throw new Error(`バックアップの形式が不正です: ${path}`); };
  const requireValue = (valid, path) => { if (!valid) fail(path); };
  function safeTree(value, path, depth = 0) {
    requireValue(depth <= 40, path);
    if (typeof value === 'number') requireValue(finite(value), path);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      requireValue(!['__proto__', 'constructor', 'prototype'].includes(key), path + '.' + key);
      safeTree(child, path + '.' + key, depth + 1);
    }
  }
  function metadata(entry, path) {
    for (const key of ['title','artist','source']) if (key in entry) requireValue(typeof entry[key] === 'string', path + '.' + key);
    if ('updatedAt' in entry) requireValue(finite(entry.updatedAt) && entry.updatedAt >= 0, path + '.updatedAt');
  }
  function timing(value, path) {
    const offset = v => finite(v) && Math.abs(v) <= 20000;
    if (finite(value)) { requireValue(offset(value),path); return; } // Legacy scalar offsets.
    requireValue(map(value),path); metadata(value,path);
    for (const key of ['offsetMs','endOffsetMs']) if (key in value) requireValue(offset(value[key]),path+'.'+key);
    if ('points' in value) {
      requireValue(Array.isArray(value.points) && value.points.length > 0,path+'.points');
      for (const point of value.points) requireValue(map(point) && finite(point.position ?? point.progress ?? point.ratio) &&
        (point.position ?? point.progress ?? point.ratio) >= 0 && (point.position ?? point.progress ?? point.ratio) <= 1 && offset(point.offsetMs),path+'.points');
    } else requireValue('offsetMs' in value,path+'.offsetMs');
  }
  function result(value, path) {
    requireValue(map(value) && Array.isArray(value.lines) && value.lines.length > 0,path);
    const time = v => v == null || (finite(v) && v >= 0);
    for (const line of value.lines) {
      requireValue(map(line) && time(line.time) && time(line.end) && typeof line.text === 'string',path+'.lines');
      if ('words' in line) {
        requireValue(Array.isArray(line.words),path+'.words');
        for (const word of line.words) requireValue(map(word) && typeof word.text === 'string' && finite(word.time) && word.time >= 0 && time(word.end),path+'.words');
      }
    }
    requireValue(value.lines.some(line => finite(line.time)),path+'.lines.time');
    if ('syncLevel' in value) requireValue(['none','line','word','syllable'].includes(value.syncLevel),path+'.syncLevel');
  }
  function local(data) {
    requireValue(map(data),'local');safeTree(data,'local');
    for (const [key, tracks] of Object.entries(data)) {
      requireValue(map(tracks),key);
      for (const [id, entry] of Object.entries(tracks)) {
        const path=key+'.'+id; requireValue(id.length > 0,path);
        if (key === 'ytmlsTrackTimingOffsetsV174') { timing(entry,path); continue; }
        requireValue(map(entry),path);metadata(entry,path);
        if (key === 'ytmlsManualSearchOverridesV190') requireValue(typeof entry.title === 'string' && typeof entry.artist === 'string',path);
        else if (key === 'ytmlsLocalLyricsV200') requireValue(typeof entry.rawLrc === 'string' && entry.rawLrc.length <= 500000 && /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(entry.rawLrc),path+'.rawLrc');
        else if (key === 'ytmlsManualReadingsV256') {
          requireValue(Array.isArray(entry.entries) && entry.entries.length <= 2000,path+'.entries');
          for (const r of entry.entries) {
            requireValue(map(r) && typeof r.text === 'string' && r.text.length <= 4000 && typeof r.reading === 'string' && r.reading.length <= 1000 && Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= r.text.length,path+'.entries');
            for (const field of ['lineIndex','occurrence']) if (field in r) requireValue(Number.isInteger(r[field]) && r[field] >= 0,path+'.'+field);
          }
        }
        else if (key === 'ytmlsPinnedLyricsV200') {
          requireValue(typeof entry.candidateId === 'string' && entry.candidateId.length > 0,path+'.candidateId');result(entry.result,path+'.result');
        } else if (key === 'ytmlsLyricsEditsV199') {
          requireValue(map(entry.candidates),path+'.candidates');
          for (const [id, edit] of Object.entries(entry.candidates)) {
            requireValue(id.length > 0 && map(edit) && map(edit.replacements) && Number.isInteger(edit.originalLineCount) && edit.originalLineCount >= 0,path+'.candidates');
            metadata(edit,path+'.candidates.'+id);
            for (const [index, text] of Object.entries(edit.replacements)) requireValue(/^(0|[1-9]\d*)$/.test(index) && Number(index) < edit.originalLineCount && typeof text === 'string',path+'.replacements');
          }
        } else fail(key);
      }
    }
  }
  function sync(data) {
    requireValue(map(data),'sync');safeTree(data,'sync');
    for (const key of ['enabled','focusFade','trackingEnabled','autoLyricsOnIdle','readingJapanese','readingEnglish']) if (key in data) requireValue(typeof data[key] === 'boolean',key);
    const ranges={fontSize:[10,100],trackingPosition:[25,65],manualScrollReturnMs:[1000,10000],uiVersion:[0,100000]};
    for (const [key,[min,max]] of Object.entries(ranges)) if (key in data) requireValue(finite(data[key]) && data[key]>=min && data[key]<=max,key);
    if ('wordTrackingStyle' in data) requireValue(['smooth','silky'].includes(data.wordTrackingStyle),'wordTrackingStyle');
    const providers=['betterLyrics','lrclib','unison','binilyrics','karalyr'];
    if ('providerOrder' in data) requireValue(Array.isArray(data.providerOrder) && data.providerOrder.every(key=>providers.includes(key)),'providerOrder');
    if ('providerEnabled' in data) requireValue(map(data.providerEnabled) && Object.entries(data.providerEnabled).every(([key,value])=>providers.includes(key) && typeof value==='boolean'),'providerEnabled');
  }
  return {local,sync};
})();
