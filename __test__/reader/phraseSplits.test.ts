import { expect, test } from "vitest";
import { phraseSplitsKey, togglePhraseSplit, validPhraseSplits } from "../../src/reader/phraseSplits";
import type { ParsedSentence } from "../../src/reader/readerLogic";

test("split preferences are scoped to an article and discarded if its text changes", () => {
  const sentence: ParsedSentence = { text: "dreaming of home", start: 10, end: 26, words: [] };
  const split = { start: 10, end: 21, text: "dreaming of" };
  expect(phraseSplitsKey({ progressScope: "one", sourceUrl: "url", bookmarkId: "id" })).not.toBe(
    phraseSplitsKey({ progressScope: "two", sourceUrl: "url", bookmarkId: "id" }),
  );
  expect(validPhraseSplits([split, { start: 10, end: 21, text: "old version" }], [sentence])).toEqual([split]);
  expect(togglePhraseSplit([], split)).toEqual([split]);
  expect(togglePhraseSplit([split], split)).toEqual([]);
});
