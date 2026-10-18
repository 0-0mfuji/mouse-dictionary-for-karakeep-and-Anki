import { expect, test } from "vitest";
import { detectLocal } from "../../src/writer/localChecks";
import { maskNonProse, removeNonProse } from "../../src/writer/prose";

const sample = [
  "+++",
  'abstract = "とても長い要約"',
  "+++",
  "",
  '本文はとても短い。{{ <word term="x" /> }}続き。',
  "",
  "```js",
  "const very = 1;",
  "```",
  "",
  "[リンク](https://example.com/very)と<!-- very -->終わり。",
].join("\n");

test("masking keeps offsets while hiding frontmatter, shortcodes, code, comments and link targets", () => {
  const masked = maskNonProse(sample);
  expect(masked).toHaveLength(sample.length);
  expect(masked).not.toMatch(/abstract|word term|const very|example\.com|<!--/);
  expect(masked).toContain("本文はとても短い。");
  expect(masked).toContain("[リンク");
});

test("removal leaves only prose", () => {
  const prose = removeNonProse(sample);
  expect(prose).toContain("本文はとても短い。続き。");
  expect(prose).not.toMatch(/abstract|word term|const very|example\.com/);
});

test("local checks ignore non-prose but still flag prose at the original offsets", () => {
  const marks = detectLocal(sample);
  expect(marks.map((mark) => mark.quote)).toEqual(["とても"]);
  expect(sample.slice(marks[0].start, marks[0].end)).toBe("とても");
});
