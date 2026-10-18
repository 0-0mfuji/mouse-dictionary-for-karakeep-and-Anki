import { afterEach, expect, test, vi } from "vitest";
import {
  findCachedReview,
  loadReviewHistory,
  type ReviewHistoryEntry,
  reviewCacheKey,
  saveReviewHistoryEntry,
  totalReviewUsage,
} from "../../src/reader/reviewHistory";

afterEach(() => vi.unstubAllGlobals());

test("keeps the answer, English, hints and later AI review in local history", async () => {
  const values = new Map<string, unknown>();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values.get(key)])),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) values.set(key, value);
        },
        remove: async (keys: string[]) => {
          for (const key of keys) values.delete(key);
        },
      },
    },
  });
  const entry: ReviewHistoryEntry = {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: 100,
    articleTitle: "記事",
    english: "She left.",
    previous: "It was late.",
    next: "She took a train.",
    hints: ["主語 She", "動詞 left"],
    answer: "彼女は残った。",
    inputMethod: "voice",
    usedGloss: false,
    review: null,
  };
  await saveReviewHistoryEntry(entry);
  expect(await loadReviewHistory()).toEqual([entry]);
  const reviewed: ReviewHistoryEntry = {
    ...entry,
    reviewKey: reviewCacheKey(entry.english, entry.answer, entry.inputMethod, entry.usedGloss, "gpt-6-luna", {
      previous: entry.previous,
      next: entry.next,
    }),
    usage: [
      {
        model: "gpt-6-luna",
        inputTokens: 1200,
        cachedInputTokens: 800,
        cacheWriteTokens: 100,
        outputTokens: 400,
        reasoningTokens: 150,
      },
    ],
    review: {
      score: 0,
      scoreReason: "動詞を取り違えています。",
      modelAnswer: "彼女は出発した。",
      modelAnswerNote: "",
      keyPoints: [],
      alignments: [],
      issues: [],
      nuances: [],
    },
  };
  await saveReviewHistoryEntry(reviewed);
  expect(await loadReviewHistory()).toEqual([reviewed]);
  expect(await findCachedReview(reviewed.reviewKey ?? "")).toEqual(reviewed.review);
  expect(await findCachedReview(reviewed.reviewKey ?? "", reviewed.id)).toBeNull();
  expect(
    await findCachedReview(
      reviewCacheKey(entry.english, entry.answer, entry.inputMethod, entry.usedGloss, "gpt-6-luna", {
        previous: "Different context.",
        next: entry.next,
      }),
    ),
  ).toBeNull();
  expect(
    await findCachedReview(
      reviewCacheKey(entry.english, entry.answer, entry.inputMethod, entry.usedGloss, "gpt-6-sol", {
        previous: entry.previous,
        next: entry.next,
      }),
    ),
  ).toBeNull();
  expect(totalReviewUsage([reviewed])).toEqual({
    calls: 1,
    inputTokens: 1200,
    cachedInputTokens: 800,
    cacheWriteTokens: 100,
    outputTokens: 400,
    reasoningTokens: 150,
  });
});
