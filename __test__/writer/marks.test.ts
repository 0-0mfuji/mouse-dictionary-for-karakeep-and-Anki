import { expect, test } from "vitest";
import { diffParagraphs } from "../../src/writer/diff";
import { deriveTitle, parseMarkdown, serializeMarkdown } from "../../src/writer/markdown";
import { buildSegments, locateFindings, type Mark, markAt, remapMarks } from "../../src/writer/marks";

const mark = (start: number, end: number, extra: Partial<Mark> = {}): Mark => ({
  id: `m${start}`,
  start,
  end,
  category: "style",
  quote: "",
  reason: "",
  question: "",
  status: "open",
  edited: false,
  ...extra,
});

test("marks after an edit shift, marks before it stay", () => {
  const marks = [mark(0, 3), mark(10, 14)];
  const next = remapMarks("abc 123456 wxyz", "abc XX123456 wxyz", marks);
  expect(next.map((m) => [m.start, m.end, m.edited])).toEqual([
    [0, 3, false],
    [12, 16, false],
  ]);
});

test("typing inside a mark keeps it and flags it edited", () => {
  const [m] = remapMarks("hello world", "hello brave world", [mark(0, 11)]);
  expect([m.start, m.end, m.edited]).toEqual([0, 17, true]);
});

test("deleting the whole marked span drops the mark, replacing all text drops stale ones", () => {
  expect(remapMarks("aa bb cc", "aa  cc", [mark(3, 5)])).toEqual([]);
  expect(remapMarks("one two", "completely new", [mark(0, 3), mark(4, 7)])).toEqual([]);
});

test("partial overlap keeps the untouched part", () => {
  const [m] = remapMarks("0123456789", "0123XX6789", [mark(2, 6)]);
  expect([m.start, m.end, m.edited]).toEqual([2, 4, true]);
});

test("locateFindings uses exact quotes and the before hint, and drops unknown quotes", () => {
  const text = "very good. very bad.";
  const base = { category: "wordy" as const, reason: "r", question: "q" };
  const marks = locateFindings(text, [
    { ...base, quote: "very", before: ". " },
    { ...base, quote: "missing", before: "" },
    { ...base, quote: "very", before: "" },
  ]);
  expect(marks.map((m) => m.start)).toEqual([0, 11]);
});

test("buildSegments layers overlapping marks and skips non-open ones", () => {
  const segments = buildSegments(10, [mark(0, 6), mark(4, 10), mark(2, 3, { status: "dismissed" })]);
  expect(segments.map((s) => [s.start, s.end, s.marks.length])).toEqual([
    [0, 4, 1],
    [4, 6, 2],
    [6, 10, 1],
  ]);
  expect(markAt([mark(0, 10), mark(2, 4)], 3)?.start).toBe(2);
});

test("markdown frontmatter is separated and restored", () => {
  const raw = '﻿---\r\ntitle: "My Post"\r\n---\r\n# Heading\r\n\r\nBody';
  const doc = parseMarkdown(raw, "post.md");
  expect(doc.title).toBe("My Post");
  expect(doc.body).toBe("# Heading\n\nBody");
  expect(serializeMarkdown(doc)).toBe('---\ntitle: "My Post"\n---\n# Heading\n\nBody');
  expect(parseMarkdown("text only", "notes.md").title).toBe("notes");
  expect(deriveTitle("# 見出し\n本文")).toBe("見出し");
});

test("diffParagraphs reports added and removed paragraphs", () => {
  expect(diffParagraphs("a\n\nb\n\nc", "a\n\nB\n\nc").map((op) => op.type)).toEqual(["same", "del", "add", "same"]);
});

test("TOML frontmatter is separated like YAML", () => {
  const doc = parseMarkdown('+++\ntitle = "ブログ"\ndate = 2024-12-31\n+++\n\n本文です。', "a.md");
  expect(doc.title).toBe("ブログ");
  expect(doc.frontmatter).toBe('+++\ntitle = "ブログ"\ndate = 2024-12-31\n+++\n');
  expect(doc.body).toBe("\n本文です。");
});
