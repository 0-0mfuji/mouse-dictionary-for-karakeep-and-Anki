import { expect, test } from "vitest";
import { originalTranscriptOffset, prepareTranscript } from "../../src/reader/transcript";

test("removes subtitle timestamps and joins sentences split across cues", () => {
  const source = `Transcript (en)
00:13 There are a number of 18650 drones on the market, and while they are quite fun, there is still tons of room for
00:19 improvement.
00:21 This custom quad is more durable.
02:25 Here the machine calibrates itself using this laser module.`;
  const prepared = prepareTranscript(source);
  expect(prepared.text).toBe(
    "There are a number of 18650 drones on the market, and while they are quite fun, there is still tons of room for improvement. This custom quad is more durable. Here the machine calibrates itself using this laser module.",
  );
  expect(prepared.text).not.toMatch(/\b\d{2}:\d{2}\b/);
  if (!prepared.mapping) throw new Error("Transcript mapping was not created.");
  const normalizedStart = prepared.text.indexOf("improvement.");
  expect(originalTranscriptOffset(prepared.mapping, normalizedStart)).toBe(source.indexOf("improvement."));
});

test("preserves ordinary prose and remaps Karakeep paragraph offsets for captions", () => {
  const prose = "At 02:25 the machine starts.\nIt then calibrates itself.";
  expect(prepareTranscript(prose).text).toBe(prose);

  const source = "00:08 First sentence.\n00:13 Second sentence.";
  const prepared = prepareTranscript(source, {
    paragraphs: [
      { start: 0, end: 21, offset: 0, anchor: "00:08 First sentence." },
      { start: 22, end: source.length, offset: 21, anchor: "00:13 Second sentence." },
    ],
    totalLength: source.length,
  });
  expect(prepared.text).toBe("First sentence. Second sentence.");
  expect(prepared.progressMap?.paragraphs.map(({ start, end, offset }) => [start, end, offset])).toEqual([
    [0, 15, 0],
    [16, 32, 21],
  ]);
  if (!prepared.mapping) throw new Error("Transcript mapping was not created.");
  const secondStart = prepared.text.indexOf("Second");
  expect(originalTranscriptOffset(prepared.mapping, secondStart)).toBe(source.indexOf("Second"));
});

test("reads a WebVTT cue with its time range on a separate line", () => {
  const source =
    "WEBVTT\n\n00:00:08.000 --> 00:00:13.000\nFirst sentence.\n\n00:00:13.000 --> 00:00:19.000\nSecond sentence.";
  expect(prepareTranscript(source).text).toBe("First sentence. Second sentence.");
});

test("reads timestamps on separate lines from their captions", () => {
  const source = "00:08\nFirst sentence.\n00:13\nSecond sentence.";
  expect(prepareTranscript(source).text).toBe("First sentence. Second sentence.");
});
