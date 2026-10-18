import { expect, test } from "vitest";
import { groupReadingWords, phraseCandidates } from "../../src/reader/phrases";
import type { ParsedSentence } from "../../src/reader/readerLogic";

const sentence: ParsedSentence = {
  text: "dreaming of home",
  start: 10,
  end: 26,
  words: [
    { id: 1, form: "dreaming", lemma: "dream", start: 10, end: 18, upos: "VERB", head: 0, deprel: "root" },
    { id: 2, form: "of", lemma: "of", start: 19, end: 21, upos: "ADP", head: 3, deprel: "case" },
    { id: 3, form: "home", lemma: "home", start: 22, end: 26, upos: "NOUN", head: 1, deprel: "obl" },
  ],
};
test("inflected phrase is one timed unit and retains members and source offsets", () => {
  const phrase = phraseCandidates(sentence).find((item) => item.keys.includes("dream of"));
  if (!phrase) throw new Error("Missing candidate");
  const units = groupReadingWords(sentence, [{ ...phrase, entries: ["～を夢見る"] }]);
  expect(units).toHaveLength(2);
  expect(units[0].form).toBe("dreaming of");
  expect(units[0].members.map((word) => word.form)).toEqual(["dreaming", "of"]);
  expect([units[0].start, units[0].end, units[1].start]).toEqual([10, 21, 22]);
  expect(units[0].phraseEntries).toEqual(["～を夢見る"]);
});
test("unknown phrases leave individual words intact", () => {
  expect(groupReadingWords(sentence, [])).toHaveLength(3);
});

test("a manual split overrides a dictionary phrase while retaining source offsets", () => {
  const phrase = phraseCandidates(sentence).find((item) => item.keys.includes("dream of"));
  if (!phrase) throw new Error("Missing candidate");
  const units = groupReadingWords(
    sentence,
    [{ ...phrase, entries: ["～を夢見る"] }],
    [{ start: 10, end: 21, text: "dreaming of" }],
  );
  expect(units.map((unit) => unit.form)).toEqual(["dreaming", "of", "home"]);
  expect(units[0].start).toBe(10);
  expect(units[1].start).toBe(19);
});

test("does not combine a subject with its predicate as a dictionary phrase", () => {
  const clause: ParsedSentence = {
    text: "the cat sleeps",
    start: 0,
    end: 14,
    words: [
      { id: 1, form: "the", lemma: "the", upos: "DET", head: 2, deprel: "det", start: 0, end: 3 },
      { id: 2, form: "cat", lemma: "cat", upos: "NOUN", head: 3, deprel: "nsubj", start: 4, end: 7 },
      { id: 3, form: "sleeps", lemma: "sleep", upos: "VERB", head: 0, deprel: "root", start: 8, end: 14 },
    ],
  };
  expect(phraseCandidates(clause).some((phrase) => phrase.text === "cat sleeps")).toBe(false);
  expect(phraseCandidates(clause).some((phrase) => phrase.text === "the cat sleeps")).toBe(false);
  expect(phraseCandidates(sentence).some((phrase) => phrase.keys.includes("dream of"))).toBe(true);
});

test("keeps contractions together without requiring a dictionary phrase", () => {
  const contracted: ParsedSentence = {
    text: "it’s",
    start: 0,
    end: 4,
    words: [
      { ...sentence.words[0], form: "it", start: 0, end: 2 },
      { ...sentence.words[1], form: "’s", start: 2, end: 4 },
    ],
  };
  expect(groupReadingWords(contracted, []).map((word) => word.form)).toEqual(["it’s"]);
});
test("groups an article with its dependency noun but stops at punctuation", () => {
  const nounPhrase: ParsedSentence = {
    text: "a year",
    start: 0,
    end: 6,
    words: [
      { ...sentence.words[0], form: "a", upos: "DET", head: 2, start: 0, end: 1 },
      { ...sentence.words[1], form: "year", upos: "NOUN", start: 2, end: 6 },
    ],
  };
  expect(groupReadingWords(nounPhrase, []).map((word) => word.form)).toEqual(["a year"]);
  expect(groupReadingWords({ ...nounPhrase, text: "a,year" }, [])).toHaveLength(2);
});

test("negative about-to construction takes priority over an inner dictionary phrase", () => {
  const forms = ["was", "n’t", "about", "to", "learn"];
  const starts = [0, 3, 7, 13, 16];
  const negative: ParsedSentence = {
    text: "wasn’t about to learn",
    start: 0,
    end: 21,
    words: forms.map((form, index) => ({
      ...sentence.words[0],
      id: index + 1,
      form,
      start: starts[index],
      end: starts[index] + form.length,
    })),
  };
  const candidate = phraseCandidates(negative).find((item) => item.keys.includes("not about to"));
  if (!candidate) throw new Error("Missing normalized candidate");
  expect(candidate.wordIds).toEqual([1, 2, 3, 4]);
  const units = groupReadingWords(negative, [
    { ...candidate, entries: ["～するつもりはない"] },
    { text: "about to", wordIds: [3, 4], keys: [], entries: ["まさに～する"] },
  ]);
  expect(units.map((word) => word.form)).toEqual(["wasn’t about to", "learn"]);
  expect(units[0].phraseEntries).toEqual(["～するつもりはない"]);
  expect(groupReadingWords(negative, [])[0].phraseEntries).toEqual([]);
  const straight = {
    ...negative,
    text: negative.text.replace(/’/g, "'"),
    words: negative.words.map((word) => ({ ...word, form: word.form.replace(/’/g, "'") })),
  };
  expect(phraseCandidates(straight).some((item) => item.keys.includes("not about to"))).toBe(true);
});
