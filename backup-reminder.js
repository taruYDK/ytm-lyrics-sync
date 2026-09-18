// A reminder, not an automatic download. Count distinct saved tracks, not slider events.
const BACKUP_REMINDER_KEYS = ['ytmlsTrackTimingOffsetsV174','ytmlsManualSearchOverridesV190','ytmlsLyricsEditsV199','ytmlsPinnedLyricsV200','ytmlsLocalLyricsV200'];
function countUnbackedTracks(data, since) {
  const ids = new Set();
  for (const key of BACKUP_REMINDER_KEYS) for (const [id, entry] of Object.entries(data[key] || {})) {
    const times = [entry?.updatedAt, ...Object.values(entry?.candidates || {}).map(candidate => candidate?.updatedAt)];
    if (!since || times.some(time => Number(time) > since)) ids.add(id);
  }
  return ids.size;
}
function refreshBackupReminder() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  chrome.storage.local.get([...BACKUP_REMINDER_KEYS, 'ytmlsBackupExportStartedAt'], data => {
    if (chrome.runtime.lastError) return;
    const count = countUnbackedTracks(data, Number(data.ytmlsBackupExportStartedAt || 0));
    el.hidden = count < 20;
    el.textContent = `前回の書き出し以降に保存・更新された曲が${count}曲あります。バックアップを保存してください。`;
  });
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') refreshBackupReminder(); });
refreshBackupReminder();
