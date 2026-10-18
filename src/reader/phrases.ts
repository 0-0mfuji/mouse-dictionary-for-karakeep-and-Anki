import type { ParsedSentence } from "./readerLogic";

export type ReadingPhrase = { text: string; wordIds: number[]; keys: string[]; entries: string[] };
export type PhraseSplit = { start: number; end: number; text: string };

const crossesClauseBoundary = (words: ParsedSentence["words"]): boolean => {
  const ids = new Set(words.map((word) => word.id));
  return words.some(
    (word) => ids.has(word.head) && /^(?:nsubj(?::.*)?|csubj(?::.*)?|advcl|ccomp|acl(?::.*)?)$/.test(word.deprel),
  );
};

const normalizeForm = (value: string) => value.toLowerCase().replace(/’/g, "'");
const dictionaryForm = (word: ParsedSentence["words"][number]) => {
  const form = normalizeForm(word.form);
  if (form === "n't") return "not";
  if (form === "'re" || form === "'m") return "be";
  if (form === "'ve") return "have";
  if (form === "'ll") return "will";
  return form;
};

export const phraseCandidates = (sentence: ParsedSentence): ReadingPhrase[] => {
  const result: ReadingPhrase[] = [];
  const words = sentence.words;
  for (let start = 0; start < words.length; start++) {
    if (words[start].url || words[start].unparsed) continue;
    for (let length = 2; length <= 5 && start + length <= words.length; length++) {
      const part = words.slice(start, start + length);
      if (part.some((word) => word.url || word.unparsed)) break;
      if (crossesClauseBoundary(part)) break;
      if (
        part.some(
          (word, index) =>
            index > 0 &&
            !/^\s+$/.test(sentence.text.slice(part[index - 1].end - sentence.start, word.start - sentence.start)),
        )
      )
        break;
      const forms = part.map((word) => normalizeForm(word.form));
      const expanded = part.map(dictionaryForm);
      const lemmas = part.map((word) => normalizeForm(word.lemma));
      // Keep the written contraction intact when a dictionary phrase starts
      // at its suffix (e.g. n't about to -> not about to).
      let rangeStart = start;
      while (
        rangeStart > 0 &&
        words[rangeStart - 1].end === words[rangeStart].start &&
        /^(?:'[a-z]+|n't)$/.test(normalizeForm(words[rangeStart].form))
      )
        rangeStart--;
      const range = words.slice(rangeStart, start + length);
      result.push({
        text: sentence.text.slice(range[0].start - sentence.start, range[range.length - 1].end - sentence.start),
        wordIds: range.map((word) => word.id),
        keys: [
          ...new Set([
            forms.join(" "),
            expanded.join(" "),
            [lemmas[0], ...expanded.slice(1)].join(" "),
            lemmas.join(" "),
          ]),
        ],
        entries: [],
      });
    }
  }
  return result;
};

export const groupReadingWords = (sentence: ParsedSentence, phrases: ReadingPhrase[], splits: PhraseSplit[] = []) => {
  const result: Array<ParsedSentence["words"][number] & { members: ParsedSentence["words"]; phraseEntries: string[] }> =
    [];
  for (let index = 0; index < sentence.words.length; ) {
    const first = sentence.words[index];
    const split = splits.find((item) => first.start >= item.start && first.start < item.end);
    const phrase = phrases
      .filter(
        (item) =>
          item.wordIds[0] === first.id &&
          !split &&
          !sentence.words.some(
            (word) =>
              item.wordIds.includes(word.id) &&
              splits.some((range) => word.start >= range.start && word.start < range.end),
          ),
      )
      .sort((a, b) => b.wordIds.length - a.wordIds.length)[0];
    let length = phrase?.wordIds.length ?? 1;
    // Articles belong with their noun, including directly attached adjectives.
    if (!phrase && !split && /^(a|an|the)$/i.test(first.form)) {
      let next = index + 1;
      while (next < sentence.words.length && next - index < 4 && sentence.words[next].upos === "ADJ") next++;
      const noun = sentence.words[next];
      const part = sentence.words.slice(index, next + 1);
      if (
        noun &&
        /^(NOUN|PROPN)$/.test(noun.upos) &&
        first.head === noun.id &&
        part.every(
          (word, offset) =>
            offset === 0 ||
            /^\s+$/.test(sentence.text.slice(part[offset - 1].end - sentence.start, word.start - sentence.start)),
        )
      ) {
        length = part.length;
      }
    }
    // Never split a written contraction, even when the parser emits two tokens.
    while (index + length < sentence.words.length) {
      const previous = sentence.words[index + length - 1];
      const next = sentence.words[index + length];
      if (previous.end !== next.start || !/^(?:[’'](?:s|re|ve|ll|d|m)|n[’']t)$/i.test(next.form)) break;
      length++;
    }
    const members = sentence.words.slice(index, index + length);
    const last = members[members.length - 1];
    result.push({
      ...first,
      form:
        members.length === 1 && first.url
          ? first.form
          : sentence.text.slice(first.start - sentence.start, last.end - sentence.start),
      end: last.end,
      members,
      phraseEntries: phrase?.entries ?? [],
    });
    index += members.length;
  }
  return result;
};
