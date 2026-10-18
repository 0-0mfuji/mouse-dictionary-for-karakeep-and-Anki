import config from "../main/core/config";

const SCRIPT_ID = "karakeep-reader-launcher";
export async function registerReaderLauncher() {
  if (!chrome.scripting?.registerContentScripts) return;
  const { karakeepUrl } = await config.loadSettings();
  let match;
  try {
    match = `${new URL(karakeepUrl).origin}/*`;
  } catch {
    /* Not configured yet. */
  }
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const permitted = match && (await chrome.permissions.contains({ origins: [match] }));
  if (!permitted) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const script = { id: SCRIPT_ID, matches: [match], js: ["karakeep-reader.js"], runAt: "document_idle" };
  if (registered.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  const tabs = await chrome.tabs.query({ url: [match] });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id != null)
      .map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["karakeep-reader.js"],
        }),
      ),
  );
}
