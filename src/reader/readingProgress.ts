/** Karakeep 0.33.2 normalizes each DOM text node separately for reading offsets. */
export type RemoteProgress = {
  readingProgressOffset: number | null;
  readingProgressAnchor: string | null;
  readingProgressPercent: number | null;
};
export type ProgressParagraph = { start: number; end: number; offset: number; anchor: string };
export type ProgressMap = { paragraphs: ProgressParagraph[]; totalLength: number };
export type LocalProgress = {
  fingerprint: string;
  offset: number;
  completed: boolean;
  remote: RemoteProgress | null;
  baseline: RemoteProgress | null;
  pending: boolean;
};
export const normalizeReadingText = (text: string) => text.replace(/\s+/g, " ").trim();

export function captureProgressMap(container: HTMLElement, articleText: string): ProgressMap {
  // Preserve a mapping from normalized search text back to the extracted article.
  const positions: number[] = [];
  const chunks: string[] = [];
  for (let i = 0; i < articleText.length; i++) {
    if (/\s/.test(articleText[i])) {
      if (chunks.length && chunks[chunks.length - 1] !== " ") {
        chunks.push(" ");
        positions.push(i);
      }
    } else {
      chunks.push(articleText[i]);
      positions.push(i);
    }
  }
  const searchable = chunks.join("");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const offsets = new Map<Node, number>();
  let offset = 0;
  while (walker.nextNode()) {
    offsets.set(walker.currentNode, offset);
    offset += normalizeReadingText(walker.currentNode.textContent ?? "").length;
  }
  const paragraphs: ProgressParagraph[] = [];
  let searchFrom = 0;
  for (const paragraph of container.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,li,blockquote")) {
    const text = normalizeReadingText(paragraph.innerText ?? paragraph.textContent ?? "");
    if (!text) continue;
    const found = searchable.indexOf(text, searchFrom);
    if (found < 0) continue;
    const firstNode = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
    const paragraphOffset = firstNode && offsets.get(firstNode);
    if (paragraphOffset == null) continue;
    paragraphs.push({
      start: positions[found],
      end: positions[found + text.length - 1] + 1,
      offset: paragraphOffset,
      anchor: normalizeReadingText(paragraph.textContent ?? "").slice(0, 50),
    });
    // Outer list/blockquote elements cover nested paragraphs; do not map their children twice.
    searchFrom = found + text.length;
  }
  return { paragraphs, totalLength: normalizeReadingText(container.textContent ?? "").length };
}

export const sameRemoteProgress = (a: RemoteProgress | null, b: RemoteProgress | null) =>
  (a?.readingProgressOffset ?? null) === (b?.readingProgressOffset ?? null) &&
  (a?.readingProgressAnchor ?? null) === (b?.readingProgressAnchor ?? null) &&
  (a?.readingProgressPercent ?? null) === (b?.readingProgressPercent ?? null);

export function toRemoteProgress(
  map: ProgressMap | undefined,
  offset: number,
  completed: boolean,
): RemoteProgress | null {
  if (!map?.paragraphs.length || !map.totalLength) return null;
  const paragraph = map.paragraphs.find((p) => offset >= p.start && offset < p.end);
  if (!paragraph) return null;
  return {
    readingProgressOffset: completed ? map.totalLength : paragraph.offset,
    readingProgressAnchor: paragraph.anchor,
    readingProgressPercent: completed ? 100 : Math.min(99, Math.round((paragraph.offset / map.totalLength) * 100)),
  };
}

export function restoreReadingOffset(
  text: string,
  map: ProgressMap | undefined,
  fingerprint: string,
  local: LocalProgress | null,
  remote: RemoteProgress | null,
  remoteAvailable: boolean,
): number {
  if (
    local?.fingerprint === fingerprint &&
    (!remoteAvailable || sameRemoteProgress(remote, local.baseline) || sameRemoteProgress(remote, local.remote))
  )
    return local.offset;
  if (remote?.readingProgressPercent === 100) return text.length;
  if (remote?.readingProgressAnchor) {
    const matches = map?.paragraphs.filter((p) => p.anchor === remote.readingProgressAnchor) ?? [];
    matches.sort(
      (a, b) =>
        Math.abs(a.offset - (remote.readingProgressOffset ?? 0)) -
        Math.abs(b.offset - (remote.readingProgressOffset ?? 0)),
    );
    if (matches[0]) return matches[0].start;
  }
  if (map?.paragraphs.length && remote?.readingProgressOffset != null) {
    return [...map.paragraphs].reverse().find((p) => p.offset <= (remote.readingProgressOffset ?? 0))?.start ?? 0;
  }
  return Math.floor((text.length * (remote?.readingProgressPercent ?? 0)) / 100);
}

export async function fingerprintText(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
