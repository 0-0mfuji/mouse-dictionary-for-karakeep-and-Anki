/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import config from "../main/core/config";
import karakeepClient from "./karakeepClient";
import ExpiringQueue from "./queue";
import generateUniqueId from "./unique";

if (BROWSER === "chrome") {
  chrome.action.onClicked.addListener((tab) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["main.js"],
    });
  });
} else {
  chrome.browserAction.onClicked.addListener(() => {
    chrome.tabs.executeScript({
      file: "./main.js",
    });
  });
}

// cross-extension messaging
chrome.runtime.onMessageExternal.addListener((message) => {
  sendToActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { message: message });
  });
});

// Shortcut key handling
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "scroll_up":
      sendToActiveTab((tabId) => chrome.tabs.sendMessage(tabId, { message: { type: "scroll_up" } }));
      break;
    case "scroll_down":
      sendToActiveTab((tabId) => chrome.tabs.sendMessage(tabId, { message: { type: "scroll_down" } }));
      break;
    case "activate_extension":
      // Workaround for Vivaldi (see #84)
      sendToActiveTab((tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          files: ["main.js"],
        }),
      );
      break;
  }
});

// PDF handling
const queue = new ExpiringQueue(1000 * 30);
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request?.type) {
    case "open_pdf": {
      const id = generateUniqueId();
      queue.push(id, request.payload);
      chrome.runtime.sendMessage({ type: "prepare_pdf" });
      chrome.runtime.openOptionsPage(() => {
        sendResponse();
      });
      break;
    }
    case "shift_pdf_id": {
      const frontId = queue.shiftId();
      sendResponse(frontId);
      break;
    }
    case "get_pdf_data": {
      const pdfData = queue.get(request.id);
      sendResponse(pdfData);
      break;
    }
    case "karakeep_save_word": {
      saveWordToKarakeep(request).then(sendResponse);
      return true;
    }
    case "karakeep_create_highlight": {
      createKarakeepHighlight(request).then(sendResponse);
      return true;
    }
  }
});

const saveWordToKarakeep = async ({ word, meaning, pageUrl }) => {
  const settings = await config.loadSettings();
  const { karakeepUrl, karakeepApiKey, karakeepTag } = settings;

  if (!karakeepUrl || !karakeepApiKey) {
    return { ok: false, status: 0, message: "Karakeep is not configured yet. Please set it up in the options page." };
  }

  try {
    const bookmark = await karakeepClient.createTextBookmark(karakeepUrl, karakeepApiKey, {
      title: word,
      text: meaning,
      sourceUrl: pageUrl,
    });
    await karakeepClient.attachTag(karakeepUrl, karakeepApiKey, bookmark.id, karakeepTag);
    return { ok: true };
  } catch (e) {
    return { ok: false, status: e?.status ?? 0, message: e?.message ?? String(e) };
  }
};

const createKarakeepHighlight = async ({ bookmarkId, startOffset, endOffset, text, note, color }) => {
  const settings = await config.loadSettings();
  const { karakeepUrl, karakeepApiKey } = settings;

  if (!karakeepUrl || !karakeepApiKey) {
    return { ok: false, status: 0, message: "Karakeep is not configured yet. Please set it up in the options page." };
  }

  try {
    await karakeepClient.createHighlight(karakeepUrl, karakeepApiKey, {
      bookmarkId,
      startOffset,
      endOffset,
      text,
      note,
      color,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, status: e?.status ?? 0, message: e?.message ?? String(e) };
  }
};

const sendToActiveTab = (callback) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    for (let i = 0; i < tabs.length; i++) {
      callback(tabs[i].id);
    }
  });
};
