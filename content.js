(() => {
  // Home page cards and watch-page sidebar cards use different elements.
  const HOME_CARD = "ytd-rich-item-renderer";
  const WATCH_CARD = "yt-lockup-view-model";
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href^="/shorts/"]';
  const DEFAULT_LIMIT = 10;
  const DEBUG = false; // set to true to print logs
  const DEFAULT_EXPIRE_DAYS = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const log = (...args) => {
    if (DEBUG) console.log("[Hide Repetitive Youtube Suggestions]", ...args);
  };

  let limit = DEFAULT_LIMIT;
  let counts = {}; // ONE shared counter for home + watch pages
  let ready = false;
  let enabled = true;
  let expireEnabled = false;
  let expireDays = DEFAULT_EXPIRE_DAYS;
  let showHidden = false;
  let scanTimer = null;
  let saveTimer = null;
  let batch = [];

  // YouTube is a single-page app, so this script runs on every youtube.com
  // page and only acts on the home page and on video pages.
  const isHome = () => location.pathname === "/";
  const isWatch = () => location.pathname === "/watch";
  const isActivePage = () => isHome() || isWatch();

  const cardSelector = () => (isWatch() ? WATCH_CARD : HOME_CARD);
  const currentVideoId = () =>
    isWatch() ? new URLSearchParams(location.search).get("v") : null;

  // ---------- styles + toggle button ----------

  function injectStyles() {
    const style = document.createElement("style");
    // data-vh-off on <html> disables all hiding without touching card state,
    // so re-enabling doesn't double-count anything.
    style.textContent = `
      html:not([data-vh-show]):not([data-vh-off]) [data-vh-hidden] {
        display: none !important;
      }
      html[data-vh-show]:not([data-vh-off]) [data-vh-hidden] {
        opacity: 0.4;
        outline: 2px dashed #3a56d4;
        outline-offset: -1px;
      }
      @media (prefers-color-scheme: dark) {
        html[data-vh-show]:not([data-vh-off]) [data-vh-hidden] {
          outline-color: #8ea2ff;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function hiddenCount() {
    if (!enabled) return 0;
    return document.querySelectorAll("[data-vh-hidden]").length;
  }

  function sendBadge() {
    browser.runtime.sendMessage({ type: "hiddenCount", n: hiddenCount() }).catch(() => {});
  }

  function setShowHidden(value) {
    showHidden = value;
    document.documentElement.toggleAttribute("data-vh-show", showHidden);
  }

  function setEnabled(value) {
    enabled = value;
    document.documentElement.toggleAttribute("data-vh-off", !enabled);
    log(enabled ? "enabled" : "disabled");
    sendBadge();
    if (enabled) scheduleScan();
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "setShowHidden") setShowHidden(msg.value);
    if (msg.type === "getState" || msg.type === "setShowHidden") {
      return Promise.resolve({ showHidden, hidden: hiddenCount(), enabled });
    }
  });


  // ---------- card handling ----------

  function getVideoId(card) {
    const a = card.querySelector(LINK_SELECTOR);
    if (!a) return null; // skeleton/placeholder card or non-video card
    try {
      const url = new URL(a.getAttribute("href"), location.origin);
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const m = url.pathname.match(/^\/shorts\/([^/?]+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function hide(card) {
    card.dataset.vhHidden = "1";
  }

  function unhide(card) {
    delete card.dataset.vhHidden;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      browser.storage.local.set({ counts }).catch(() => {});
    }, 300);
  }

  function normalizeCounts(raw) {
    const now = Date.now();
    const out = {};
    let migrated = false;
    for (const [id, e] of Object.entries(raw || {})) {
      if (typeof e === "number") {
        out[id] = { n: e, t: now };
        migrated = true;
      } else if (e && typeof e.n === "number") {
        out[id] = { n: e.n, t: Number.isFinite(e.t) ? e.t : now };
      }
    }
    return { counts: out, migrated };
  }

  function purgeExpired() {
    if (!ready || !expireEnabled) return;
    const cutoff = Date.now() - expireDays * DAY_MS;
    let removed = 0;
    for (const id of Object.keys(counts)) {
      if (counts[id].t < cutoff) {
        delete counts[id];
        removed++;
      }
    }
    if (!removed) return;
    log(`expired ${removed} video(s) not seen for ${expireDays}+ days`);
    scheduleSave();
    // Release cards whose history was erased; the next scan counts them fresh.
    document.querySelectorAll("[data-vh-id]").forEach((card) => {
      if (!counts[card.dataset.vhId]) {
        unhide(card);
        delete card.dataset.vhId;
      }
    });
    scheduleScan();
  }

  function processCard(card) {
    const id = getVideoId(card);
    if (!id) return null;
    if (card.dataset.vhId === id) return null;

    unhide(card);

    // Never count or hide the video currently being watched.
    if (id === currentVideoId()) return null;

    // Not rendered: don't count it; a later scan picks it up if it appears.
    if (card.getClientRects().length === 0) return "skipped";

    card.dataset.vhId = id;

    const entry = counts[id];
    const seen = entry ? entry.n : 0;
    if (seen >= limit) {
      // Hidden: deliberately NOT refreshing lastSeen, so it can expire.
      hide(card);
      batch.push(`hidden   ${id} (seen ${seen}/${limit})`);
      return "hidden";
    }
    counts[id] = { n: seen + 1, t: Date.now() };
    scheduleSave();
    batch.push(`counted  ${id} (now ${seen + 1}/${limit})`);
    return "counted";
  }

  function scan() {
    if (!ready || !enabled) return;
    if (!isActivePage()) return;

    batch = [];
    const cards = document.querySelectorAll(cardSelector());
    let newlyCounted = 0;
    let newlyHidden = 0;
    let skipped = 0;
    let noId = 0;
    cards.forEach((card) => {
      const result = processCard(card);
      if (result === "counted") newlyCounted++;
      else if (result === "hidden") newlyHidden++;
      else if (result === "skipped") skipped++;
      else if (!card.dataset.vhId) noId++;
    });
    const added = newlyCounted + newlyHidden;

    sendBadge();

    if (added > 0) {
      const totalHidden = document.querySelectorAll("[data-vh-hidden]").length;
      const summary =
        `scan (${isWatch() ? "watch" : "home"}): ${cards.length} cards on page | ${added} newly added ` +
        `(${newlyCounted} counted, ${newlyHidden} hidden) | ` +
        `${totalHidden} hidden in total | ${skipped} not rendered (skipped) | ` +
        `${noId} without id yet | ${Object.keys(counts).length} unique videos stored`;
      log([...batch, summary].join("\n"));
    }
    batch = [];
  }

  function scheduleScan() {
    if (!ready || !enabled) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  function resetCards() {
    document.querySelectorAll("[data-vh-hidden], [data-vh-id]").forEach((card) => {
      unhide(card);
      delete card.dataset.vhId;
    });
  }

  // Re-apply the current limit to cards that were already processed.
  // n > limit  -> hide
  // n < limit  -> show
  // n == limit -> leave as is (it was shown on the view that reached the limit)
  function reevaluate() {
    if (!ready) return;
    document.querySelectorAll("[data-vh-id]").forEach((card) => {
      const entry = counts[card.dataset.vhId];
      const n = entry ? entry.n : 0;
      if (n > limit) hide(card);
      else if (n < limit) unhide(card);
    });
    sendBadge();
    scheduleScan();
  }

  async function init() {
    const stored = await browser.storage.local.get([
      "value", "counts", "enabled", "expireEnabled", "expireDays",
    ]);
    limit = Number.isInteger(stored.value) && stored.value > 0 ? stored.value : DEFAULT_LIMIT;
    const norm = normalizeCounts(stored.counts);
    counts = norm.counts;
    enabled = stored.enabled !== false;
    expireEnabled = stored.expireEnabled === true;
    expireDays =
      Number.isInteger(stored.expireDays) && stored.expireDays > 0
        ? stored.expireDays
        : DEFAULT_EXPIRE_DAYS;
    document.documentElement.toggleAttribute("data-vh-off", !enabled);
    ready = true;
    if (norm.migrated) scheduleSave();
    purgeExpired();
    setInterval(purgeExpired, 60 * 60 * 1000); // re-check hourly for long-open tabs

    log(`started: enabled=${enabled}, limit=${limit}, ${Object.keys(counts).length} videos in history, home=${isHome()}, watch=${isWatch()}`);

    injectStyles();

    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    window.addEventListener("yt-navigate-finish", scheduleScan);
    scan();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.enabled) {
      setEnabled(changes.enabled.newValue !== false);
    }

    if (changes.expireEnabled || changes.expireDays) {
      if (changes.expireEnabled) expireEnabled = changes.expireEnabled.newValue === true;
      if (changes.expireDays) {
        const v = changes.expireDays.newValue;
        expireDays = Number.isInteger(v) && v > 0 ? v : DEFAULT_EXPIRE_DAYS;
      }
      purgeExpired();
    }

    if (changes.value) {
      const v = changes.value.newValue;
      limit = Number.isInteger(v) && v > 0 ? v : DEFAULT_LIMIT;
      reevaluate();
    }

    if (changes.counts) {
      const nv = changes.counts.newValue;
      if (!nv || Object.keys(nv).length === 0) {
        log("history cleared");
        clearTimeout(saveTimer);
        counts = {};
        resetCards();
        scheduleScan();
      }
    }
  });

  init();
})();
