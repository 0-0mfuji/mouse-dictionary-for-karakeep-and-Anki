import type { ProgressMap } from "./readingProgress";

type Segment = { originalStart: number; originalEnd: number; normalizedStart: number; normalizedEnd: number };
export type TranscriptMapping = { originalText: string; segments: Segment[] };
export type PreparedTranscript = { text: string; progressMap?: ProgressMap; mapping?: TranscriptMapping };

const timeCode = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const timestampPrefix = new RegExp(`^${timeCode}(?:\\s+|$)`);
const timestampRange = new RegExp(`^${timeCode}\\s*-->\\s*${timeCode}(?:\\s+.*)?$`);
const transcriptHeading = /^(?:Transcript(?:\s*\([^)]*\))?|WEBVTT)$/i;

const normalizedOffset = (segments: Segment[], offset: number, endOfText: number): number => {
  for (const segment of segments) {
    if (offset < segment.originalStart) return segment.normalizedStart;
    if (offset <= segment.originalEnd) return segment.normalizedStart + offset - segment.originalStart;
  }
  return endOfText;
};

export const originalTranscriptOffset = (mapping: TranscriptMapping, offset: number): number => {
  const { segments } = mapping;
  for (const segment of segments) {
    if (offset < segment.normalizedStart) return segment.originalStart;
    if (offset <= segment.normalizedEnd) return segment.originalStart + offset - segment.normalizedStart;
  }
  return segments.at(-1)?.originalEnd ?? 0;
};

export const prepareTranscript = (text: string, progressMap?: ProgressMap): PreparedTranscript => {
  const lines = [...text.matchAll(/[^\r\n]+/g)].map((match) => ({ raw: match[0], start: match.index }));
  const nonempty = lines.map((line) => line.raw.trim()).filter(Boolean);
  const cueCount = nonempty.filter((line) => timestampPrefix.test(line) || timestampRange.test(line)).length;
  const hasHeading = nonempty.some((line) => transcriptHeading.test(line));
  const hasSrtRanges = nonempty.some((line) => timestampRange.test(line));
  const startsWithCue = timestampPrefix.test(nonempty[0] ?? "") || timestampRange.test(nonempty[0] ?? "");
  const transcriptDetected =
    cueCount >= 2 || (cueCount === 1 && (hasHeading || hasSrtRanges || (startsWithCue && nonempty.length <= 2)));
  if (!transcriptDetected) return { text, progressMap };

  const parts: string[] = [];
  const segments: Segment[] = [];
  let length = 0;
  for (const line of lines) {
    let start = line.raw.length - line.raw.trimStart().length;
    const end = line.raw.trimEnd().length;
    const trimmed = line.raw.slice(start, end);
    if (!trimmed || transcriptHeading.test(trimmed) || timestampRange.test(trimmed)) continue;
    if (hasSrtRanges && /^\d+$/.test(trimmed)) continue;
    const prefix = trimmed.match(timestampPrefix);
    if (prefix) start += prefix[0].length;
    const content = line.raw.slice(start, end);
    if (!content) continue;
    if (parts.length) {
      parts.push(" ");
      length++;
    }
    const normalizedStart = length;
    parts.push(content);
    length += content.length;
    segments.push({
      originalStart: line.start + start,
      originalEnd: line.start + end,
      normalizedStart,
      normalizedEnd: length,
    });
  }
  if (!segments.length) return { text, progressMap };
  const normalizedText = parts.join("");
  const mappedProgress = progressMap && {
    ...progressMap,
    paragraphs: progressMap.paragraphs
      .map((paragraph) => ({
        ...paragraph,
        start: normalizedOffset(segments, paragraph.start, normalizedText.length),
        end: normalizedOffset(segments, paragraph.end, normalizedText.length),
      }))
      .filter((paragraph) => paragraph.end > paragraph.start),
  };
  return {
    text: normalizedText,
    progressMap: mappedProgress,
    mapping: { originalText: text, segments },
  };
};
