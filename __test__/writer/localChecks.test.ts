import { expect, test } from "vitest";
import { detectLocal } from "../../src/writer/localChecks";

const quotes = (text: string, rule: string) =>
  detectLocal(text)
    .filter((mark) => mark.rule === rule)
    .map((mark) => mark.quote);

test("flags filler words in Japanese and English without matching inside other words", () => {
  expect(quotes("これはとても大きい。It is really very big. 事実は明白だ。", "filler語")).toEqual([
    "とても",
    "really",
    "very",
  ]);
});

test("flags English passive voice but not adjectives after non-be verbs", () => {
  expect(quotes("The result was clearly shown. We wrote it. The door is red.", "受動態")).toEqual([
    "was clearly shown",
  ]);
});

test("flags the later of two nearby repeats, not distant ones", () => {
  expect(quotes("The dormer needs a permit. The dormer is large.", "語句の反復")).toEqual(["dormer"]);
  const far = `The dormer exists. ${"x ".repeat(100)}The dormer is large.`;
  expect(quotes(far, "語句の反復")).toEqual([]);
  expect(quotes("実験の結果を示す。実験は成功した。", "語句の反復")).toEqual(["実験"]);
});

test("flags light-verb nominalisation", () => {
  expect(quotes("分析を行った結果、実験を実施する。", "名詞化")).toEqual(["分析を行った", "実験を実施する"]);
});

test("marks carry stable keys and ignored keys come back dismissed", () => {
  const text = "very good, very bad";
  const [first, second] = detectLocal(text);
  expect([first.key, second.key]).toEqual(["filler|very|0", "filler|very|1"]);
  const marks = detectLocal(text, new Set([first.key as string]));
  expect(marks.map((mark) => mark.status)).toEqual(["dismissed", "open"]);
});
