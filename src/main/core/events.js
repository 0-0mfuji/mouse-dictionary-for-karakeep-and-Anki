/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import dom from "../lib/dom";
import Draggable from "../lib/draggable";
import sound from "../lib/sound";
import traverser from "../lib/traverser";
import utils from "../lib/utils";
import config from "./config";
import entryDefault from "./entry/default";
import karakeepHighlighter from "./karakeepHighlighter";
import Lookuper from "./lookuper";
import rule from "./rule";

const POSITION_FIELDS = ["left", "top", "width", "height"];

const attach = async (settings, dialog, doUpdateContent) => {
  let enableDefault = true;
  let currentHighlightTarget = null;

  const traverse = traverser.build(rule.doLetters, settings.parseWordsLimit);
  const lookuper = new Lookuper(settings, entryDefault(), doUpdateContent);

  const draggable = new Draggable(settings.normalDialogStyles, settings.movingDialogStyles);
  draggable.events.change = (e) => config.savePosition(e);
  draggable.add(dialog);

  setDialogEvents(dialog, () => currentHighlightTarget);

  // Host pages (e.g. karakeep's modal-based article reader, via Radix UI's DismissableLayer)
  // watch "pointerdown" on document/window to detect clicks outside their own DOM subtree and
  // dismiss on that basis. Our dialog is a separate, independent element positioned on top, so
  // from their point of view interacting with it looks external. Stopping propagation on the
  // earliest possible listener (window, capture phase) for just "pointerdown" shields our dialog
  // from that detection. This deliberately does NOT touch "mousedown" - Draggable's drag/resize
  // handling (src/main/lib/draggable.js) listens for mousedown directly on the dialog element, so
  // stopping it here (window capture, before the event ever reaches that listener) would break
  // dragging entirely; "click" is unaffected either way since it's a separate later event.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.composedPath?.().includes(dialog)) {
        e.stopPropagation();
      }
    },
    true,
  );

  document.body.addEventListener("mousedown", () => {
    lookuper.suspended = true;
  });

  document.body.addEventListener("mouseup", async (e) => {
    draggable.onMouseUp(e);
    lookuper.suspended = false;

    // Clicking one of our own dialog's buttons (e.g. 🖍️) fires this same mouseup listener too,
    // since it's a plain page-wide handler. That click collapses whatever page selection was
    // active, so recomputing currentHighlightTarget here would overwrite it with null right
    // before the button's own click handler reads it. Skip recomputation for dialog-internal
    // mouseups and leave the value from the last real page selection intact.
    const isInsideDialog = e.composedPath?.().includes(dialog);

    // Read the selection synchronously, before any `await` below yields control. Other
    // extensions (e.g. selection-based translators) can clear the native selection as soon as
    // their own mouseup handler runs, so waiting until after an await here can lose it to a race.
    if (!isInsideDialog) {
      const highlightTarget = karakeepHighlighter.getHighlightTarget(settings.karakeepUrl);
      currentHighlightTarget = highlightTarget && { ...highlightTarget, color: settings.karakeepHighlightColor };
    }

    const updated = await lookuper.aimedLookup(utils.getSelection());
    if (updated) {
      draggable.resetScroll();
    }
    // Re-applied after aimedLookup, since a hit replaces the dialog content (and its buttons).
    updateHighlightButtonsVisibility(dialog, currentHighlightTarget);

    const range = utils.omap(dialog.style, utils.convertToInt, POSITION_FIELDS);
    const didMouseUpOnTheWindow = utils.isInsideRange(range, {
      x: e.clientX,
      y: e.clientY,
    });
    lookuper.halfLocked = didMouseUpOnTheWindow;
  });

  const onMouseMoveFirst = async (e) => {
    // Wait until rule loading finish
    await rule.load();

    onMouseMove = onMouseMoveSecondOrLater;
    onMouseMove(e);
  };

  const onMouseMoveSecondOrLater = async (e) => {
    draggable.onMouseMove(e);
    if (enableDefault) {
      const textList = traverse(e.target, e.clientX, e.clientY);
      const updated = await lookuper.lookupAll(textList);
      if (updated) {
        draggable.resetScroll();
      }
    }
  };
  let onMouseMove = onMouseMoveFirst;
  document.body.addEventListener("mousemove", (e) => onMouseMove(e));

  document.body.addEventListener("keydown", (e) => {
    if (e.key === "Shift") {
      draggable.activateSnap(e);
    }
  });

  document.body.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      draggable.deactivateSnap(e);
    }
  });

  chrome.runtime.onMessage.addListener((request) => {
    const m = request.message;
    switch (m?.type) {
      case "text":
        lookuper.update(m.text, m.withCapitalized, m.mustIncludeOriginalText, m.enableShortWord);
        break;
      case "mousemove":
        draggable.onMouseMove(m);
        break;
      case "mouseup":
        draggable.onMouseUp();
        break;
      case "enable_default":
        enableDefault = true;
        break;
      case "disable_default":
        enableDefault = false;
        break;
      case "scroll_up":
        draggable.scroll(-50);
        break;
      case "scroll_down":
        draggable.scroll(50);
        break;
    }
  });

  const selectedText = utils.getSelection();
  if (selectedText) {
    // Wait until rule loading finish
    await rule.load();
    // First invoke
    lookuper.aimedLookup(selectedText);
  }

  // Guide handling
  let snapGuide = null;
  draggable.events.move = () => {
    if (snapGuide) {
      return;
    }
    snapGuide = createSnapGuideElement();
    dialog.appendChild(snapGuide);
  };
  draggable.events.finish = () => {
    if (!snapGuide) {
      return;
    }
    snapGuide.remove();
    snapGuide = null;
  };
};

const setDialogEvents = (dialog, getHighlightTarget) => {
  dialog.addEventListener("mouseenter", (e) => {
    for (const elem of e.target.querySelectorAll("[data-md-pronunciation]")) {
      if (elem.dataset.mdPronunciationSet) {
        continue;
      }
      elem.dataset.mdPronunciationSet = "true";
      elem.addEventListener("click", () => sound.pronounce(elem.dataset.mdPronunciation));
    }
    for (const elem of e.target.querySelectorAll("[data-md-save]")) {
      if (elem.dataset.mdSaveSet) {
        continue;
      }
      elem.dataset.mdSaveSet = "true";
      elem.addEventListener("click", () => saveToKarakeep(elem));
    }
    for (const elem of e.target.querySelectorAll("[data-md-highlight]")) {
      if (elem.dataset.mdHighlightSet) {
        continue;
      }
      elem.dataset.mdHighlightSet = "true";
      elem.addEventListener("click", () => markInKarakeep(elem, getHighlightTarget()));
    }
    for (const elem of e.target.querySelectorAll("[data-md-hovervisible]")) {
      elem.style.visibility = "visible";
    }
  });
  dialog.addEventListener("mouseleave", (e) => {
    for (const elem of e.target.querySelectorAll("[data-md-hovervisible]")) {
      elem.style.visibility = "hidden";
    }
  });
};

const saveToKarakeep = async (elem) => {
  const entry = elem.closest("[data-md-entry]");
  if (!entry) {
    return;
  }
  const word = entry.dataset.mdHead;
  const meaning = entry.querySelector("[data-md-desc]")?.textContent?.trim() ?? "";

  elem.textContent = "⏳";
  const response = await chrome.runtime.sendMessage({
    type: "karakeep_save_word",
    word,
    meaning,
    pageUrl: location.href,
  });

  if (response?.ok) {
    elem.textContent = "✅";
    elem.title = "Saved to Karakeep";
  } else {
    elem.textContent = "❌";
    elem.title = response?.message ? `Failed to save: ${response.message}` : "Failed to save to Karakeep";
    DEBUG && console.info("[karakeep] save failed", response);
  }
};

const updateHighlightButtonsVisibility = (dialog, highlightTarget) => {
  for (const elem of dialog.querySelectorAll("[data-md-highlight]")) {
    elem.style.display = highlightTarget ? "" : "none";
  }
};

const markInKarakeep = async (elem, highlightTarget) => {
  if (!highlightTarget) {
    return;
  }
  const entry = elem.closest("[data-md-entry]");
  const note = entry?.querySelector("[data-md-desc]")?.textContent?.trim() ?? "";

  elem.textContent = "⏳";
  const response = await chrome.runtime.sendMessage({
    type: "karakeep_create_highlight",
    bookmarkId: highlightTarget.bookmarkId,
    startOffset: highlightTarget.startOffset,
    endOffset: highlightTarget.endOffset,
    text: highlightTarget.text,
    note,
    color: highlightTarget.color,
  });

  if (response?.ok) {
    elem.textContent = "✅";
    elem.title = "Marked in Karakeep";
  } else {
    elem.textContent = "❌";
    elem.title = response?.message ? `Failed to mark: ${response.message}` : "Failed to mark in Karakeep";
    DEBUG && console.info("[karakeep] mark-in-article failed", response);
  }
};

const createSnapGuideElement = () => {
  const guideElement = dom.create("<div>Shift+Move: Smart-snap</div");
  dom.applyStyles(guideElement, {
    right: "0px",
    top: "0px",
    position: "absolute",
    color: "#FFFFFF",
    backgroundColor: "#4169e1",
    fontSize: "small",
    opacity: "0.90",
    margin: "4px",
    padding: "3px",
    borderRadius: "5px 5px 5px 5px",
  });
  return guideElement;
};

export default { attach };
