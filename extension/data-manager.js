let managerBusy = false;
let savedTracks = [];
let displayedLimit = 50;
const selectedTracks = new Set();
const TYPE_LABELS = ["補正", "手動検索", "歌詞編集", "固定歌詞", "ローカル歌詞", "手動ふりがな", "曲別表示設定", "旧版のしおり"];
async function mutateData(payload) {
  const response = await chrome.runtime.sendMessage({ type: "YTMLS_USER_DATA", ...payload });
  if (!response?.ok) throw new Error(response?.error || "保存処理に失敗しました。");
  return response.data;
}
function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
async function refreshSavedTracks() {
  await mutateData({action:"migrateReadings"});
  const data = await storageGet(chrome.storage.local, LOCAL_KEYS);
  const tracks = new Map();
  LOCAL_KEYS.forEach((key, index) => {
    const map = data[key];
    if (!map || typeof map !== "object" || Array.isArray(map)) return;
    for (const [id, entry] of Object.entries(map)) {
      if (!entry) continue;
      const record = tracks.get(id) || { id, title: "", artist: "", types: [], bytes: 0, updatedAt: 0, pinned: false };
      const metadata = entry.title ? entry : Object.values(entry.candidates || {}).find(value => value?.title) || entry;
      record.title ||= metadata.title || "";
      record.artist ||= metadata.artist || "";
      record.updatedAt = Math.max(record.updatedAt, Number(entry.updatedAt || metadata.updatedAt || 0));
      record.pinned ||= key === "ytmlsPinnedLyricsV200";
      record.types.push(TYPE_LABELS[index]);
      record.bytes += new Blob([JSON.stringify({ [id]: entry })]).size;
      tracks.set(id, record);
    }
  });
  savedTracks = [...tracks.values()].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, "ja"));
  for (const id of selectedTracks) if (!tracks.has(id)) selectedTracks.delete(id);
  const sizes = await Promise.all([LOCAL_KEYS, null].map(keys => new Promise((resolve, reject) => {
    chrome.storage.local.getBytesInUse(keys, bytes => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(bytes);
    });
  })));
  document.getElementById("storageUsage").textContent = `保存済み ${savedTracks.length}曲 / ユーザーデータ ${formatBytes(sizes[0])} / ローカル保存全体 ${formatBytes(sizes[1])}（キャッシュ等を含む）`;
  renderSavedTracks();
}
function updateSelectionCount() {
  const text = `${selectedTracks.size}曲選択`;
  document.getElementById("selectionCount").textContent = text;
  document.getElementById("listSelectionCount").textContent = selectedTracks.size ? `${text}中` : "";
  document.getElementById("deleteTracks").disabled = managerBusy || selectedTracks.size === 0;
  const all = document.getElementById("selectAllTracks");
  const selectedVisible = visibleTrackIds.filter(id => selectedTracks.has(id)).length;
  all.checked = visibleTrackIds.length > 0 && selectedVisible === visibleTrackIds.length;
  all.indeterminate = selectedVisible > 0 && selectedVisible < visibleTrackIds.length;
  all.disabled = managerBusy || visibleTrackIds.length === 0;
}
let visibleTrackIds = [];
function shortDate(time) {
  const date = new Date(time);
  return date.getFullYear() === new Date().getFullYear()
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : date.toLocaleDateString('ja-JP');
}
function renderSavedTracks() {
  const query = document.getElementById("trackFilter").value.trim().toLocaleLowerCase();
  const mode = document.getElementById("trackView").value;
  const visible = savedTracks.filter(track => (mode !== 'pinned' || track.pinned) && `${track.title} ${track.artist} ${track.id}`.toLocaleLowerCase().includes(query));
  if (mode !== 'name') visible.sort((a,b) => b.updatedAt - a.updatedAt);
  const shown = visible.slice(0, displayedLimit);
  visibleTrackIds = shown.map(track => track.id);
  const fragment = document.createDocumentFragment();
  for (const track of shown) {
    // The whole row is the checkbox label, so clicking anywhere on it selects the track.
    const row = document.createElement("label");
    row.className = "saved-track";
    row.dataset.selected = String(selectedTracks.has(track.id));
    row.title = `曲ID：${track.id}／約${formatBytes(track.bytes)}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute('aria-label', `${track.title || track.id}を削除対象に選択`);
    checkbox.checked = selectedTracks.has(track.id);
    checkbox.disabled = managerBusy;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTracks.add(track.id); else selectedTracks.delete(track.id);
      row.dataset.selected = String(checkbox.checked);
      updateSelectionCount();
    });
    const main = document.createElement("span");
    main.className = "track-main";
    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = track.title || "曲名未保存";
    const artist = document.createElement("span");
    artist.className = "track-artist";
    artist.textContent = track.artist || track.id;
    const tags = document.createElement("span");
    tags.className = "track-tags";
    if (track.pinned) {
      const favorite = document.createElement("span");
      favorite.className = "track-tag favorite";
      favorite.textContent = "★ お気に入り";
      tags.appendChild(favorite);
    }
    for (const type of track.types.filter(type => type !== "固定歌詞")) {
      const tag = document.createElement("span");
      tag.className = "track-tag";
      tag.textContent = type;
      tags.appendChild(tag);
    }
    main.append(title, artist, tags);
    const side = document.createElement("span");
    side.className = "track-side";
    if (track.updatedAt) {
      const date = document.createElement("time");
      date.className = "track-date";
      date.dateTime = new Date(track.updatedAt).toISOString();
      date.textContent = shortDate(track.updatedAt);
      date.title = `更新 ${new Date(track.updatedAt).toLocaleString('ja-JP')}`;
      side.appendChild(date);
    }
    const open = document.createElement('a');
    open.className = 'track-open';
    open.href = `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`;
    open.target = '_blank'; open.rel = 'noopener'; open.textContent = '開く ↗';
    open.setAttribute('aria-label', `${track.title || track.id}をYouTube Musicで開く`);
    side.appendChild(open);
    row.append(checkbox, main, side);
    fragment.appendChild(row);
  }
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "saved-empty";
    empty.textContent = query ? "検索に一致する曲はありません。" : "保存した曲はまだありません。";
    fragment.appendChild(empty);
  }
  document.getElementById("savedTracks").replaceChildren(fragment);
  document.getElementById("visibleTrackCount").textContent = visible.length > shown.length ? `${shown.length} / ${visible.length}曲を表示` : `${visible.length}曲`;
  document.getElementById("loadMoreTracks").hidden = visible.length <= displayedLimit;
  updateSelectionCount();
}
document.getElementById("selectAllTracks").addEventListener("change", event => {
  for (const id of visibleTrackIds) {
    if (event.target.checked) selectedTracks.add(id); else selectedTracks.delete(id);
  }
  renderSavedTracks();
});
document.getElementById("trackFilter").addEventListener("input", () => {
  selectedTracks.clear();
  displayedLimit = 50;
  renderSavedTracks();
});
document.getElementById('trackView').addEventListener('change', () => { selectedTracks.clear(); displayedLimit = 50; renderSavedTracks(); });
document.getElementById("loadMoreTracks").addEventListener("click", () => { displayedLimit += 50; renderSavedTracks(); });
document.getElementById("refreshTracks").addEventListener("click", async () => {
  setBusy(true);
  try { await refreshSavedTracks(); } catch (error) { showStatus(error.message, "error"); }
  finally { setBusy(false); }
});
document.getElementById("deleteTracks").addEventListener("click", async () => {
  if (managerBusy || !selectedTracks.size) return;
  const ids = [...selectedTracks];
  const names = savedTracks.filter(track => selectedTracks.has(track.id)).slice(0, 5).map(track => track.title || track.id).join("\n");
  if (!window.confirm(`${ids.length}曲の保存データを本当に削除しますか？\n${names}\n補正・編集・固定歌詞・ローカル歌詞・手動検索条件・手動ふりがな・曲別表示設定・旧版のしおりを削除します。元に戻すにはバックアップが必要です。`)) return;
  setBusy(true);
  try {
    await mutateData({ action: "deleteTracks", videoIds: ids });
    selectedTracks.clear();
    await refreshSavedTracks();
    showStatus(`${ids.length}曲の保存データを削除しました。YouTube Musicを再読み込みしてください。バックアップがあれば復元できます。`, "success");
  } catch (error) { showStatus(`削除処理を確認できませんでした: ${error.message} 一覧を更新して確認してください。`, "error"); }
  finally { setBusy(false); }
});
refreshSavedTracks().catch(error => showStatus(`一覧を取得できませんでした: ${error.message}`, "error"));
