import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AnswerAnnotations } from "../../src/reader/AnswerAnnotations";
import type { ComprehensionReview } from "../../src/reader/comprehensionReview";

test("shows a short Japanese marker and opens English evidence in a popover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const review: ComprehensionReview = {
    score: 60,
    scoreReason: "",
    modelAnswer: "彼女は出発した",
    modelAnswerNote: "",
    keyPoints: [
      { sourceQuote: "left", meaning: "出発した", weight: 3, status: "misunderstood", explanation: "動詞の意味が違う" },
    ],
    alignments: [
      { answerQuote: "彼女は", sourceQuote: "She" },
      { answerQuote: "残った", sourceQuote: "left" },
    ],
    issues: [
      {
        answerQuote: "残った",
        sourceQuote: "left",
        kind: "misunderstanding",
        explanation: "leftは出発したという意味です。",
        suggestion: "彼女は出発した",
      },
    ],
    nuances: [],
  };
  try {
    await act(async () => root.render(<AnswerAnnotations answer="彼女は残った" review={review} />));
    const markers = host.querySelectorAll<HTMLButtonElement>(".answer-marker");
    expect(markers).toHaveLength(2);
    expect(markers[1].querySelector("del")?.textContent).toBe("残った");
    expect(markers[1].querySelector("ins")?.textContent).toBe("出発した");
    expect(markers[1].querySelector(".answer-marker-english")).toBeNull();
    await act(async () => markers[1].click());
    expect(host.querySelector(".annotation-popover")?.textContent).toContain("leftは出発したという意味です。");
    expect(host.querySelector(".annotation-correction del")?.textContent).toBe("残った");
    expect(host.querySelector(".annotation-correction ins")?.textContent).toBe("出発した");
    await act(async () => host.querySelector<HTMLButtonElement>(".annotation-popover-close")?.click());
    expect(host.querySelector(".annotation-popover")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
