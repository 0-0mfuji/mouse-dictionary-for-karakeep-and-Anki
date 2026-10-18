/**
 * Parts of a Markdown file that are not prose: frontmatter, fenced code, template shortcodes
 * ({{ }} / {% %}), HTML comments and link targets. They are never sent to the AI and never
 * checked by the local rules, so they cannot produce findings.
 */
const PATTERNS: RegExp[] = [
  /^(?:---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)|\+\+\+[ \t]*\n[\s\S]*?\n\+\+\+)[ \t]*(?:\n|$)/,
  /^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm,
  /\{\{[\s\S]*?\}\}/g,
  /\{%[\s\S]*?%\}/g,
  /<!--[\s\S]*?-->/g,
  /\]\([^)\s]*\)/g,
];

export const nonProseRanges = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))) {
      if (match[0]) ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

/** Same length as `text` (offsets are preserved); non-prose characters become spaces. */
export const maskNonProse = (text: string): string => {
  let result = "";
  let at = 0;
  for (const [start, end] of nonProseRanges(text)) {
    result += text.slice(at, start) + text.slice(start, end).replace(/[^\n]/g, " ");
    at = end;
  }
  return result + text.slice(at);
};

/** The prose only, for sending to the AI. Offsets differ, so findings are located by quote. */
export const removeNonProse = (text: string): string => {
  let result = "";
  let at = 0;
  for (const [start, end] of nonProseRanges(text)) {
    result += text.slice(at, start);
    at = end;
  }
  return (result + text.slice(at)).replace(/\n{3,}/g, "\n\n");
};
