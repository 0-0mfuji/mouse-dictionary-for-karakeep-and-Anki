import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewComprehension, scoreKeyPoints } from "../../src/reader/comprehensionReview";

afterEach(() => vi.unstubAllGlobals());

describe("reviewComprehension", () => {
  it("asks for structured meaning-based feedback and keeps voice as the input method", async () => {
    const result = {
      scoreReason: "主要な意味を捉えています",
      modelAnswer: "彼女は帰宅した。",
      modelAnswerNote: "別の自然な訳も可。",
      keyPoints: [
        { sourceQuote: "she", meaning: "彼女", weight: 1, status: "understood", explanation: "彼女と書いています" },
        {
          sourceQuote: "went home",
          meaning: "帰宅した",
          weight: 3,
          status: "partial",
          explanation: "行き先が抜けています",
        },
      ],
      alignments: [
        { answerQuote: "彼女は", sourceQuote: "She" },
        { answerQuote: "行った", sourceQuote: "went" },
      ],
      issues: [
        {
          answerQuote: "行った",
          sourceQuote: "went",
          kind: "recognition",
          explanation: "聞き取りを確認",
          suggestion: "行った",
        },
      ],
      nuances: [{ sourceQuote: "went home", explanation: "homeが行き先", naturalJapanese: "帰宅した" }],
    };
    const usage = {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 800, cache_write_tokens: 200 },
      output_tokens: 400,
      output_tokens_details: { reasoning_tokens: 150 },
    };
    const onUsage = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "gpt-6-luna",
        usage,
        output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewComprehension(
        "She went home.",
        "彼女は行った",
        "voice",
        true,
        "test-key",
        "gpt-6-luna",
        undefined,
        { previous: "It was late.", next: "She slept." },
        onUsage,
      ),
    ).resolves.toEqual({
      ...result,
      score: 63,
      keyPoints: [{ ...result.keyPoints[0], sourceQuote: "She" }, result.keyPoints[1]],
    });
    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body.model).toBe("gpt-6-luna");
    expect(JSON.parse(body.input)).toEqual({
      english: "She went home.",
      answer: "彼女は行った",
      inputMethod: "voice",
      usedGloss: true,
      previous: "It was late.",
      next: "She slept.",
    });
    expect(onUsage).toHaveBeenCalledWith({
      model: "gpt-6-luna",
      inputTokens: 1200,
      cachedInputTokens: 800,
      cacheWriteTokens: 200,
      outputTokens: 400,
      reasoningTokens: 150,
    });
    expect(body.text.format.strict).toBe(true);
    expect(body.instructions).toContain("認識ミス");
    expect(body.instructions).toContain("言い換え");
    expect(body.instructions).toContain("alignments");
    expect(body.instructions).toContain("訳を見たこと自体で減点せず");
    expect(body.instructions).toContain("模範解答");
    expect(body.instructions).toContain("採点・模範解答・修正の対象はenglishだけ");
    expect(body.store).toBe(false);
  });

  it("uses weighted points and excludes uncertain transcription from the denominator", () => {
    expect(
      scoreKeyPoints([
        { sourceQuote: "A", meaning: "A", weight: 3, status: "understood", explanation: "" },
        { sourceQuote: "B", meaning: "B", weight: 1, status: "missing", explanation: "" },
        { sourceQuote: "C", meaning: "C", weight: 3, status: "uncertain", explanation: "" },
      ]),
    ).toBe(75);
    expect(
      scoreKeyPoints([{ sourceQuote: "A", meaning: "A", weight: 3, status: "uncertain", explanation: "" }]),
    ).toBeNull();
  });

  it("rejects missing key points instead of displaying an arbitrary score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ output_text: JSON.stringify({ score: 150, issues: [] }) }),
      }),
    );
    await expect(reviewComprehension("Sentence", "回答", "text", false, "test-key", "gpt-6-luna")).rejects.toThrow(
      "講評形式",
    );
  });

  it("records returned usage even when the response is incomplete", async () => {
    const onUsage = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "incomplete", usage: { input_tokens: 100, output_tokens: 50 } }),
      }),
    );
    await expect(
      reviewComprehension(
        "She left.",
        "彼女は出発した",
        "text",
        false,
        "test-key",
        "gpt-6-luna",
        undefined,
        {},
        onUsage,
      ),
    ).rejects.toThrow("途中で切れました");
    expect(onUsage).toHaveBeenCalledWith({
      model: "gpt-6-luna",
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
    });
  });

  it("does not accept a key point quoted only from an adjacent sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            scoreReason: "",
            modelAnswer: "彼女は出発した。",
            modelAnswerNote: "",
            keyPoints: [
              { sourceQuote: "Yesterday", meaning: "昨日", weight: 1, status: "understood", explanation: "" },
            ],
            alignments: [],
            issues: [],
            nuances: [],
          }),
        }),
      }),
    );
    await expect(
      reviewComprehension("She left.", "彼女は出発した", "text", false, "test-key", "gpt-6-luna", undefined, {
        previous: "Yesterday it rained.",
      }),
    ).rejects.toThrow("講評形式");
  });
});
