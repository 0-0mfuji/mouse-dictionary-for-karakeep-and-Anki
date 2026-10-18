import { t } from "../i18n";
export type ReviewIssue = {
  answerQuote: string;
  sourceQuote: string;
  kind: "misunderstanding" | "missing" | "recognition";
  explanation: string;
  suggestion: string;
};

export type ReviewAlignment = { answerQuote: string; sourceQuote: string };
export type ReviewPoint = {
  sourceQuote: string;
  meaning: string;
  weight: number;
  status: "understood" | "partial" | "missing" | "misunderstood" | "uncertain";
  explanation: string;
};
export type ReviewNuance = { sourceQuote: string; explanation: string; naturalJapanese: string };
export type ReviewContext = { previous?: string; next?: string };
export type ReviewUsage = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};
// Increment when the review prompt, schema, or grading behavior changes.
export const REVIEW_CACHE_VERSION = 1;

export type ComprehensionReview = {
  score: number | null;
  scoreReason: string;
  modelAnswer: string;
  modelAnswerNote: string;
  keyPoints: ReviewPoint[];
  alignments: ReviewAlignment[];
  issues: ReviewIssue[];
  nuances: ReviewNuance[];
};

const schema = {
  type: "object",
  properties: {
    scoreReason: { type: "string" },
    modelAnswer: { type: "string" },
    modelAnswerNote: { type: "string" },
    keyPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceQuote: { type: "string" },
          meaning: { type: "string" },
          weight: { type: "integer" },
          status: { type: "string", enum: ["understood", "partial", "missing", "misunderstood", "uncertain"] },
          explanation: { type: "string" },
        },
        required: ["sourceQuote", "meaning", "weight", "status", "explanation"],
        additionalProperties: false,
      },
    },
    alignments: {
      type: "array",
      items: {
        type: "object",
        properties: { answerQuote: { type: "string" }, sourceQuote: { type: "string" } },
        required: ["answerQuote", "sourceQuote"],
        additionalProperties: false,
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          answerQuote: { type: "string" },
          sourceQuote: { type: "string" },
          kind: { type: "string", enum: ["misunderstanding", "missing", "recognition"] },
          explanation: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["answerQuote", "sourceQuote", "kind", "explanation", "suggestion"],
        additionalProperties: false,
      },
    },
    nuances: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceQuote: { type: "string" },
          explanation: { type: "string" },
          naturalJapanese: { type: "string" },
        },
        required: ["sourceQuote", "explanation", "naturalJapanese"],
        additionalProperties: false,
      },
    },
  },
  required: ["scoreReason", "modelAnswer", "modelAnswerNote", "keyPoints", "alignments", "issues", "nuances"],
  additionalProperties: false,
} as const;

export const getReviewInstructions = (): string => t("prompts.REVIEW_INSTRUCTIONS");

const outputText = (body: any): string => {
  if (body.status === "incomplete") throw new Error(t("ui.the_ai_review_was_cut_off_please_retry"));
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new Error(t("ui.no_ai_review_received"));
};

export const scoreKeyPoints = (points: ReviewPoint[]): number | null => {
  const assessed = points.filter((point) => point.status !== "uncertain");
  const total = assessed.reduce((sum, point) => sum + point.weight, 0);
  if (!total) return null;
  const earned = assessed.reduce(
    (sum, point) => sum + point.weight * (point.status === "understood" ? 1 : point.status === "partial" ? 0.5 : 0),
    0,
  );
  return Math.round((earned / total) * 100);
};

const sourceSpan = (source: string, quote: string): string => {
  const trimmed = quote.trim();
  if (!trimmed) return "";
  const index = source.toLowerCase().indexOf(trimmed.toLowerCase());
  return index < 0 ? "" : source.slice(index, index + trimmed.length);
};

const tokenCount = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export const parseReviewUsage = (body: any, requestedModel: string): ReviewUsage | null => {
  const usage = body?.usage;
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return null;
  if (usage.input_tokens < 0 || usage.output_tokens < 0) return null;
  return {
    model: typeof body.model === "string" ? body.model : requestedModel,
    inputTokens: usage.input_tokens,
    cachedInputTokens: tokenCount(usage.input_tokens_details?.cached_tokens),
    cacheWriteTokens: tokenCount(usage.input_tokens_details?.cache_write_tokens),
    outputTokens: usage.output_tokens,
    reasoningTokens: tokenCount(usage.output_tokens_details?.reasoning_tokens),
  };
};

const contextSentence = (value: string | undefined, fromEnd: boolean): string => {
  const text = value?.trim() ?? "";
  return text.length <= 500 ? text : fromEnd ? text.slice(-500) : text.slice(0, 500);
};

export const boundedReviewContext = (context: ReviewContext): ReviewContext => ({
  previous: contextSentence(context.previous, true),
  next: contextSentence(context.next, false),
});

export const reviewComprehension = async (
  english: string,
  answer: string,
  inputMethod: "voice" | "text",
  usedGloss: boolean,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  context: ReviewContext = {},
  onUsage?: (usage: ReviewUsage) => void,
): Promise<ComprehensionReview> => {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: getReviewInstructions(),
      input: JSON.stringify({
        english,
        answer,
        inputMethod,
        usedGloss,
        ...boundedReviewContext(context),
      }),
      text: { format: { type: "json_schema", name: "comprehension_review", strict: true, schema } },
      max_output_tokens: 4500,
      store: false,
    }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error(t("ui.check_your_openai_api_key"));
    if (response.status === 403) throw new Error(t("ui.check_openai_api_access_permission_and_model_access"));
    if (response.status === 429) throw new Error(t("ui.api_usage_limit_reached_please_try_again_later"));
    throw new Error(t("ui.message_ai_review_failed", { p0: response.status }));
  }
  let parsed: Omit<ComprehensionReview, "score">;
  try {
    const body = await response.json();
    const usage = parseReviewUsage(body, model);
    if (usage) onUsage?.(usage);
    parsed = JSON.parse(outputText(body)) as Omit<ComprehensionReview, "score">;
  } catch (error) {
    if (error instanceof Error && error.message.includes(t("ui.response_cut_off"))) throw error;
    throw new Error(t("ui.could_not_read_the_ai_review_please_retry"));
  }
  const statuses = new Set(["understood", "partial", "missing", "misunderstood", "uncertain"]);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.scoreReason !== "string" ||
    typeof parsed.modelAnswer !== "string" ||
    !parsed.modelAnswer.trim() ||
    typeof parsed.modelAnswerNote !== "string" ||
    !Array.isArray(parsed.keyPoints) ||
    !parsed.keyPoints.length ||
    !parsed.keyPoints.every(
      (point) =>
        point &&
        typeof point.sourceQuote === "string" &&
        point.sourceQuote.length > 0 &&
        !!sourceSpan(english, point.sourceQuote) &&
        typeof point.meaning === "string" &&
        Number.isInteger(point.weight) &&
        point.weight >= 1 &&
        point.weight <= 3 &&
        statuses.has(point.status) &&
        typeof point.explanation === "string",
    ) ||
    !Array.isArray(parsed.alignments) ||
    !Array.isArray(parsed.issues) ||
    !Array.isArray(parsed.nuances)
  ) {
    throw new Error(t("ui.invalid_ai_review_format_please_retry"));
  }
  return {
    ...parsed,
    score: scoreKeyPoints(parsed.keyPoints),
    keyPoints: parsed.keyPoints.map((point) => ({ ...point, sourceQuote: sourceSpan(english, point.sourceQuote) })),
    alignments: parsed.alignments
      .filter((item) => item && typeof item.answerQuote === "string" && typeof item.sourceQuote === "string")
      .map((item) => ({
        answerQuote: answer.includes(item.answerQuote) ? item.answerQuote : "",
        sourceQuote: sourceSpan(english, item.sourceQuote),
      }))
      .filter((item) => item.answerQuote && item.sourceQuote),
    issues: parsed.issues
      .filter(
        (issue) =>
          issue &&
          typeof issue.answerQuote === "string" &&
          typeof issue.sourceQuote === "string" &&
          typeof issue.explanation === "string" &&
          typeof issue.suggestion === "string",
      )
      .map((issue) => ({
        ...issue,
        answerQuote: answer.includes(issue.answerQuote) ? issue.answerQuote : "",
        sourceQuote: sourceSpan(english, issue.sourceQuote),
      }))
      .filter((issue) => issue.sourceQuote),
    nuances: parsed.nuances
      .filter(
        (nuance) =>
          nuance &&
          typeof nuance.sourceQuote === "string" &&
          !!sourceSpan(english, nuance.sourceQuote) &&
          typeof nuance.explanation === "string" &&
          typeof nuance.naturalJapanese === "string",
      )
      .map((nuance) => ({ ...nuance, sourceQuote: sourceSpan(english, nuance.sourceQuote) })),
  };
};
