import type { PhraseSplit } from "./phrases";
import type { ParsedSentence } from "./readerLogic";

export const phraseSplitsKey = (article: { progressScope?: string; sourceUrl: string; bookmarkId: string }): string =>
  `rsvp_phrase_splits_v1_${article.progressScope ?? article.sourceUrl}_${article.bookmarkId}`;

export const validPhraseSplits = (value: unknown, sentences: ParsedSentence[]): PhraseSplit[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PhraseSplit =>
      item &&
      typeof item.start === "number" &&
      typeof item.end === "number" &&
      typeof item.text === "string" &&
      sentences.some(
        (sentence) =>
          item.start >= sentence.start &&
          item.end <= sentence.end &&
          item.end > item.start &&
          sentence.text.slice(item.start - sentence.start, item.end - sentence.start) === item.text,
      ),
  );
};

export const togglePhraseSplit = (splits: PhraseSplit[], phrase: PhraseSplit): PhraseSplit[] =>
  splits.some((item) => item.start === phrase.start && item.end === phrase.end)
    ? splits.filter((item) => item.start !== phrase.start || item.end !== phrase.end)
    : [...splits, phrase].sort((a, b) => a.start - b.start);
