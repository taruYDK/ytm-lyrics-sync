const enabledToggle = document.getElementById("enabledToggle");
const fontSizeSelect = document.getElementById("fontSizeSelect");
const focusFadeToggle = document.getElementById("focusFadeToggle");
const trackingToggle = document.getElementById("trackingToggle");
const autoLyricsOnIdleToggle = document.getElementById("autoLyricsOnIdleToggle");
const wordTrackingStyleSelect = document.getElementById("wordTrackingStyleSelect");
const providerList = document.getElementById("providerList");
const providerNote = document.getElementById("providerNote");

const PROVIDERS = [
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
  });
  providerNote.textContent = message;
  window.setTimeout(() => {
    if (providerNote.textContent === message) providerNote.textContent = "";
  }, 2200);
}

function renderProviderList() {
  providerList.replaceChildren();
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
        providerNote.textContent = "少なくとも1つの提供元を有効にしてください";
        return;
      }
      currentProviderEnabled = next;
      saveProviderConfig();
    });

    const rank = document.createElement("span");
    rank.className = "provider-rank";
    rank.textContent = String(index + 1);

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
    focusFade: true,
    trackingEnabled: true,
    autoLyricsOnIdle: true,
    wordTrackingStyle: "smooth",
    providerOrder: DEFAULT_PROVIDER_ORDER,
    providerEnabled: currentProviderEnabled,
    uiVersion: 9,
  },
  (data) => {
    enabledToggle.checked = data.enabled !== false;
    focusFadeToggle.checked = data.focusFade !== false;
    trackingToggle.checked = data.trackingEnabled !== false;
    autoLyricsOnIdleToggle.checked = data.autoLyricsOnIdle !== false;

    const fontAllowed = ["26", "28", "32", "36", "40"];
    fontSizeSelect.value = fontAllowed.includes(String(data.fontSize)) ? String(data.fontSize) : "32";

    const wordAllowed = ["smooth", "silky"];
    wordTrackingStyleSelect.value = wordAllowed.includes(String(data.wordTrackingStyle))
      ? String(data.wordTrackingStyle)
      : "smooth";

    currentProviderOrder = normalizeOrder(data.providerOrder);
    currentProviderEnabled = normalizeEnabled(data.providerEnabled);
    renderProviderList();
  }
);

enabledToggle.addEventListener("change", () => chrome.storage.sync.set({ enabled: enabledToggle.checked }));
fontSizeSelect.addEventListener("change", () => chrome.storage.sync.set({ fontSize: parseInt(fontSizeSelect.value, 10), uiVersion: 9 }));
focusFadeToggle.addEventListener("change", () => chrome.storage.sync.set({ focusFade: focusFadeToggle.checked }));
trackingToggle.addEventListener("change", () => chrome.storage.sync.set({ trackingEnabled: trackingToggle.checked }));
autoLyricsOnIdleToggle.addEventListener("change", () => chrome.storage.sync.set({ autoLyricsOnIdle: autoLyricsOnIdleToggle.checked }));
wordTrackingStyleSelect.addEventListener("change", () => chrome.storage.sync.set({ wordTrackingStyle: wordTrackingStyleSelect.value }));
