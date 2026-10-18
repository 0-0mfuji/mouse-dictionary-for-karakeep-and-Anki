import { expect, test } from "vitest";
import type { Mark } from "../../src/writer/marks";
import { compareMethods, dedupeMarks } from "../../src/writer/methods";

const mark = (start: number, end: number, category: Mark["category"] = "style"): Mark => ({
  id: `${start}-${end}-${category}`,
  start,
  end,
  category,
  quote: "",
  reason: "",
  question: "",
  status: "open",
  edited: false,
});

test("counts shared and exclusive findings by overlapping ranges", () => {
  const result = compareMethods([mark(0, 5), mark(20, 25)], [mark(3, 8), mark(40, 45), mark(50, 55)]);
  expect(result).toMatchObject({ singleTotal: 2, passTotal: 3, singleShared: 1, passShared: 1 });
  expect(result.singleOnly.map((m) => m.start)).toEqual([20]);
  expect(result.passOnly.map((m) => m.start)).toEqual([40, 50]);
});

test("dedupe merges same-category overlaps only", () => {
  const marks = dedupeMarks([mark(0, 5), mark(3, 8), mark(3, 8, "wordy")]);
  expect(marks.map((m) => [m.start, m.category])).toEqual([
    [0, "style"],
    [3, "wordy"],
  ]);
});
