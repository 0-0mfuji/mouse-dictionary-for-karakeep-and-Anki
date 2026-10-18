import { t } from "../../i18n";
/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { captureProgressMap } from "../../reader/readingProgress";

const READER_PATH_SEGMENT = "/dashboard/preview/";

const getConfiguredOrigin = (karakeepUrl) => {
  if (!karakeepUrl) {
    return null;
  }
  try {
    return new URL(karakeepUrl).origin;
  } catch {
    return null;
  }
};

const isOnKarakeepReader = (karakeepUrl) => {
  const origin = getConfiguredOrigin(karakeepUrl);
  if (!origin) {
    return false;
  }
  return location.origin === origin && location.pathname.includes(READER_PATH_SEGMENT);
};

const extractBookmarkId = () => {
  const match = location.pathname.match(/\/dashboard\/preview\/([^/]+)/);
  return match ? match[1] : null;
};

const getReaderContainer = () => {
  // Search results can contain their own `.prose` nodes behind the preview.
  // Restrict extraction to the open Radix dialog when a modal preview exists.
  const root =
    document.querySelector('[role="dialog"][data-state="open"]') ||
    document.querySelector('[role="dialog"]') ||
    document;
  const proseCandidates = Array.from(root.querySelectorAll(".prose"));
  const candidates = proseCandidates.length
    ? proseCandidates
    : Array.from(root.querySelectorAll("div[role='presentation']"));
  return candidates
    .filter((candidate) => candidate instanceof HTMLElement && candidate.innerText?.trim().length > 120)
    .sort((a, b) => b.innerText.length - a.innerText.length)[0];
};

const getReaderArticle = (karakeepUrl) => {
  if (!isOnKarakeepReader(karakeepUrl)) return null;
  const container = getReaderContainer();
  const text = container?.innerText?.trim();
  const bookmarkId = extractBookmarkId();
  if (!text || !bookmarkId) return null;
  const title = container?.querySelector("h1, h2")?.textContent?.trim() || document.title;
  return { bookmarkId, title, sourceUrl: location.href, text, progressMap: captureProgressMap(container, text) };
};

const addRsvpButton = (karakeepUrl) => {
  const existing = document.getElementById("md-rsvp-launch");
  if (!isOnKarakeepReader(karakeepUrl)) {
    existing?.remove();
    return;
  }
  const container = getReaderContainer();
  if (!container) {
    existing?.remove();
    return;
  }
  // Radix modal previews block interaction with body siblings. Keep the action inside the preview.
  const host = container.closest('[role="dialog"]') || container.parentElement || document.body;
  if (existing?.parentElement === host) {
    if (!existing.disabled && existing.textContent !== t("dictionary.readRsvp")) {
      existing.textContent = t("dictionary.readRsvp");
    }
    existing.title = t("dictionary.readingTab");
    existing.setAttribute("aria-label", t("dictionary.readRsvp"));
    return;
  }
  existing?.remove();
  const button = document.createElement("button");
  button.id = "md-rsvp-launch";
  button.type = "button";
  button.textContent = t("dictionary.readRsvp");
  button.title = t("dictionary.readingTab");
  button.setAttribute("aria-label", t("dictionary.readRsvp"));
  button.style.cssText = [
    "position:fixed",
    "right:24px",
    "bottom:24px",
    "z-index:2147483646",
    "padding:12px 18px",
    "border:1px solid #111",
    "border-radius:20px",
    "background:#fff",
    "color:#111",
    "font:500 14px system-ui",
    "box-shadow:0 2px 8px #0003",
    "cursor:pointer",
    "pointer-events:auto",
  ].join(";");
  button.addEventListener("click", async () => {
    const article = getReaderArticle(karakeepUrl);
    if (!article) {
      button.textContent = t("dictionary.waitArticle");
      return;
    }
    button.disabled = true;
    button.textContent = t("dictionary.preparing");
    try {
      const response = await chrome.runtime.sendMessage({ type: "open_rsvp_reader", article });
      if (response?.ok) {
        button.textContent = t("dictionary.opened");
        setTimeout(() => {
          button.textContent = t("dictionary.readRsvp");
          button.disabled = false;
        }, 1800);
        return;
      }
      button.title = response?.message || t("dictionary.readingFailed");
      console.error("[rsvp] failed to open reader", response?.message);
    } catch (error) {
      console.error("[rsvp] failed to open reader", error);
    }
    button.disabled = false;
    button.textContent = t("dictionary.readRsvp");
  });
  host.appendChild(button);
};

// Karakeep's ReaderView renders the bookmark's htmlContent into a `<div role="presentation">`
// (see BookmarkHtmlHighlighter.tsx in karakeep-app/karakeep). But `role="presentation"` is also
// used by other (unrelated, e.g. Radix UI) elements on the page, so a page-wide querySelector can
// grab the wrong one. Walking up from the selection itself is the reliable way to find the actual
// container; only fall back to scanning all candidates (picking the one that contains the
// selection) if that walk doesn't turn up anything.
const findReaderContainer = (range) => {
  let node = range.commonAncestorContainer;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = /** @type {Element} */ (node);
      if (el.getAttribute?.("role") === "presentation" || el.classList?.contains("prose")) {
        return el;
      }
    }
    node = node.parentNode;
  }
  for (const candidate of document.querySelectorAll('div[role="presentation"]')) {
    if (candidate.contains(range.commonAncestorContainer)) {
      return candidate;
    }
  }
  return null;
};

// Mirrors getTextNodeOffset() in karakeep's BookmarkHtmlHighlighter.tsx, so the offsets computed
// here line up with what the Karakeep highlights API expects for this same container's content.
const getTextNodeOffset = (container, node) => {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      return offset;
    }
    offset += walker.currentNode.textContent?.length ?? 0;
  }
  return -1;
};

/**
 * Returns { bookmarkId, startOffset, endOffset, text } for the current window selection if it's a
 * non-empty selection inside karakeep's own ReaderView content container, or null otherwise.
 */
const getHighlightTarget = (karakeepUrl) => {
  if (!isOnKarakeepReader(karakeepUrl)) {
    DEBUG &&
      console.info(
        `[karakeep] not on the configured reader view (url=${karakeepUrl || "(not set)"}, location=${location.href})`,
      );
    return null;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    DEBUG && console.info("[karakeep] no active (non-collapsed) selection");
    return null;
  }
  const range = selection.getRangeAt(0);
  const container = findReaderContainer(range);
  if (!container) {
    DEBUG && console.info('[karakeep] could not find the reader container (div[role="presentation"] or .prose)');
    return null;
  }

  const startOffset = getTextNodeOffset(container, range.startContainer) + range.startOffset;
  const endOffset = getTextNodeOffset(container, range.endContainer) + range.endOffset;
  if (startOffset === -1 || endOffset === -1) {
    DEBUG && console.info("[karakeep] failed to compute a text offset for the selection");
    return null;
  }

  const bookmarkId = extractBookmarkId();
  if (!bookmarkId) {
    DEBUG && console.info(`[karakeep] could not extract a bookmarkId from ${location.pathname}`);
    return null;
  }

  // `container` is a live DOM reference, kept only for applyVisualHighlight() below - it must
  // never be forwarded as-is into a chrome.runtime.sendMessage payload (not structured-cloneable).
  return { bookmarkId, startOffset, endOffset, text: range.toString(), container };
};

// Tailwind bg-{color}-200 equivalents, matching karakeep's own highlight styling
// (see HIGHLIGHT_COLOR_MAP in packages/shared-react/components/highlights.ts).
const HIGHLIGHT_BACKGROUND_COLORS = {
  yellow: "#fef08a",
  red: "#fecaca",
  green: "#bbf7d0",
  blue: "#bfdbfe",
};

// Mirrors getRangeFromHighlight()/applyHighlightByOffset() in karakeep's own
// BookmarkHtmlHighlighter.tsx, so the freshly-created highlight shows up immediately instead of
// only after the user reloads the page (karakeep's own React state has no way to know we created
// it, since we talk to its API directly rather than through its UI).
const applyVisualHighlight = (container, startOffset, endOffset, color) => {
  if (!container) {
    return;
  }
  const ranges = [];
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    const nodeLength = node.textContent?.length ?? 0;
    const nodeStart = offset;
    const nodeEnd = nodeStart + nodeLength;
    if (nodeStart < endOffset && nodeEnd > startOffset) {
      ranges.push({
        node,
        start: Math.max(0, startOffset - nodeStart),
        end: Math.min(nodeLength, endOffset - nodeStart),
      });
    }
    offset += nodeLength;
    node = walker.nextNode();
  }

  for (let { node: textNode, start, end } of ranges) {
    if (start > 0) {
      textNode.splitText(start);
      textNode = /** @type {Text} */ (textNode.nextSibling);
      end -= start;
    }
    if (end < textNode.length) {
      textNode.splitText(end);
    }
    const span = document.createElement("span");
    span.style.backgroundColor = HIGHLIGHT_BACKGROUND_COLORS[color] ?? HIGHLIGHT_BACKGROUND_COLORS.yellow;
    span.dataset.mdKarakeepHighlight = "true";
    textNode.parentNode?.insertBefore(span, textNode);
    span.appendChild(textNode);
  }
};

export default { getHighlightTarget, applyVisualHighlight, addRsvpButton };
