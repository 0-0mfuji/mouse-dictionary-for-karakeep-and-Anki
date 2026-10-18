/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { buildKarakeepApiUrl } from "../../main/lib/karakeepApi";

export type AnkiEntry = {
  front: string;
  back: string;
};

// The Karakeep API only exposes cursor-based pagination (no total count), so progress can only
// report how many pages have been fetched so far, not a "current/total" ratio.
export type ExportProgress = {
  stage: "notes" | "highlights";
  page: number;
};

export class KarakeepExportError extends Error {}

const PAGE_LIMIT = 50;

const request = async (baseUrl: string, apiKey: string, path: string): Promise<any> => {
  const url = buildKarakeepApiUrl(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (e) {
    throw new KarakeepExportError(e instanceof Error ? e.message : String(e));
  }
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new KarakeepExportError(`${response.status} ${body || response.statusText}`);
  }
  return response.json();
};

const findTagId = async (baseUrl: string, apiKey: string, tagName: string): Promise<string | null> => {
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams();
    if (cursor) {
      params.set("cursor", cursor);
    }
    const query = params.toString();
    const data = await request(baseUrl, apiKey, `/tags${query ? `?${query}` : ""}`);
    const found = data.tags.find((tag: { name: string }) => tag.name === tagName);
    if (found) {
      return found.id;
    }
    cursor = data.nextCursor;
  } while (cursor);
  return null;
};

const collectNoteEntries = async (
  baseUrl: string,
  apiKey: string,
  tagName: string,
  onProgress?: (progress: ExportProgress) => void,
): Promise<AnkiEntry[]> => {
  const tagId = await findTagId(baseUrl, apiKey, tagName);
  if (!tagId) {
    return [];
  }

  const entries: AnkiEntry[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    page += 1;
    onProgress?.({ stage: "notes", page });

    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), includeContent: "true" });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const data = await request(baseUrl, apiKey, `/tags/${tagId}/bookmarks?${params.toString()}`);
    for (const bookmark of data.bookmarks) {
      if (bookmark.content?.type !== "text") {
        continue;
      }
      const front = bookmark.title?.trim();
      if (!front) {
        continue;
      }
      entries.push({ front, back: bookmark.content.text ?? "" });
    }
    cursor = data.nextCursor;
  } while (cursor);

  return entries;
};

const collectHighlightEntries = async (
  baseUrl: string,
  apiKey: string,
  onProgress?: (progress: ExportProgress) => void,
): Promise<AnkiEntry[]> => {
  const entries: AnkiEntry[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    page += 1;
    onProgress?.({ stage: "highlights", page });

    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const data = await request(baseUrl, apiKey, `/highlights?${params.toString()}`);
    for (const highlight of data.highlights) {
      const front = highlight.text?.trim();
      if (!front) {
        continue;
      }
      entries.push({ front, back: highlight.note ?? "" });
    }
    cursor = data.nextCursor;
  } while (cursor);

  return entries;
};

const normalizeFrontKey = (front: string): string => front.trim().toLowerCase();

// Anki treats the first field (Front) as the duplicate-detection key and skips later duplicates
// on import by default, so merge same-word entries here (joined with <hr>, since Anki cards render
// as HTML) rather than letting Anki silently drop the context from a second mark of the same word.
export const mergeDuplicateFronts = (entries: AnkiEntry[]): AnkiEntry[] => {
  const order: string[] = [];
  const grouped = new Map<string, { front: string; backs: string[] }>();

  for (const entry of entries) {
    const key = normalizeFrontKey(entry.front);
    if (!grouped.has(key)) {
      grouped.set(key, { front: entry.front.trim(), backs: [] });
      order.push(key);
    }
    const back = entry.back?.trim();
    if (back) {
      grouped.get(key)?.backs.push(back);
    }
  }

  return order.map((key) => {
    const group = grouped.get(key);
    return { front: group?.front ?? "", back: (group?.backs ?? []).join("<hr>") };
  });
};

export const collectAnkiEntries = async (
  baseUrl: string,
  apiKey: string,
  tagName: string,
  onProgress?: (progress: ExportProgress) => void,
): Promise<AnkiEntry[]> => {
  const noteEntries = await collectNoteEntries(baseUrl, apiKey, tagName, onProgress);
  const highlightEntries = await collectHighlightEntries(baseUrl, apiKey, onProgress);
  return mergeDuplicateFronts([...noteEntries, ...highlightEntries]);
};
