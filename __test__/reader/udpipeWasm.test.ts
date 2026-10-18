// @vitest-environment node

import { WasmEngine } from "udpipe-node/wasm";
import { expect, test } from "vitest";
import { parseConllu } from "../../src/reader/conllu";

test("bundled UDPipe WASM model parses an English medical sentence and dependencies", () => {
  const engine = new WasmEngine();
  const output = engine.process("The treatment reduced mortality in patients with sepsis.");
  const [sentence] = parseConllu(output);

  expect(sentence.text).toBe("The treatment reduced mortality in patients with sepsis.");
  expect(sentence.words.some((word) => word.form === "treatment" && word.deprel === "nsubj")).toBe(true);
  expect(sentence.words.some((word) => word.form === "reduced" && word.deprel === "root")).toBe(true);
  expect(sentence.words.some((word) => word.form === "mortality" && word.deprel === "obj")).toBe(true);
});
