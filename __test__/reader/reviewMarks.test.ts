import { expect, test } from "vitest";
import type { ParsedSentence } from "../../src/reader/readerLogic";
import { reviewMarksKey, toggleReviewMark, validReviewMarks } from "../../src/reader/reviewMarks";

test("review marks stay scoped to one article and match its current text", () => {
  const sentence: ParsedSentence = { text: "It was effective.", start: 10, end: 27, words: [] };
  expect(reviewMarksKey({ progressScope: "instance-a", sourceUrl: "https://example.com", bookmarkId: "one" })).not.toBe(
    reviewMarksKey({ progressScope: "instance-b", sourceUrl: "https://example.com", bookmarkId: "one" }),
  );
  const added = toggleReviewMark([], sentence);
  expect(added).toEqual([{ start: 10, text: sentence.text }]);
  expect(toggleReviewMark(added, sentence)).toEqual([]);
  expect(validReviewMarks([...added, { start: 20, text: "stale" }], [sentence])).toEqual(added);
});
