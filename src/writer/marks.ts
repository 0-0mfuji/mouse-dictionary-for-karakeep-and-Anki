import { t } from "../i18n";
export type Category = "style" | "wordy" | "clarity" | "structure" | "mechanics";
export const CATEGORIES: { id: Category; label: string; color: string; hint: string }[] = [
  {
    id: "style",
    get label() {
      return t("ui.style");
    },
    color: "#0B57D0",
    get hint() {
      return t("ui.passive_voice_nominalization_buried_key_points_and_preambles");
    },
  },
  {
    id: "wordy",
    get label() {
      return t("ui.wordiness");
    },
    color: "#8A5100",
    get hint() {
      return t("ui.redundancy_and_filler_words");
    },
  },
  {
    id: "clarity",
    get label() {
      return t("ui.clarity");
    },
    color: "#B3261E",
    get hint() {
      return t("ui.unclear_subjects_actors_and_sentence_connections");
    },
  },
  {
    id: "structure",
    get label() {
      return t("ui.structure");
    },
    color: "#146C2E",
    get hint() {
      return t("ui.paragraph_order_logical_gaps_and_opening_claims");
    },
  },
  {
    id: "mechanics",
    get label() {
      return t("ui.mechanics");
    },
    color: "#7D3C98",
    get hint() {
      return t("ui.typos_and_inconsistent_spelling");
    },
  },
];
export const categoryOf = (id: Category) => CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[0];

export type MarkStatus = "open" | "dismissed" | "resolved";
export type Mark = {
  id: string;
  start: number;
  end: number;
  category: Category;
  quote: string;
  reason: string;
  question: string;
  status: MarkStatus;
  /** The text inside the range was edited after the review; the underline is shown as stale. */
  edited: boolean;
  /** "local" marks are derived from the text by rules (never stored); "ai" marks come from a review. */
  source?: "ai" | "local";
  /** Local marks: stable identity (rule, quote, nth occurrence) used to remember "ignore". */
  key?: string;
  /** Rule or review pass that produced the mark. */
  rule?: string;
};

export type Finding = { quote: string; before: string; category: Category; reason: string; question: string };

/**
 * Edits are detected by diffing the old and new text (common prefix/suffix), so marks follow the
 * text they were attached to without re-running the review.
 */
export const remapMarks = (oldText: string, newText: string, marks: Mark[]): Mark[] => {
  if (oldText === newText) return marks;
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
    suffix++;
  }
  const oldEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;
  const result: Mark[] = [];
  for (const mark of marks) {
    if (mark.end <= prefix) {
      result.push(mark);
    } else if (mark.start >= oldEnd) {
      result.push({ ...mark, start: mark.start + delta, end: mark.end + delta });
    } else {
      // The edit touches the mark: keep only the untouched parts of it and flag it as stale.
      const keepsHead = mark.start < prefix;
      const keepsTail = mark.end > oldEnd;
      if (!keepsHead && !keepsTail) continue;
      result.push({
        ...mark,
        start: keepsHead ? mark.start : oldEnd + delta,
        end: keepsTail ? mark.end + delta : prefix,
        edited: true,
      });
    }
  }
  return result.map((mark) => ({ ...mark, end: Math.min(mark.end, newText.length) })).filter((m) => m.end > m.start);
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/** Resolves model quotes to exact ranges. Quotes that do not occur verbatim are discarded. */
export const locateFindings = (text: string, findings: Finding[]): Mark[] => {
  const used = new Set<string>();
  const marks: Mark[] = [];
  for (const finding of findings) {
    const quote = finding.quote;
    if (!quote || !CATEGORIES.some((category) => category.id === finding.category)) continue;
    const positions: number[] = [];
    for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) positions.push(at);
    if (!positions.length) continue;
    const before = finding.before ?? "";
    const free = positions.filter((at) => !used.has(`${at}:${quote.length}`));
    const pool = free.length ? free : positions;
    const anchored = before ? pool.find((at) => text.slice(Math.max(0, at - before.length), at) === before) : undefined;
    const at = anchored ?? pool[0];
    used.add(`${at}:${quote.length}`);
    marks.push({
      id: newId(),
      start: at,
      end: at + quote.length,
      category: finding.category,
      quote,
      reason: finding.reason,
      question: finding.question,
      status: "open",
      edited: false,
    });
  }
  return marks.sort((a, b) => a.start - b.start || b.end - a.end);
};

export type Segment = { start: number; end: number; marks: Mark[] };

/** Splits the text at every mark boundary; each segment lists the marks covering it. */
export const buildSegments = (length: number, marks: Mark[]): Segment[] => {
  const visible = marks.filter((mark) => mark.status === "open" && mark.end > mark.start);
  const points = new Set<number>([0, length]);
  for (const mark of visible) {
    points.add(Math.max(0, mark.start));
    points.add(Math.min(length, mark.end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [start, end] = [sorted[i], sorted[i + 1]];
    if (end <= start) continue;
    const covering = visible
      .filter((mark) => mark.start <= start && mark.end >= end)
      .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
    segments.push({ start, end, marks: covering });
  }
  return segments;
};

/** The innermost open mark containing the character right after the caret. */
export const markAt = (marks: Mark[], position: number): Mark | undefined =>
  marks
    .filter((mark) => mark.status === "open" && mark.start <= position && position < mark.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
