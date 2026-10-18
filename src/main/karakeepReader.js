import { setLocale } from "../i18n";
import config from "./core/config";
import karakeepHighlighter from "./core/karakeepHighlighter";

// Separate from the dictionary toggle so opening an article always offers RSVP.
const key = "__mouseDictionaryReaderLauncher";
try {
  globalThis[key]?.();
} catch {
  /* The previous extension context may have been invalidated by an update. */
}
let timer;
let stopped = false;
let configuredUrl = "";
const refresh = () => {
  if (!stopped) karakeepHighlighter.addRsvpButton(configuredUrl);
};
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, 100);
};
const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", schedule);
const settingsChanged = () => {
  void config.loadSettings().then((settings) => {
    setLocale(settings.language, false);
    configuredUrl = settings.karakeepUrl;
    refresh();
  });
};
chrome.storage.onChanged.addListener(settingsChanged);
globalThis[key] = () => {
  stopped = true;
  clearTimeout(timer);
  observer.disconnect();
  window.removeEventListener("popstate", schedule);
  chrome.storage.onChanged.removeListener(settingsChanged);
};
settingsChanged();
