import { afterEach, expect, test, vi } from "vitest";
import { compareRevisions, requestCritique, requestPasses } from "../../src/writer/critique";
import { PASSES } from "../../src/writer/passes";

const respond = (payload: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output_text: JSON.stringify(payload) }) }),
  );
afterEach(() => vi.unstubAllGlobals());

test("requires an API key and sends a strict schema without storing", async () => {
  await expect(requestCritique("t", "", "m")).rejects.toThrow("APIキー");
  respond({ findings: [] });
  await requestCritique("t", "key", "m");
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(body.store).toBe(false);
  expect(body.text.format.strict).toBe(true);
  expect(body.instructions).toContain("書き換え案");
});

test("drops malformed findings", async () => {
  respond({
    findings: [
      { quote: "a", before: "", category: "style", reason: "r", question: "q" },
      { quote: "b", before: "", category: "bogus", reason: "r", question: "q" },
    ],
  });
  expect((await requestCritique("t", "key", "m")).findings).toHaveLength(1);
});

test("comparison maps the shuffled order back to a and b", async () => {
  respond({ winner: "first", reason: "r", remaining: [] });
  expect((await compareRevisions("A", "B", "key", "m", undefined, false)).winner).toBe("a");
  respond({ winner: "first", reason: "r", remaining: [] });
  expect((await compareRevisions("A", "B", "key", "m", undefined, true)).winner).toBe("b");
  const sent = JSON.parse(JSON.parse((fetch as any).mock.calls[0][1].body).input);
  expect(sent).toEqual({ first: "B", second: "A" });
});

test("records token usage from the response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({ findings: [] }),
        usage: { input_tokens: 120, output_tokens: 30 },
      }),
    }),
  );
  expect((await requestCritique("t", "key", "m")).usage).toEqual({ calls: 1, inputTokens: 120, outputTokens: 30 });
});

test("a pass is told to look at one thing only and its findings take the pass category", async () => {
  respond({ findings: [{ quote: "a", before: "", category: "style", reason: "r", question: "q" }] });
  const pass = PASSES.find((item) => item.id === "typos") ?? PASSES[0];
  const { results } = await requestPasses("a", [pass], "key", "m");
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(body.instructions).toContain(pass.label);
  expect(body.instructions).toContain(`categoryは必ず${pass.category}`);
  expect(results[0].findings[0].category).toBe(pass.category);
});

test("a failed pass is reported while the others still return; all failing throws", async () => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        ++call === 1
          ? { ok: false, status: 500 }
          : { ok: true, json: async () => ({ output_text: JSON.stringify({ findings: [] }) }) },
      ),
  );
  const out = await requestPasses("t", PASSES.slice(0, 3), "key", "m", undefined, undefined, 1);
  expect(out.failed).toHaveLength(1);
  expect(out.results).toHaveLength(2);
  expect(out.usage.calls).toBe(2);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  await expect(requestPasses("t", PASSES.slice(0, 2), "key", "m")).rejects.toThrow("500");
});
