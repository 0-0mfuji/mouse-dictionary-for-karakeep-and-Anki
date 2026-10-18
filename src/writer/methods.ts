import type { Usage } from "./critique";
import type { Mark } from "./marks";

export type MethodComparison = {
  singleTotal: number;
  passTotal: number;
  /** Findings from one method that the other method also flagged (ranges intersect). */
  singleShared: number;
  passShared: number;
  singleOnly: Mark[];
  passOnly: Mark[];
};

const overlaps = (a: Mark, b: Mark) => a.start < b.end && b.start < a.end;

/** Compares what the one-shot review and the per-pass review each found on the same text. */
export const compareMethods = (single: Mark[], pass: Mark[]): MethodComparison => {
  const singleOnly = single.filter((mark) => !pass.some((other) => overlaps(mark, other)));
  const passOnly = pass.filter((mark) => !single.some((other) => overlaps(mark, other)));
  return {
    singleTotal: single.length,
    passTotal: pass.length,
    singleShared: single.length - singleOnly.length,
    passShared: pass.length - passOnly.length,
    singleOnly,
    passOnly,
  };
};

/** Drops later marks that overlap an earlier mark of the same category (passes often agree). */
export const dedupeMarks = (marks: Mark[]): Mark[] => {
  const kept: Mark[] = [];
  for (const mark of marks) {
    if (!kept.some((other) => other.category === mark.category && overlaps(mark, other))) kept.push(mark);
  }
  return kept.sort((a, b) => a.start - b.start || b.end - a.end);
};

export type MethodResult = {
  /** The text both reviews were run on; marks are positions in this text. */
  requested: string;
  single: { marks: Mark[]; usage: Usage };
  pass: { marks: Mark[]; usage: Usage; failed: number; total: number };
  comparison: MethodComparison;
};
