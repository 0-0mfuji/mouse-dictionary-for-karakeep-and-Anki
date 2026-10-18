export type DiffOp = { type: "same" | "add" | "del"; text: string };

const paragraphs = (text: string): string[] => text.split(/\n{2,}/).filter((part) => part.trim());

/** Paragraph-level diff (LCS), enough to see what moved between revisions. */
export const diffParagraphs = (before: string, after: string): DiffOp[] => {
  const a = paragraphs(before);
  const b = paragraphs(after);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ type: "same", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
      ops.push({ type: "del", text: a[i++] });
    } else {
      ops.push({ type: "add", text: b[j++] });
    }
  }
  return ops;
};
