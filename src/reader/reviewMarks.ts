import type { ParsedSentence } from "./readerLogic";

export type ReviewMark = { start: number; text: string };

export const reviewMarksKey = (article: { progressScope?: string; sourceUrl: string; bookmarkId: string }): string =>
  `rsvp_review_marks_v1_${article.progressScope ?? article.sourceUrl}_${article.bookmarkId}`;

export const validReviewMarks = (value: unknown, sentences: ParsedSentence[]): ReviewMark[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ReviewMark =>
      item &&
      typeof item.start === "number" &&
      typeof item.text === "string" &&
      sentences.some((sentence) => sentence.start === item.start && sentence.text === item.text),
  );
};

export const toggleReviewMark = (marks: ReviewMark[], sentence: ParsedSentence): ReviewMark[] =>
  marks.some((mark) => mark.start === sentence.start)
    ? marks.filter((mark) => mark.start !== sentence.start)
    : [...marks, { start: sentence.start, text: sentence.text }].sort((a, b) => a.start - b.start);
