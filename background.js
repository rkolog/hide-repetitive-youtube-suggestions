// Make sure the default values exist on first install.
browser.runtime.onInstalled.addListener(async () => {
  const { value, enabled } = await browser.storage.local.get(["value", "enabled"]);
  const defaults = {};
  if (value === undefined) defaults.value = 10;
  if (enabled === undefined) defaults.enabled = true;
  if (Object.keys(defaults).length) await browser.storage.local.set(defaults);
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "hiddenCount" && sender.tab) {
    browser.browserAction.setBadgeText({
      tabId: sender.tab.id,
      text: msg.n > 0 ? String(msg.n) : "",
    });
  }
});
