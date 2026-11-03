const DEFAULT_VALUE = 10;
const DEFAULT_EXPIRE_DAYS = 30;

const $ = (id) => document.getElementById(id);
const enableBtn = $("enable");
const panel = $("panel");
const storedEl = $("stored");
const input = $("value");
const saveBtn = $("save");
const expireSwitch = $("expireOn");
const expireDaysInput = $("expireDays");
const saveExpireBtn = $("saveExpire");
const toggleBtn = $("toggle");
const clearBtn = $("clear");
const statusEl = $("status");

const RELOAD_MSG = "Saved. Reloading the page is recommended.";
let needsReload = false;

let tabId = null;
let tabState = null; // null = not a YouTube tab / content script unavailable
let enabled = true;
let expireOn = false; // draft value, committed by "Save"
let confirmTimer = null;
let statusTimer = null;

const isPositiveInt = (raw) => /^\d+$/.test(raw) && parseInt(raw, 10) >= 1;

function show(msg, cls) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.className = cls || "";
  if (msg && cls === "ok") {
    statusTimer = setTimeout(() => show(""), 2500);
  }
}

function markChanged() {
  show("Saved.", "ok");
}

function setSwitch(btn, on) {
  btn.setAttribute("aria-checked", String(on));
}

// ---------- main on / off ----------

function renderEnable() {
  setSwitch(enableBtn, enabled);
  // A disabled fieldset disables every control inside it.
  panel.disabled = !enabled;
  if (!enabled) resetClearButton();
}

enableBtn.addEventListener("click", async () => {
  enabled = !enabled;
  renderEnable();
  await browser.storage.local.set({ enabled });
  markChanged();
});

// ---------- stored-videos text ----------

function renderStored(value, counts) {
  const limit = Number.isInteger(value) && value > 0 ? value : DEFAULT_VALUE;
  const n = Object.values(counts || {}).filter(
    (c) => (typeof c === "number" ? c : c && c.n) >= limit
  ).length;
  storedEl.textContent =
    n === 1
      ? "1 video is stored to keep hidden"
      : `${n} videos are stored to keep hidden`;
}

async function refreshStored() {
  const { value, counts } = await browser.storage.local.get(["value", "counts"]);
  renderStored(value, counts);
}

let refreshTimer = null;
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.value || changes.counts) {
    // Recompute from storage so the text matches the current limit and counts.
    refreshStored();
  }

  if (changes.value || changes.enabled || changes.expireEnabled ||
      changes.expireDays || changes.counts) {
    // Give the content script a moment to re-apply before asking its state.
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshTabState, 300);
  }
});

// ---------- hide threshold ----------

async function save() {
  const raw = input.value.trim();
  if (!isPositiveInt(raw)) {
    show("Enter a whole number of 1 or more.", "error");
    return;
  }
  await browser.storage.local.set({ value: parseInt(raw, 10) });
  markChanged();
}

saveBtn.addEventListener("click", save);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
input.addEventListener("input", () => show(""));

// ---------- "show videos again after N days" ----------

function renderExpire() {
  setSwitch(expireSwitch, expireOn);
  expireDaysInput.disabled = !expireOn;
  saveExpireBtn.disabled = !expireOn;
}

expireSwitch.addEventListener("click", () => {
  expireOn = !expireOn;
  renderExpire();
  show("");
});

async function saveExpire() {
  const raw = expireDaysInput.value.trim();
  if (expireOn && !isPositiveInt(raw)) {
    show("Enter a whole number of days (1 or more).", "error");
    return;
  }
  const update = { expireEnabled: expireOn };
  if (isPositiveInt(raw)) update.expireDays = parseInt(raw, 10);
  await browser.storage.local.set(update);
  markChanged();
}

saveExpireBtn.addEventListener("click", saveExpire);
expireDaysInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveExpire(); });
expireDaysInput.addEventListener("input", () => show(""));

// ---------- show / hide hidden videos ----------

function renderToggle() {
  if (!tabState) {
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Open YouTube to use";
    toggleBtn.dataset.on = "";
    return;
  }
  toggleBtn.disabled = false;
  toggleBtn.textContent =
    (tabState.showHidden ? "Hide again" : "Show currently hidden") + ` (${tabState.hidden})`;
  toggleBtn.dataset.on = tabState.showHidden ? "1" : "";
}

async function refreshTabState() {
  if (tabId === null) return;
  try {
    tabState = await browser.tabs.sendMessage(tabId, { type: "getState" });
  } catch {
    tabState = null;
  }
  renderToggle();
}

async function initToggle() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  tabId = tab.id;
  await refreshTabState();
}

toggleBtn.addEventListener("click", async () => {
  const on = !toggleBtn.dataset.on;
  try {
    tabState = await browser.tabs.sendMessage(tabId, { type: "setShowHidden", value: on });
  } catch {
    tabState = null;
  }
  renderToggle();
});

// ---------- clear history (two-step confirmation) ----------

function resetClearButton() {
  clearTimeout(confirmTimer);
  clearBtn.textContent = "Clear history";
  clearBtn.classList.remove("danger");
}

clearBtn.addEventListener("click", async () => {
  if (!clearBtn.classList.contains("danger")) {
    clearBtn.textContent = "Sure?";
    clearBtn.classList.add("danger");
    // Revert automatically if not confirmed.
    confirmTimer = setTimeout(resetClearButton, 3000);
    return;
  }
  resetClearButton();
  await browser.storage.local.set({ counts: {} });
  show("History cleared.", "ok");
});
clearBtn.addEventListener("blur", resetClearButton);

// ---------- init ----------

async function load() {
  const stored = await browser.storage.local.get([
    "value", "enabled", "expireEnabled", "expireDays",
  ]);
  input.value =
    Number.isInteger(stored.value) && stored.value > 0 ? stored.value : DEFAULT_VALUE;
  expireOn = stored.expireEnabled === true;
  expireDaysInput.value =
    Number.isInteger(stored.expireDays) && stored.expireDays > 0
      ? stored.expireDays
      : DEFAULT_EXPIRE_DAYS;
  enabled = stored.enabled !== false;
  renderExpire();
  renderEnable();
  refreshStored();
}

load();
initToggle();
