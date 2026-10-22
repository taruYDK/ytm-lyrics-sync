// A reminder, not an automatic download. Count distinct saved tracks, not slider events.
const BACKUP_REMINDER_KEYS = ['ytmlsTrackTimingOffsetsV174','ytmlsManualSearchOverridesV190','ytmlsLyricsEditsV199','ytmlsPinnedLyricsV200','ytmlsLocalLyricsV200', 'ytmlsManualReadingsV256','ytmlsTrackDisplayV280'];
function countUnbackedTracks(data, since) {
  const ids = new Set();
  for (const key of BACKUP_REMINDER_KEYS) for (const [id, entry] of Object.entries(data[key] || {})) {
    const times = [entry?.updatedAt, ...Object.values(entry?.candidates || {}).map(candidate => candidate?.updatedAt)];
    if (!since || times.some(time => Number(time) > since)) ids.add(id);
  }
  return ids.size;
}
function normalizedBackupReminderThreshold(value) {
  return Number.isInteger(value)&&value>=1&&value<=1000?value:20;
}
let backupReminderRevision=0;
function refreshBackupReminder() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  const revision=++backupReminderRevision;
  chrome.storage.local.get([...BACKUP_REMINDER_KEYS, 'ytmlsBackupExportStartedAt'], data => {
    if (chrome.runtime.lastError || revision!==backupReminderRevision) return;
    const count = countUnbackedTracks(data, Number(data.ytmlsBackupExportStartedAt || 0));
    chrome.storage.sync.get({backupReminderThreshold:20}, settings => {
      if(chrome.runtime.lastError || revision!==backupReminderRevision)return;
      const threshold=normalizedBackupReminderThreshold(settings.backupReminderThreshold);
      el.hidden=count<threshold;
      el.textContent=`前回の書き出し以降に保存・更新された曲が${count}曲あります。バックアップを保存してください。`;
    });
  });
}
function initBackupReminderThreshold() {
  const input=document.getElementById('backupReminderThreshold');
  const status=document.getElementById('backupReminderSettingsStatus');
  if(!input||!status)return;
  let saved=20;
  chrome.storage.sync.get({backupReminderThreshold:20},settings=>{
    if(chrome.runtime.lastError){status.textContent='通知設定を読み込めませんでした。開き直してください。';return;}
    saved=normalizedBackupReminderThreshold(settings.backupReminderThreshold);input.value=String(saved);input.disabled=false;
  });
  input.addEventListener('change',()=>{
    const value=Number(input.value);
    if(!input.value||!Number.isInteger(value)||value<1||value>1000){status.textContent='1〜1000曲の整数で入力してください。';input.value=String(saved);return;}
    input.disabled=true;status.textContent='保存中…';
    chrome.storage.sync.set({backupReminderThreshold:value},()=>{
      input.disabled=false;
      if(chrome.runtime.lastError){input.value=String(saved);status.textContent='保存できませんでした。もう一度お試しください。';return;}
      saved=value;status.textContent=`${value}曲で通知します（自動保存）`;refreshBackupReminder();
    });
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if(area==='local'||(area==='sync'&&changes.backupReminderThreshold))refreshBackupReminder();
});
initBackupReminderThreshold();

refreshBackupReminder();

chrome.runtime.sendMessage({type:'YTMLS_USER_DATA',action:'migrateReadings'}, () => { if (!chrome.runtime.lastError) refreshBackupReminder(); });
