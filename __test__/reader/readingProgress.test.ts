import { expect, test } from "vitest";
import {
  captureProgressMap,
  type LocalProgress,
  restoreReadingOffset,
  toRemoteProgress,
} from "../../src/reader/readingProgress";

test("maps rendered paragraphs to Karakeep's per-node normalized offsets, including inline markup", () => {
  const container = document.createElement("div");
  container.innerHTML =
    "<p>First <strong>bold</strong> sentence.</p><p>Second   paragraph.</p><p>Second   paragraph.</p>";
  const text = "First bold sentence.\n\nSecond paragraph.\n\nSecond paragraph.";
  const map = captureProgressMap(container, text);
  expect(map.paragraphs.map((p) => [p.start, p.offset])).toEqual([
    [0, 0],
    [22, 18],
    [41, 35],
  ]);
  expect(toRemoteProgress(map, 26, false)).toMatchObject({
    readingProgressOffset: 18,
    readingProgressAnchor: "Second paragraph.",
  });
  expect(toRemoteProgress(map, 45, true)).toMatchObject({
    readingProgressOffset: map.totalLength,
    readingProgressPercent: 100,
  });
  expect(
    restoreReadingOffset(
      text,
      map,
      "new",
      null,
      { readingProgressOffset: 35, readingProgressAnchor: "Second paragraph.", readingProgressPercent: 60 },
      true,
    ),
  ).toBe(41);
});

test("keeps exact local word when remote matches but honors external changes, including rewinding", () => {
  const baseline = { readingProgressOffset: 20, readingProgressAnchor: "Later", readingProgressPercent: 50 };
  const local: LocalProgress = {
    fingerprint: "same",
    offset: 29,
    completed: false,
    baseline,
    remote: baseline,
    pending: false,
  };
  const map = {
    totalLength: 40,
    paragraphs: [
      { start: 0, end: 20, offset: 0, anchor: "First" },
      { start: 22, end: 40, offset: 20, anchor: "Later" },
    ],
  };
  expect(restoreReadingOffset("x".repeat(40), map, "same", local, baseline, true)).toBe(29);
  expect(
    restoreReadingOffset(
      "x".repeat(40),
      map,
      "same",
      local,
      { readingProgressOffset: 0, readingProgressAnchor: "First", readingProgressPercent: 0 },
      true,
    ),
  ).toBe(0);
  expect(restoreReadingOffset("x".repeat(40), map, "same", local, null, false)).toBe(29);
  expect(restoreReadingOffset("x".repeat(40), map, "changed", local, baseline, true)).toBe(22);
  expect(toRemoteProgress(undefined, 10, false)).toBeNull();
});
