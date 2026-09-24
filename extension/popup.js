const enabledToggle = document.getElementById("enabledToggle");
const fontSizeSelect = document.getElementById("fontSizeSelect");
const focusFadeToggle = document.getElementById("focusFadeToggle");
const trackingToggle = document.getElementById("trackingToggle");
const autoLyricsOnIdleToggle = document.getElementById("autoLyricsOnIdleToggle");
const wordTrackingStyleSelect = document.getElementById("wordTrackingStyleSelect");
const trackingPosition = document.getElementById("trackingPosition");
const manualScrollReturnMs = document.getElementById("manualScrollReturnMs");
const noticeTimers = new Map();
function showPopupNotice(element, message, transient = true) {
  clearTimeout(noticeTimers.get(element));
  element.textContent = message;
  if (transient) noticeTimers.set(element, setTimeout(() => {
    element.textContent = "";
    noticeTimers.delete(element);
  }, 2200));
}
function selectRestoredValue(select, value, fallback, min, max, label) {
  const actual = Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  if (!Array.from(select.options || []).some(option => Number(option.value) === actual)) {
    const option = document.createElement('option');
    option.value = String(actual); option.textContent = label(actual) + '（復元値）';
    select.appendChild(option);
  }
  select.value = String(actual);
}
function showTrackingPosition() {
  document.getElementById("trackingPositionValue").textContent = "上から" + trackingPosition.value + "%";
}
let trackingSaveTimer = null;
let pendingTrackingSettings = {};
let trackingSaveRevision = 0;
function flushTrackingSettings() {
  if (trackingSaveTimer !== null) clearTimeout(trackingSaveTimer);
  trackingSaveTimer = null;
  if (!Object.keys(pendingTrackingSettings).length) return;
  const values = pendingTrackingSettings;
  pendingTrackingSettings = {};
  const revision = trackingSaveRevision;
  chrome.storage.sync.set(values, () => {
    const error = chrome.runtime.lastError;
    if (revision !== trackingSaveRevision) return;
    showPopupNotice(document.getElementById("trackingSettingsStatus"), error
      ? "保存できませんでした。もう一度お試しください。" : "保存しました", !error);
  });
}
function saveTrackingSetting(key, value) {
  pendingTrackingSettings[key] = value;
  trackingSaveRevision++;
  if (trackingSaveTimer !== null) clearTimeout(trackingSaveTimer);
  showPopupNotice(document.getElementById("trackingSettingsStatus"), "保存待ち…", false);
  trackingSaveTimer = setTimeout(flushTrackingSettings, 500);
}
// Commit a pending edit when the popup loses visibility or closes.
window.addEventListener("pagehide", flushTrackingSettings);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushTrackingSettings();
});
trackingPosition.addEventListener("input", showTrackingPosition);
trackingPosition.addEventListener("change", () => saveTrackingSetting("trackingPosition", Number(trackingPosition.value)));
manualScrollReturnMs.addEventListener("change", () => saveTrackingSetting("manualScrollReturnMs", Number(manualScrollReturnMs.value)));
const readingJapaneseToggle = document.getElementById('readingJapaneseToggle');
const readingEnglishToggle = document.getElementById('readingEnglishToggle');
for (const [control, key] of [[readingJapaneseToggle, 'readingJapanese'], [readingEnglishToggle, 'readingEnglish']]) {
  control.addEventListener('change', () => chrome.storage.sync.set({[key]:control.checked}, () => {
    const error = chrome.runtime.lastError;
    showPopupNotice(document.getElementById('readingSettingsStatus'), error ? '保存できませんでした。もう一度お試しください。' : '保存しました', !error);
  }));
}
const providerList = document.getElementById("providerList");
const providerNote = document.getElementById("providerNote");

const PROVIDERS = [
    { key: "youtubeMusic", label: "YouTube Music（行同期）" },
  { key: "betterLyrics", label: "Better Lyrics" },
  { key: "lrclib", label: "LRCLIB" },
  { key: "unison", label: "Unison" },
  { key: "binilyrics", label: "BiniLyrics" },
  { key: "karalyr", label: "Karalyr" },
];
const DEFAULT_PROVIDER_ORDER = PROVIDERS.map((provider) => provider.key);
let currentProviderOrder = [...DEFAULT_PROVIDER_ORDER];
let currentProviderEnabled = Object.fromEntries(DEFAULT_PROVIDER_ORDER.map((key) => [key, true]));

function normalizeOrder(value) {
  const incoming = Array.isArray(value) ? value.map(String) : [];
  return [...new Set([...incoming, ...DEFAULT_PROVIDER_ORDER])]
    .filter((key) => DEFAULT_PROVIDER_ORDER.includes(key));
}

function normalizeEnabled(value) {
  const raw = value && typeof value === "object" ? value : {};
  const enabled = {};
  for (const key of DEFAULT_PROVIDER_ORDER) enabled[key] = raw[key] !== false;
  if (!Object.values(enabled).some(Boolean)) enabled.lrclib = true;
  return enabled;
}

function saveProviderConfig(message = "設定を保存しました") {
  chrome.storage.sync.set({
    providerOrder: currentProviderOrder,
    providerEnabled: currentProviderEnabled,
    uiVersion: 9,
  }, () => {
    const error = chrome.runtime.lastError;
    showPopupNotice(providerNote, error ? "保存できませんでした。もう一度お試しください。" : message, !error);
  });
}

function renderProviderList() {
  providerList.replaceChildren();

  const localRow = document.createElement("div");
  localRow.className = "provider-row";
  localRow.dataset.fixed = "true";
  localRow.title = "この曲に保存したローカル歌詞は、常にほかの提供元より先に使用されます";

  const localCheckbox = document.createElement("input");
  localCheckbox.type = "checkbox";
  localCheckbox.className = "provider-enabled";
  localCheckbox.checked = true;
  localCheckbox.disabled = true;
  localCheckbox.setAttribute("aria-label", "ローカル歌詞は常に有効です");

  const localRank = document.createElement("span");
  localRank.className = "provider-rank";
  localRank.textContent = "★";

  const localName = document.createElement("span");
  localName.className = "provider-name";
  localName.textContent = "ローカル歌詞 ★最優先";

  const fixedBadge = document.createElement("span");
  fixedBadge.className = "provider-fixed-badge";
  fixedBadge.textContent = "固定";

  localRow.append(localCheckbox, localRank, localName, fixedBadge);
  providerList.appendChild(localRow);

  currentProviderOrder.forEach((key, index) => {
    const provider = PROVIDERS.find((item) => item.key === key);
    if (!provider) return;

    const row = document.createElement("div");
    row.className = "provider-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "provider-enabled";
    checkbox.checked = currentProviderEnabled[key] !== false;
    checkbox.setAttribute("aria-label", `${provider.label}を有効化`);
    checkbox.addEventListener("change", () => {
      const next = { ...currentProviderEnabled, [key]: checkbox.checked };
      if (!Object.values(next).some(Boolean)) {
        checkbox.checked = true;
        showPopupNotice(providerNote, "少なくとも1つの提供元を有効にしてください");
        return;
      }
      currentProviderEnabled = next;
      saveProviderConfig();
    });

    const rank = document.createElement("span");
    rank.className = "provider-rank";
    rank.textContent = String(index + 2);

    const name = document.createElement("span");
    name.className = "provider-name";
    name.textContent = provider.label;

    const controls = document.createElement("div");
    controls.className = "provider-controls";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "provider-move";
    up.textContent = "↑";
    up.title = "優先順位を上げる";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      [currentProviderOrder[index - 1], currentProviderOrder[index]] =
        [currentProviderOrder[index], currentProviderOrder[index - 1]];
      renderProviderList();
      saveProviderConfig();
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "provider-move";
    down.textContent = "↓";
    down.title = "優先順位を下げる";
    down.disabled = index === currentProviderOrder.length - 1;
    down.addEventListener("click", () => {
      [currentProviderOrder[index + 1], currentProviderOrder[index]] =
        [currentProviderOrder[index], currentProviderOrder[index + 1]];
      renderProviderList();
      saveProviderConfig();
    });

    controls.append(up, down);
    row.append(checkbox, rank, name, controls);
    providerList.appendChild(row);
  });
}

chrome.storage.sync.get(
  {
    enabled: true,
    fontSize: 32,
    readingJapanese: true,
    readingEnglish: true,
    focusFade: true,
    trackingPosition: 42,
    manualScrollReturnMs: 3500,
    trackingEnabled: true,
    autoLyricsOnIdle: true,
    wordTrackingStyle: "smooth",
    providerOrder: DEFAULT_PROVIDER_ORDER,
    providerEnabled: currentProviderEnabled,
    uiVersion: 9,
  },
  (data) => {
    trackingPosition.value = Number.isFinite(data.trackingPosition) ? Math.max(25, Math.min(65, data.trackingPosition)) : 42;
    selectRestoredValue(manualScrollReturnMs, data.manualScrollReturnMs, 3500, 1000, 10000, value => `${value / 1000}秒`);
    showTrackingPosition();
    readingJapaneseToggle.checked = data.readingJapanese !== false;
    readingEnglishToggle.checked = data.readingEnglish !== false;
    enabledToggle.checked = data.enabled !== false;
    focusFadeToggle.checked = data.focusFade !== false;
    trackingToggle.checked = data.trackingEnabled !== false;
    autoLyricsOnIdleToggle.checked = data.autoLyricsOnIdle !== false;

    selectRestoredValue(fontSizeSelect, data.fontSize, 32, 10, 100, value => `${value}px`);

    const wordAllowed = ["smooth", "silky"];
    wordTrackingStyleSelect.value = wordAllowed.includes(String(data.wordTrackingStyle))
      ? String(data.wordTrackingStyle)
      : "smooth";

    currentProviderOrder = normalizeOrder(data.providerOrder);
    currentProviderEnabled = normalizeEnabled(data.providerEnabled);
    renderProviderList();
    renderSettingsPreview();
  }
);

enabledToggle.addEventListener("change", () => chrome.storage.sync.set({ enabled: enabledToggle.checked }));
fontSizeSelect.addEventListener("change", () => chrome.storage.sync.set({ fontSize: Number(fontSizeSelect.value), uiVersion: 9 }));
focusFadeToggle.addEventListener("change", () => chrome.storage.sync.set({ focusFade: focusFadeToggle.checked }));
trackingToggle.addEventListener("change", () => chrome.storage.sync.set({ trackingEnabled: trackingToggle.checked }));
autoLyricsOnIdleToggle.addEventListener("change", () => chrome.storage.sync.set({ autoLyricsOnIdle: autoLyricsOnIdleToggle.checked }));
wordTrackingStyleSelect.addEventListener("change", () => chrome.storage.sync.set({ wordTrackingStyle: wordTrackingStyleSelect.value }));

const userDataKeys = ["ytmlsTrackTimingOffsetsV174", "ytmlsManualSearchOverridesV190", "ytmlsLyricsEditsV199", "ytmlsPinnedLyricsV200", "ytmlsLocalLyricsV200", "ytmlsManualReadingsV256"];
chrome.storage.local.get(userDataKeys, data => {
  const summary = document.getElementById("savedDataSummary");
  if (chrome.runtime.lastError) { summary.textContent = "保存件数を取得できませんでした。"; return; }
  const ids = new Set(userDataKeys.flatMap(key => Object.keys(data[key] || {})));
  chrome.storage.local.getBytesInUse(userDataKeys, bytes => {
    summary.textContent = chrome.runtime.lastError ? `保存済み ${ids.size}曲（使用量取得失敗）`
      : `保存済み ${ids.size}曲 / ${(bytes / 1024 / 1024).toFixed(2)} MB`;
  });
});
document.getElementById("extensionVersion").textContent = `v${chrome.runtime.getManifest().version}`;

function renderSettingsPreview() {
  const preview = document.getElementById('settingsPreview');
  if (!preview) return;
  preview.style.fontSize = `${Number(fontSizeSelect.value) || 32}px`;
  preview.dataset.fade = String(focusFadeToggle.checked);
  preview.dataset.tracking = String(trackingToggle.checked);
  preview.dataset.style = wordTrackingStyleSelect.value;
}
for (const control of [fontSizeSelect, focusFadeToggle, trackingToggle, wordTrackingStyleSelect]) {
  control.addEventListener('change', renderSettingsPreview);
}
