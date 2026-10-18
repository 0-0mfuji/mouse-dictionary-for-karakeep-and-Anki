import { getLocale } from "../i18n";
import {
  boundedReviewContext,
  type ComprehensionReview,
  REVIEW_CACHE_VERSION,
  type ReviewContext,
  type ReviewUsage,
} from "./comprehensionReview";

const INDEX_KEY = "reader_review_history_index_v1";
const ENTRY_PREFIX = "reader_review_history_v1_";
const MAX_ENTRIES = 100;

export type ReviewHistoryEntry = {
  id: string;
  createdAt: number;
  articleTitle: string;
  english: string;
  previous?: string;
  next?: string;
  hints: string[];
  answer: string;
  inputMethod: "text" | "voice";
  usedGloss: boolean;
  review: ComprehensionReview | null;
  usage?: ReviewUsage[];
  reviewKey?: string;
  reusedReview?: boolean;
};

export const reviewCacheKey = (
  english: string,
  answer: string,
  inputMethod: "text" | "voice",
  usedGloss: boolean,
  model: string,
  context: ReviewContext,
): string =>
  JSON.stringify([
    REVIEW_CACHE_VERSION,
    getLocale(),
    model,
    english,
    answer,
    inputMethod,
    usedGloss,
    boundedReviewContext(context),
  ]);

export const findCachedReview = async (key: string, excludeId?: string): Promise<ComprehensionReview | null> => {
  const history = await loadReviewHistory();
  return history.find((entry) => entry.id !== excludeId && entry.reviewKey === key && entry.review)?.review ?? null;
};

export const totalReviewUsage = (entries: ReviewHistoryEntry[]): Omit<ReviewUsage, "model"> & { calls: number } => {
  const total = {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  for (const entry of entries) {
    for (const usage of entry.usage ?? []) {
      total.calls++;
      total.inputTokens += usage.inputTokens;
      total.cachedInputTokens += usage.cachedInputTokens;
      total.cacheWriteTokens += usage.cacheWriteTokens;
      total.outputTokens += usage.outputTokens;
      total.reasoningTokens += usage.reasoningTokens;
    }
  }
  return total;
};

const entryKey = (id: string) => `${ENTRY_PREFIX}${id}`;
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);

const validEntry = (value: unknown): value is ReviewHistoryEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ReviewHistoryEntry>;
  return (
    validId(entry.id) &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.articleTitle === "string" &&
    typeof entry.english === "string" &&
    (entry.previous === undefined || typeof entry.previous === "string") &&
    (entry.next === undefined || typeof entry.next === "string") &&
    typeof entry.answer === "string" &&
    Array.isArray(entry.hints) &&
    entry.hints.every((hint) => typeof hint === "string") &&
    (entry.inputMethod === "text" || entry.inputMethod === "voice") &&
    typeof entry.usedGloss === "boolean" &&
    (entry.reviewKey === undefined || typeof entry.reviewKey === "string") &&
    (entry.reusedReview === undefined || typeof entry.reusedReview === "boolean") &&
    (entry.usage === undefined ||
      (Array.isArray(entry.usage) &&
        entry.usage.every(
          (usage) =>
            usage &&
            typeof usage.model === "string" &&
            [
              usage.inputTokens,
              usage.cachedInputTokens,
              usage.cacheWriteTokens,
              usage.outputTokens,
              usage.reasoningTokens,
            ].every((count) => Number.isSafeInteger(count) && count >= 0),
        ))) &&
    (entry.review === null ||
      (!!entry.review &&
        typeof entry.review.modelAnswer === "string" &&
        Array.isArray(entry.review.keyPoints) &&
        Array.isArray(entry.review.alignments) &&
        Array.isArray(entry.review.issues) &&
        Array.isArray(entry.review.nuances)))
  );
};

export const makeReviewHistoryEntry = (
  articleTitle: string,
  english: string,
  hints: string[],
  answer: string,
  inputMethod: "text" | "voice",
  usedGloss: boolean,
  context: ReviewContext = {},
  model = "gpt-6-luna",
): ReviewHistoryEntry => ({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  articleTitle,
  english,
  ...boundedReviewContext(context),
  hints,
  answer,
  inputMethod,
  usedGloss,
  reviewKey: reviewCacheKey(english, answer, inputMethod, usedGloss, model, context),
  reusedReview: false,
  review: null,
  usage: [],
});

export const saveReviewHistoryEntry = async (entry: ReviewHistoryEntry): Promise<void> => {
  await chrome.storage.local.set({ [entryKey(entry.id)]: entry });
  const stored = await chrome.storage.local.get(INDEX_KEY);
  const current = Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY].filter(validId) : [];
  const all = [entry.id, ...current.filter((id: string) => id !== entry.id)];
  const expired = all.slice(MAX_ENTRIES);
  await chrome.storage.local.set({ [INDEX_KEY]: all.slice(0, MAX_ENTRIES) });
  if (expired.length) await chrome.storage.local.remove(expired.map(entryKey));
};

export const loadReviewHistory = async (): Promise<ReviewHistoryEntry[]> => {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  const ids = Array.isArray(stored[INDEX_KEY]) ? stored[INDEX_KEY].filter(validId).slice(0, MAX_ENTRIES) : [];
  if (!ids.length) return [];
  const values = await chrome.storage.local.get(ids.map(entryKey));
  return ids
    .map((id: string) => values[entryKey(id)])
    .filter(validEntry)
    .sort((a: ReviewHistoryEntry, b: ReviewHistoryEntry) => b.createdAt - a.createdAt);
};
