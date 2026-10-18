import type { ComprehensionReview } from "./comprehensionReview";

export type AnswerMarker = {
  start: number;
  end: number;
  answerQuote: string;
  sourceQuote: string;
  issueIndex: number | null;
};

export const buildAnswerMarkers = (answer: string, review: ComprehensionReview): AnswerMarker[] => {
  const issueRanges = review.issues.map((issue) => {
    const start = issue.answerQuote ? answer.indexOf(issue.answerQuote) : -1;
    return { start, end: start + issue.answerQuote.length };
  });
  const markers: AnswerMarker[] = [];
  let cursor = 0;
  for (const alignment of review.alignments) {
    if (!alignment.answerQuote || !alignment.sourceQuote) continue;
    const start = answer.indexOf(alignment.answerQuote, cursor);
    if (start < 0) continue;
    const end = start + alignment.answerQuote.length;
    const issueIndex = issueRanges.findIndex((range) => range.start >= 0 && start < range.end && end > range.start);
    markers.push({
      start,
      end,
      answerQuote: alignment.answerQuote,
      sourceQuote: alignment.sourceQuote,
      issueIndex: issueIndex < 0 ? null : issueIndex,
    });
    cursor = end;
  }
  for (const [index, issue] of review.issues.entries()) {
    const range = issueRanges[index];
    if (range.start < 0 || markers.some((marker) => marker.issueIndex === index)) continue;
    if (markers.some((marker) => range.start < marker.end && range.end > marker.start)) continue;
    markers.push({
      start: range.start,
      end: range.end,
      answerQuote: issue.answerQuote,
      sourceQuote: issue.sourceQuote,
      issueIndex: index,
    });
  }
  return markers.sort((a, b) => a.start - b.start);
};
