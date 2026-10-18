import { t } from "../i18n";
export type ParsedWord = {
  id: number;
  form: string;
  lemma: string;
  upos: string;
  head: number;
  deprel: string;
  start: number;
  end: number;
  url?: string;
  unparsed?: boolean;
};

export type ParsedSentence = {
  text: string;
  start: number;
  end: number;
  words: ParsedWord[];
  analysisStatus?: "parsed" | "partial" | "unparsed";
};

export type UdWord = Omit<ParsedWord, "start" | "end">;
export type UdSentence = { text: string; words: UdWord[] };

const normalizeToken = (value: string): string => value.toLocaleLowerCase().replace(/[’]/g, "'");

export const getDictionaryKeys = (word: Pick<ParsedWord, "form" | "lemma">): string[] => [
  ...new Set([word.form, word.lemma, word.form.toLowerCase(), word.lemma.toLowerCase()]),
];

export const mapDictionaryEntriesToWords = (
  words: ParsedWord[],
  dictionary: Record<string, unknown>,
): Record<number, string[]> =>
  Object.fromEntries(
    words.map((word) => [
      word.id,
      getDictionaryKeys(word)
        .filter((key) => typeof dictionary[key] === "string")
        .map((key) => dictionary[key] as string),
    ]),
  );

export const alignParsedSentences = (source: string, parsed: UdSentence[]): ParsedSentence[] => {
  const result: ParsedSentence[] = [];
  let searchFrom = 0;

  const fallbackWords = (start: number, end: number, full = false): ParsedWord[] => {
    const text = source.slice(start, end);
    const pattern = full ? /\S+/gu : /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
    return [...text.matchAll(pattern)].map((match) => ({
      id: -(start + match.index + 1),
      form: match[0],
      lemma: match[0].toLowerCase(),
      upos: "X",
      head: 0,
      deprel: "unparsed",
      start: start + match.index,
      end: start + match.index + match[0].length,
      unparsed: true,
    }));
  };
  const addFallbackSentence = (start: number, end: number) => {
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    if (start < end)
      result.push({
        text: source.slice(start, end),
        start,
        end,
        words: fallbackWords(start, end, true),
        analysisStatus: "unparsed",
      });
  };

  for (const sentence of parsed) {
    const start = locateSentence(source, sentence.text, searchFrom);
    if (start < 0) continue;
    if (start > searchFrom) addFallbackSentence(searchFrom, start);
    const end = start + sentence.text.length;
    searchFrom = end;
    const sentenceSource = source.slice(start, end);
    const normalizedSource = normalizeToken(sentenceSource);
    let searchOffset = 0;
    const words: ParsedWord[] = [];
    let partial = false;

    for (const word of sentence.words) {
      if (word.upos === "PUNCT") continue;
      const expected = normalizeToken(word.form);
      const matchOffset = normalizedSource.indexOf(expected, searchOffset);
      if (matchOffset < 0) {
        partial = true;
        continue;
      }
      const preceding = fallbackWords(start + searchOffset, start + matchOffset);
      if (preceding.length) {
        words.push(...preceding);
        partial = true;
      }
      const matchEnd = matchOffset + word.form.length;
      words.push({ ...word, start: start + matchOffset, end: start + matchEnd });
      searchOffset = matchEnd;
    }
    const trailing = fallbackWords(start + searchOffset, end);
    if (trailing.length) {
      words.push(...trailing);
      partial = true;
    }
    result.push({ text: source.slice(start, end), start, end, words, analysisStatus: partial ? "partial" : "parsed" });
  }

  if (searchFrom < source.length) addFallbackSentence(searchFrom, source.length);

  return result;
};

const locateSentence = (source: string, sentence: string, from: number): number => {
  const exact = source.indexOf(sentence, from);
  if (exact >= 0) return exact;

  const normalizedSentence = sentence.replace(/\s+/g, " ").trim();
  if (!normalizedSentence) return -1;
  const tail = source.slice(from);
  const normalizedTail = tail.replace(/\s+/g, " ");
  const normalizedStart = normalizedTail.indexOf(normalizedSentence);
  if (normalizedStart < 0) return -1;

  let sourceOffset = from;
  let normalizedOffset = 0;
  while (sourceOffset < source.length && normalizedOffset < normalizedStart) {
    if (/\s/.test(source[sourceOffset])) {
      while (/\s/.test(source[sourceOffset] ?? "") && sourceOffset < source.length) sourceOffset++;
      normalizedOffset++;
    } else {
      sourceOffset++;
      normalizedOffset++;
    }
  }
  return sourceOffset;
};

export const tokenizeForRsvp = (sentence: ParsedSentence): ParsedWord[] => sentence.words;

/** Stable reading position when dictionary phrases regroup the same source text. */
export const getCursorForOffset = (words: Array<{ word: { start: number; end: number } }>, offset: number): number => {
  const found = words.findIndex(({ word }) => word.end > offset);
  return found < 0 ? Math.max(0, words.length - 1) : found;
};

export const getSentenceStartCursor = (sentenceIndexes: number[], selectedSentenceIndex: number): number =>
  sentenceIndexes.indexOf(selectedSentenceIndex);

export const getNearestSentenceIndex = (
  candidates: Array<{ index: number; left: number; right: number; top: number; bottom: number }>,
  centerX: number,
  centerY: number,
  viewport: { left: number; right: number; top: number; bottom: number },
): number => {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.bottom < viewport.top ||
      candidate.top > viewport.bottom ||
      candidate.right < viewport.left ||
      candidate.left > viewport.right
    )
      continue;
    const distance = Math.hypot(
      (candidate.left + candidate.right) / 2 - centerX,
      (candidate.top + candidate.bottom) / 2 - centerY,
    );
    if (distance < nearestDistance) {
      nearestIndex = candidate.index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
};

// Keep the full dictionary entry in the detail panel; inline glosses are only
// reading aids, not every sense and example in the dictionary.
export const getWordGloss = (entries: string[], maxLength = 12): string => {
  const gloss = entries
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((line) =>
      line
        .replace(/^.*?【(?:名|動|形|副|前|接|代|助|間)[^】]*】/, "")
        .replace(/\{[^}]*\}\s*[:：]?/g, "")
        .split(/[■◆【]/)[0]
        .replace(/〔[^〕]*〕|〈[^〉]*〉|《[^》]*》|［[^］]*］/g, "")
        .split(/[、,；;]/)[0]
        .trim(),
    )
    .find(Boolean);
  if (!gloss) return t("ui.not_found");
  return gloss.length > maxLength ? `${gloss.slice(0, maxLength - 1)}…` : gloss;
};

export const getDependencyLabel = (deprel: string): string => {
  const labels: Record<string, string> = {
    nsubj: t("ui.subject"),
    "nsubj:pass": t("ui.passive_subject"),
    csubj: t("ui.clausal_subject"),
    obj: t("ui.object"),
    iobj: t("ui.indirect_object"),
    obl: t("ui.oblique"),
    advmod: t("ui.adverbial_modifier"),
    amod: t("ui.adjectival_modifier"),
    nmod: t("ui.nominal_modifier"),
    det: t("ui.determiner"),
    case: t("ui.preposition"),
    aux: t("ui.auxiliary"),
    cop: t("ui.copula"),
    xcomp: t("ui.complement"),
    ccomp: t("ui.content_clause"),
    compound: t("ui.compound"),
    nummod: t("ui.numeric_modifier"),
    appos: t("ui.apposition"),
    conj: t("ui.conjunct"),
    cc: t("ui.conjunction"),
    mark: t("ui.clause_marker"),
    acl: t("ui.nounmodifying_clause"),
    relcl: t("ui.relative_clause"),
  };
  return labels[deprel] ?? t("ui.phrase_modifier");
};

export const assignDependencyArcLanes = <T extends { left: number; right: number }>(
  arcs: T[],
): Array<T & { lane: number }> => {
  const laneEnds: number[] = [];
  const assignments = new Map<T, number>();
  const sorted = [...arcs].sort((a, b) => {
    const priority = ("priority" in b ? Number(b.priority) : 0) - ("priority" in a ? Number(a.priority) : 0);
    return priority || a.left - b.left || a.right - b.right;
  });
  for (const arc of sorted) {
    let lane = laneEnds.findIndex((end) => arc.left >= end);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = arc.right;
    assignments.set(arc, lane);
  }
  return arcs.map((arc) => ({ ...arc, lane: assignments.get(arc) ?? 0 }));
};

export const getWordDelay = (
  wpm: number,
  nextText: string | undefined,
  unit?: { form: string; members?: ParsedWord[] },
): number => {
  const base = 60_000 / Math.max(60, Math.min(900, wpm));
  const count = unit?.members?.length ?? 1;
  const lengthBonus = Math.max(0, (unit?.form.length ?? 0) - 12) / 24;
  const unitFactor = Math.min(3.6, 1 + (count - 1) * 0.7 + lengthBonus);
  const punctuationFactor = /[.!?]$/.test(nextText ?? "") ? 2.2 : /[,;:]$/.test(nextText ?? "") ? 1.5 : 1;
  return base * unitFactor * punctuationFactor;
};

export const getSentenceRole = (word: ParsedWord, sentence: ParsedSentence): string | null => {
  if (word.deprel === "root") {
    if (word.upos === "VERB") return "V";
    if (word.upos === "ADJ" || word.upos === "NOUN" || word.upos === "PROPN") return "C";
    return null;
  }
  if (word.deprel === "nsubj" || word.deprel === "nsubj:pass" || word.deprel === "csubj") return "S";
  if (word.deprel === "obj" || word.deprel === "iobj") return "O";
  if (
    word.deprel === "xcomp" &&
    sentence.words.some((candidate) => candidate.head === word.id && candidate.deprel === "obj")
  ) {
    return "C";
  }
  if (word.deprel === "xcomp" || word.deprel === "acomp") return "C";
  return null;
};

export const getComprehensionHints = (sentence: ParsedSentence): string[] => {
  const root = sentence.words.find((word) => word.deprel === "root");
  const subjects = sentence.words.filter((word) => /^nsubj|^csubj/.test(word.deprel));
  const objects = sentence.words.filter((word) => /^(obj|iobj)$/.test(word.deprel));
  const predicate = root
    ? sentence.words
        .filter((word) => word.id === root.id || (word.head === root.id && word.deprel === "cop"))
        .sort((a, b) => a.start - b.start)
        .map((word) => word.form)
        .join(" ")
    : "";
  return [
    subjects.length ? t("ui.message_subject_head", { p0: subjects.map((word) => word.form).join(" / ") }) : "",
    predicate ? t("ui.message_action_state_head", { p0: predicate }) : "",
    objects.length ? t("ui.message_object_head", { p0: objects.map((word) => word.form).join(" / ") }) : "",
  ].filter(Boolean);
};

export const getWordBySourceOffset = (sentence: ParsedSentence, offset: number): ParsedWord | undefined =>
  sentence.words.find((word) => offset >= word.start && offset < word.end);

const senseParts = (entries: string[]): Array<{ label: string; text: string }> =>
  entries
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((line) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(?:\{([^}]+)\}\s*[:：]?\s*|【([^】]+)】\s*)/);
      return { label: match?.[1] ?? match?.[2] ?? "", text: trimmed };
    })
    .filter((item) => item.text.length > 0);

const partOfSpeechScore = (label: string, word: ParsedWord, sentence: ParsedSentence): number => {
  const hasObject = sentence.words.some(
    (candidate) => candidate.head === word.id && /^(obj|iobj)$/.test(candidate.deprel),
  );
  const rules: Record<string, RegExp> = {
    NOUN: /名|代名/,
    PROPN: /名/,
    VERB: /動/,
    AUX: /動|助動/,
    ADJ: /形/,
    ADV: /副/,
    ADP: /前/,
    CCONJ: /接/,
    SCONJ: /接/,
    PRON: /代名/,
    DET: /定|不|冠|形/,
    PART: /助|副/,
    INTJ: /間投/,
  };
  if (!rules[word.upos]?.test(label)) return -1;
  let score = 10;
  if (word.upos === "VERB") {
    if (hasObject && /他動/.test(label)) score += 4;
    if (!hasObject && /自動/.test(label)) score += 4;
  }
  if (word.upos === "AUX" && /助動/.test(label)) score += 3;
  if (word.upos === "DET" && /定|不|冠/.test(label)) score += 3;
  return score;
};

export type GlossChoice = {
  gloss: string;
  status: "matched" | "multiple" | "unverified" | "missing";
};

/** POS and transitivity narrow candidates; neither establishes semantic context. */
export const chooseGrammaticalGloss = (entries: string[], word: ParsedWord, sentence: ParsedSentence): GlossChoice => {
  const parts = senseParts(entries);
  if (!parts.length) return { gloss: t("ui.not_found"), status: "missing" };
  const ranked = parts
    .map((part, index) => ({ part, index, score: partOfSpeechScore(part.label, word, sentence) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length) {
    const top = ranked.filter((item) => item.score === ranked[0].score);
    const distinct = new Set(top.map((item) => getWordGloss([item.part.text], 200)));
    return { gloss: getWordGloss([ranked[0].part.text]), status: distinct.size > 1 ? "multiple" : "matched" };
  }
  if (parts.some((part) => part.label)) return { gloss: t("ui.check_meaning"), status: "unverified" };
  return { gloss: getWordGloss(entries), status: "unverified" };
};

export const getGrammaticalGloss = (entries: string[], word: ParsedWord, sentence: ParsedSentence): string =>
  chooseGrammaticalGloss(entries, word, sentence).gloss;
