/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { buildKarakeepApiUrl } from "../main/lib/karakeepApi";

export class KarakeepApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "KarakeepApiError";
    this.status = status;
  }
}

const request = async (baseUrl, apiKey, path, options = {}) => {
  let response;
  try {
    response = await fetch(buildKarakeepApiUrl(baseUrl, path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(options.headers ?? {}),
      },
    });
  } catch (e) {
    throw new KarakeepApiError(0, e?.message ?? "Network error");
  }
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new KarakeepApiError(response.status, body || response.statusText);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

const createTextBookmark = (baseUrl, apiKey, { title, text, sourceUrl }) => {
  return request(baseUrl, apiKey, "/bookmarks", {
    method: "POST",
    body: JSON.stringify({ type: "text", title, text, sourceUrl }),
  });
};

const attachTag = (baseUrl, apiKey, bookmarkId, tagName) => {
  if (!tagName) {
    return Promise.resolve(null);
  }
  return request(baseUrl, apiKey, `/bookmarks/${bookmarkId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags: [{ tagName, attachedBy: "human" }] }),
  });
};

const createHighlight = (baseUrl, apiKey, { bookmarkId, startOffset, endOffset, text, note, color }) => {
  return request(baseUrl, apiKey, "/highlights", {
    method: "POST",
    body: JSON.stringify({ bookmarkId, startOffset, endOffset, text, note, color }),
  });
};

export default { KarakeepApiError, createTextBookmark, attachTag, createHighlight };
