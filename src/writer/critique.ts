import { t } from "../i18n";
import { CATEGORIES, type Finding } from "./marks";
import type { Pass } from "./passes";

export const CRITIQUE_VERSION = 1;
export const MAX_FINDINGS = 30;

const critiqueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "before", "category", "reason", "question"],
        properties: {
          quote: { type: "string" },
          before: { type: "string" },
          category: { type: "string", enum: CATEGORIES.map((category) => category.id) },
          reason: { type: "string" },
          question: { type: "string" },
        },
      },
    },
  },
};

const compareSchema = {
  type: "object",
  additionalProperties: false,
  required: ["winner", "reason", "remaining"],
  properties: {
    winner: { type: "string", enum: ["first", "second", "tie"] },
    reason: { type: "string" },
    remaining: { type: "array", items: { type: "string" } },
  },
};

export type Usage = { calls: number; inputTokens: number; outputTokens: number };
export const emptyUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({
  calls: a.calls + b.calls,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});
const usageOf = (body: any): Usage => ({
  calls: 1,
  inputTokens: Number(body?.usage?.input_tokens) || 0,
  outputTokens: Number(body?.usage?.output_tokens) || 0,
});

export type Comparison = { winner: "a" | "b" | "tie"; reason: string; remaining: string[] };

const outputText = (body: any): string => {
  if (body?.status === "incomplete") throw new Error(t("ui.the_ai_response_was_cut_off_shorten_your"));
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "refusal") throw new Error(t("ui.ai_declined_to_review_this_manuscript"));
      if (typeof part?.text === "string") return part.text;
    }
  }
  throw new Error(t("ui.could_not_read_the_ai_response"));
};

const requestJson = async (
  instructions: string,
  input: unknown,
  name: string,
  schema: object,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ parsed: any; usage: Usage }> => {
  if (!apiKey) throw new Error(t("ui.openai_api_key_is_missing_set_it_in"));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name, strict: true, schema } },
      max_output_tokens: 9000,
      store: false,
    }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error(t("ui.check_your_openai_api_key"));
    if (response.status === 403) throw new Error(t("ui.check_openai_api_access_permission_and_model_access"));
    if (response.status === 429) throw new Error(t("ui.api_usage_limit_reached_please_try_again_later"));
    throw new Error(t("ui.message_ai_request_failed", { p0: response.status }));
  }
  const body = await response.json();
  try {
    return { parsed: JSON.parse(outputText(body)), usage: usageOf(body) };
  } catch (error) {
    if (error instanceof Error && !(error instanceof SyntaxError)) throw error;
    throw new Error(t("ui.invalid_ai_response_format_please_retry"));
  }
};

const isFinding = (value: any): value is Finding =>
  value &&
  typeof value.quote === "string" &&
  typeof value.before === "string" &&
  typeof value.reason === "string" &&
  typeof value.question === "string" &&
  CATEGORIES.some((category) => category.id === value.category);

export type CritiqueResult = { findings: Finding[]; usage: Usage };

const parseFindings = (parsed: any): Finding[] => {
  if (!Array.isArray(parsed?.findings)) throw new Error(t("ui.invalid_ai_response_format_please_retry"));
  return parsed.findings.filter(isFinding).slice(0, MAX_FINDINGS);
};

/** One request that covers every category at once. */
export const requestCritique = async (
  text: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<CritiqueResult> => {
  const { parsed, usage } = await requestJson(
    getCritiqueInstructions(),
    { manuscript: text },
    "writing_critique",
    critiqueSchema,
    apiKey,
    model,
    signal,
  );
  return { findings: parseFindings(parsed), usage };
};

export const getCritiqueInstructions = (): string =>
  t("prompts.CRITIQUE_INSTRUCTIONS", {
    RULES: t("prompts.RULES", { MAX_FINDINGS }),
    OUTPUT_NOTES: t("prompts.OUTPUT_NOTES"),
  });
export const passInstructions = (pass: Pass): string =>
  t("prompts.PASS_INSTRUCTIONS", {
    RULES: t("prompts.RULES", { MAX_FINDINGS }),
    OUTPUT_NOTES: t("prompts.OUTPUT_NOTES"),
    label: pass.label,
    focus: pass.focus,
    category: pass.category,
  });

/** One focused request for a single editing pass. */
export const requestPass = async (
  text: string,
  pass: Pass,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<CritiqueResult> => {
  const { parsed, usage } = await requestJson(
    passInstructions(pass),
    { manuscript: text },
    "writing_pass",
    critiqueSchema,
    apiKey,
    model,
    signal,
  );
  return { findings: parseFindings(parsed).map((finding) => ({ ...finding, category: pass.category })), usage };
};

export type PassResult = { pass: Pass; findings: Finding[] };
export type PassesResult = { results: PassResult[]; failed: Pass[]; usage: Usage };

/** Runs the passes with a small concurrency limit. A failed pass is reported, not fatal. */
export const requestPasses = async (
  text: string,
  passes: Pass[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  concurrency = 4,
): Promise<PassesResult> => {
  const results: PassResult[] = [];
  const failed: Pass[] = [];
  let usage = emptyUsage();
  let firstError: unknown;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < passes.length && !signal?.aborted) {
      const pass = passes[next++];
      try {
        const result = await requestPass(text, pass, apiKey, model, signal);
        results.push({ pass, findings: result.findings });
        usage = addUsage(usage, result.usage);
      } catch (error) {
        if (signal?.aborted) throw error;
        failed.push(pass);
        firstError ??= error;
      }
      onProgress?.(++done, passes.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, passes.length) }, worker));
  if (!results.length && firstError) throw firstError;
  const order = new Map(passes.map((pass, index) => [pass.id, index]));
  results.sort((a, b) => (order.get(a.pass.id) ?? 0) - (order.get(b.pass.id) ?? 0));
  return { results, failed, usage };
};

/**
 * Compares two revisions in a fresh context: no edit history, and the order is randomised so the
 * model cannot favour "the newer one". `swap` is injectable for tests.
 */
export const compareRevisions = async (
  a: string,
  b: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  swap: boolean = Math.random() < 0.5,
): Promise<Comparison> => {
  const [first, second] = swap ? [b, a] : [a, b];
  const { parsed } = await requestJson(
    t("prompts.COMPARE_INSTRUCTIONS"),
    { first, second },
    "revision_comparison",
    compareSchema,
    apiKey,
    model,
    signal,
  );
  if (
    !["first", "second", "tie"].includes(parsed?.winner) ||
    typeof parsed.reason !== "string" ||
    !Array.isArray(parsed.remaining)
  ) {
    throw new Error(t("ui.invalid_ai_response_format_please_retry"));
  }
  const winner = parsed.winner === "tie" ? "tie" : (parsed.winner === "first") !== swap ? "a" : "b";
  return {
    winner,
    reason: parsed.reason,
    remaining: parsed.remaining.filter((item: unknown) => typeof item === "string"),
  };
};
