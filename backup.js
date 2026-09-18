const exportButton = document.getElementById("exportButton");
const importButton = document.getElementById("importButton");
const importFile = document.getElementById("importFile");
const statusEl = document.getElementById("status");

const BACKUP_FORMAT = "ytm-lyrics-sync-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const SYNC_KEYS = [
  "enabled",
  "fontSize",
  "focusFade",
  "trackingEnabled",
  "autoLyricsOnIdle",
  "wordTrackingStyle",
  "providerOrder",
  "providerEnabled",
  "uiVersion",
];
const LOCAL_KEYS = [
  "ytmlsTrackTimingOffsetsV174",
  "ytmlsManualSearchOverridesV190",
  "ytmlsLyricsEditsV199",
  "ytmlsPinnedLyricsV200",
  "ytmlsLocalLyricsV200",
];

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (data) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(data || {});
    });
  });
}

function storageSet(area, data) {
  return new Promise((resolve, reject) => {
    area.set(data, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function selectKeys(value, allowedKeys) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]])
  );
}

function showStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

function setBusy(busy) {
  managerBusy = busy;
  exportButton.disabled = busy;
  importButton.disabled = busy;
  document.getElementById("deleteTracks").disabled = busy || selectedTracks.size === 0;
  document.getElementById("refreshTracks").disabled = busy;
  document.getElementById("trackFilter").disabled = busy;
  document.querySelectorAll("#savedTracks input").forEach(input => { input.disabled = busy; });
}

exportButton.addEventListener("click", async () => {
  const exportStartedAt = Date.now();
  setBusy(true);
  showStatus("バックアップを作成しています…");
  try {
    const [syncData, localData] = await Promise.all([
      storageGet(chrome.storage.sync, SYNC_KEYS),
      storageGet(chrome.storage.local, LOCAL_KEYS),
    ]);
    const backup = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      sync: selectKeys(syncData, SYNC_KEYS),
      local: selectKeys(localData, LOCAL_KEYS),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const day = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `ytm-lyrics-sync-backup-${day}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Download initiation is not proof that the user retained the file.
    if (window.confirm("バックアップファイルが保存されたことを確認できましたか？\n確認できた場合、バックアップ通知の件数をリセットします。")) {
      await storageSet(chrome.storage.local, { ytmlsBackupExportStartedAt: exportStartedAt });
    }
    showStatus("バックアップのダウンロードを開始しました。保存先をご確認ください。", "success");
  } catch (error) {
    showStatus(`書き出しに失敗しました: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
});

importButton.addEventListener("click", () => {
  importFile.value = "";
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    showStatus("バックアップファイルが大きすぎます。", "error");
    return;
  }

  setBusy(true);
  showStatus("バックアップを確認しています…");
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.format !== BACKUP_FORMAT || backup.formatVersion !== BACKUP_VERSION) {
      throw new Error("この拡張機能のバックアップファイルではありません");
    }
    const syncData = selectKeys(backup.sync, SYNC_KEYS);
    const localData = selectKeys(backup.local, LOCAL_KEYS);
    if (!Object.keys(syncData).length && !Object.keys(localData).length) {
      throw new Error("復元できる設定が含まれていません");
    }
    if (!window.confirm("現在の設定と保存済み歌詞データをバックアップの内容で上書きします。復元しますか？")) {
      showStatus("復元をキャンセルしました。");
      return;
    }
    await Promise.all([
      Object.keys(syncData).length ? storageSet(chrome.storage.sync, syncData) : Promise.resolve(),
      Object.keys(localData).length ? mutateData({ action: "restore", data: localData }) : Promise.resolve(),
    ]);
    await refreshSavedTracks();
    showStatus("復元しました。YouTube Musicのタブを再読み込みしてください。", "success");
  } catch (error) {
    showStatus(`復元に失敗しました: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
});
