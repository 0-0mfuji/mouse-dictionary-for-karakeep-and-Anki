import { describe, expect, it } from "vitest";
import { buildAnswerMarkers } from "../../src/reader/annotationRanges";
import type { ComprehensionReview } from "../../src/reader/comprehensionReview";

const review = (overrides: Partial<ComprehensionReview>): ComprehensionReview => ({
  score: 80,
  scoreReason: "",
  modelAnswer: "",
  modelAnswerNote: "",
  keyPoints: [],
  alignments: [],
  issues: [],
  nuances: [],
  ...overrides,
});

describe("buildAnswerMarkers", () => {
  it("places repeated Japanese phrases in answer order and links a correction", () => {
    const answer = "彼女は行った。彼は行った。";
    const markers = buildAnswerMarkers(
      answer,
      review({
        alignments: [
          { answerQuote: "彼女は", sourceQuote: "She" },
          { answerQuote: "行った", sourceQuote: "went" },
          { answerQuote: "彼は", sourceQuote: "He" },
          { answerQuote: "行った", sourceQuote: "stayed" },
        ],
        issues: [
          {
            answerQuote: "彼は行った",
            sourceQuote: "He stayed",
            kind: "misunderstanding",
            explanation: "動作が異なります",
            suggestion: "彼は残った",
          },
        ],
      }),
    );
    expect(markers.map((marker) => [marker.start, marker.answerQuote, marker.sourceQuote, marker.issueIndex])).toEqual([
      [0, "彼女は", "She", null],
      [3, "行った", "went", null],
      [7, "彼は", "He", 0],
      [9, "行った", "stayed", 0],
    ]);
  });

  it("adds an issue marker when the model omits its alignment", () => {
    const markers = buildAnswerMarkers(
      "彼女は残った",
      review({
        issues: [
          {
            answerQuote: "残った",
            sourceQuote: "left",
            kind: "misunderstanding",
            explanation: "",
            suggestion: "出発した",
          },
        ],
      }),
    );
    expect(markers).toEqual([{ start: 3, end: 6, answerQuote: "残った", sourceQuote: "left", issueIndex: 0 }]);
  });
});
