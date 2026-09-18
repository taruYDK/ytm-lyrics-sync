let managerBusy = false;
let savedTracks = [];
let displayedLimit = 50;
const selectedTracks = new Set();
const TYPE_LABELS = ["補正", "手動検索", "歌詞編集", "固定歌詞", "ローカル歌詞"];
async function mutateData(payload) {
  const response = await chrome.runtime.sendMessage({ type: "YTMLS_USER_DATA", ...payload });
  if (!response?.ok) throw new Error(response?.error || "保存処理に失敗しました。");
  return response.data;
}
function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
async function refreshSavedTracks() {
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
  document.getElementById("selectionCount").textContent = `${selectedTracks.size}曲選択`;
  document.getElementById("deleteTracks").disabled = managerBusy || selectedTracks.size === 0;
}
function renderSavedTracks() {
  const query = document.getElementById("trackFilter").value.trim().toLocaleLowerCase();
  const mode = document.getElementById("trackView").value;
  const visible = savedTracks.filter(track => (mode !== 'pinned' || track.pinned) && `${track.title} ${track.artist} ${track.id}`.toLocaleLowerCase().includes(query));
  if (mode !== 'name') visible.sort((a,b) => b.updatedAt - a.updatedAt);
  const fragment = document.createDocumentFragment();
  for (const track of visible.slice(0, displayedLimit)) {
    const label = document.createElement("div");
    label.className = "saved-track";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute('aria-label', `${track.title || track.id}を削除対象に選択`);
    checkbox.checked = selectedTracks.has(track.id);
    checkbox.disabled = managerBusy;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTracks.add(track.id); else selectedTracks.delete(track.id);
      updateSelectionCount();
    });
    const text = document.createElement("span");
    text.textContent = `${track.title || "曲名未保存"}${track.artist ? " — " + track.artist : ""}`;
    const details = document.createElement("small");
    details.textContent = `${track.id} / ${track.types.join("・")} / 約${formatBytes(track.bytes)}`;
    text.appendChild(details);
    const open = document.createElement('a');
    open.href = `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`;
    open.target = '_blank'; open.rel = 'noopener'; open.textContent = '曲を開く';
    open.style.cssText = 'color:#a9d7ff;white-space:nowrap;margin-left:auto';
    if (track.updatedAt) details.append(` / 更新 ${new Date(track.updatedAt).toLocaleDateString('ja-JP')}`);
    label.append(checkbox, text);
    label.append(open);
    fragment.appendChild(label);
  }
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.textContent = "該当する保存データはありません。";
    fragment.appendChild(empty);
  }
  document.getElementById("savedTracks").replaceChildren(fragment);
  document.getElementById("loadMoreTracks").hidden = visible.length <= displayedLimit;
  updateSelectionCount();
}
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
  if (!window.confirm(`${ids.length}曲の保存データを本当に削除しますか？\n${names}\n補正・編集・固定歌詞・ローカル歌詞・手動検索条件を削除します。元に戻すにはバックアップが必要です。`)) return;
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
