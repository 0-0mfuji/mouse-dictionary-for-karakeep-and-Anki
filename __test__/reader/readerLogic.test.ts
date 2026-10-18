import { expect, test } from "vitest";
import { parseConllu } from "../../src/reader/conllu";
import {
  alignParsedSentences,
  assignDependencyArcLanes,
  chooseGrammaticalGloss,
  getComprehensionHints,
  getCursorForOffset,
  getDependencyLabel,
  getGrammaticalGloss,
  getNearestSentenceIndex,
  getSentenceRole,
  getSentenceStartCursor,
  getWordBySourceOffset,
  getWordDelay,
  getWordGloss,
  mapDictionaryEntriesToWords,
  type UdSentence,
} from "../../src/reader/readerLogic";

const sampleConllu = `# sent_id = 1
# text = Treatment reduced mortality in patients.
1\tTreatment\ttreatment\tNOUN\tNN\t_\t2\tnsubj\t_\t_
2\treduced\treduce\tVERB\tVBD\t_\t0\troot\t_\t_
3\tmortality\tmortality\tNOUN\tNN\t_\t2\tobj\t_\t_
4\tin\tin\tADP\tIN\t_\t6\tcase\t_\t_
5\tpatients\tpatient\tNOUN\tNNS\t_\t2\tobl\t_\t_
6\t.\t.\tPUNCT\t.\t_\t2\tpunct\t_\tSpaceAfter=No

# sent_id = 2
# text = It was effective.
1\tIt\tit\tPRON\tPRP\t_\t3\tnsubj\t_\t_
2\twas\tbe\tAUX\tVBD\t_\t3\tcop\t_\t_
3\teffective\teffective\tADJ\tJJ\t_\t0\troot\t_\t_
4\t.\t.\tPUNCT\t.\t_\t3\tpunct\t_\tSpaceAfter=No
`;

test("CoNLL-U parser keeps sentence source text and dependency metadata", () => {
  const parsed = parseConllu(sampleConllu);
  expect(parsed).toHaveLength(2);
  expect(parsed[0].text).toBe("Treatment reduced mortality in patients.");
  expect(parsed[0].words[0]).toMatchObject({ id: 1, form: "Treatment", lemma: "treatment", head: 2, deprel: "nsubj" });
  expect(parsed[1].words[2]).toMatchObject({ id: 3, form: "effective", upos: "ADJ", head: 0, deprel: "root" });
});

test("parsed words align to the original article text and punctuation is excluded", () => {
  const parsed = parseConllu(sampleConllu);
  const aligned = alignParsedSentences("Intro.\nTreatment reduced mortality in patients.\nIt was effective.", parsed);
  expect(aligned).toHaveLength(3);
  expect(aligned[0]).toMatchObject({ text: "Intro.", analysisStatus: "unparsed" });
  expect(aligned[1].text).toBe("Treatment reduced mortality in patients.");
  expect(aligned[1].words.map((word) => [word.form, word.start, word.end])).toEqual([
    ["Treatment", 7, 16],
    ["reduced", 17, 24],
    ["mortality", 25, 34],
    ["in", 35, 37],
    ["patients", 38, 46],
  ]);
  expect(getWordBySourceOffset(aligned[1], 29)?.form).toBe("mortality");
});

test("word roles and RSVP pauses follow the current dependency and punctuation", () => {
  const sentence = alignParsedSentences("Treatment reduced mortality in patients.", [parseConllu(sampleConllu)[0]])[0];
  expect(sentence.words.slice(0, 3).map((word) => getSentenceRole(word, sentence))).toEqual(["S", "V", "O"]);
  expect(getWordDelay(240, ",")).toBeCloseTo(375);
  expect(getWordDelay(240, ".")).toBeCloseTo(550);
  expect(getWordDelay(240, "")).toBeCloseTo(250);
  expect(getWordDelay(240, "", { form: "dream of", members: sentence.words.slice(0, 2) })).toBeCloseTo(425);
  expect(getWordDelay(240, "", { form: "extraordinary" })).toBeGreaterThan(250);
  const copula = alignParsedSentences("It was effective.", [parseConllu(sampleConllu)[1]])[0];
  expect(getSentenceRole(copula.words[2], copula)).toBe("C");
  expect(getComprehensionHints(copula)).toEqual(["主語の中心: It", "動作・状態の中心: was effective"]);
});

test("word glosses use the first dictionary line, trim long entries, and label missing words", () => {
  expect(getWordGloss(["  mortality 【名】死亡率\n詳細な説明"])).toBe("死亡率");
  expect(getWordGloss(["A very long dictionary definition"], 12)).toBe("A very long…");
  expect(getWordGloss([])).toBe("未登録");
});

test("dependency labels are localized and overlapping arcs receive separate lanes", () => {
  expect(getDependencyLabel("nsubj")).toBe("主語");
  expect(getDependencyLabel("advmod")).toBe("副詞修飾");
  expect(
    assignDependencyArcLanes([
      { id: "subject", left: 0, right: 40 },
      { id: "modifier", left: 20, right: 60 },
      { id: "separate", left: 70, right: 100 },
    ]).map(({ id, lane }) => [id, lane]),
  ).toEqual([
    ["subject", 0],
    ["modifier", 1],
    ["separate", 0],
  ]);
});

test("complex dependencies are placed before obvious roles when arcs overlap", () => {
  expect(
    assignDependencyArcLanes([
      { id: "subject", left: 0, right: 100, priority: 0 },
      { id: "relative-clause", left: 20, right: 80, priority: 2 },
      { id: "modifier", left: 40, right: 90, priority: 1 },
    ]).map(({ id, lane }) => [id, lane]),
  ).toEqual([
    ["subject", 2],
    ["relative-clause", 0],
    ["modifier", 1],
  ]);
});

test("sentence picker maps any selected sentence to its first readable word", () => {
  const sentenceIndexes = [0, 0, 0, 1, 1, 2, 2];
  expect(getSentenceStartCursor(sentenceIndexes, 0)).toBe(0);
  expect(getSentenceStartCursor(sentenceIndexes, 1)).toBe(3);
  expect(getSentenceStartCursor(sentenceIndexes, 2)).toBe(5);
  expect(getSentenceStartCursor(sentenceIndexes, 3)).toBe(-1);
});

test("sentence picker selects the visible sentence nearest the viewport center", () => {
  const sentences = [
    { index: 0, left: 0, right: 100, top: -80, bottom: -30 },
    { index: 1, left: 0, right: 100, top: 120, bottom: 180 },
    { index: 2, left: 400, right: 600, top: 205, bottom: 255 },
    { index: 3, left: 600, right: 800, top: 350, bottom: 410 },
  ];
  expect(getNearestSentenceIndex(sentences, 500, 230, { left: 0, right: 900, top: 0, bottom: 400 })).toBe(2);
  expect(getNearestSentenceIndex(sentences, 550, 550, { left: 0, right: 900, top: 500, bottom: 600 })).toBe(-1);
  expect(
    getNearestSentenceIndex(
      [
        { index: 1, left: 80, right: 300, top: 200, bottom: 240 },
        { index: 2, left: 420, right: 620, top: 200, bottom: 240 },
      ],
      500,
      220,
      { left: 0, right: 900, top: 0, bottom: 400 },
    ),
  ).toBe(2);
});

test("EIJIRO entries map to each parsed word by surface form and lemma", () => {
  const sentence = alignParsedSentences("Patients improved.", [
    {
      text: "Patients improved.",
      words: [
        { id: 1, form: "Patients", lemma: "patient", upos: "NOUN", head: 2, deprel: "nsubj" },
        { id: 2, form: "improved", lemma: "improve", upos: "VERB", head: 0, deprel: "root" },
      ],
    },
  ])[0];
  expect(
    mapDictionaryEntriesToWords(sentence.words, {
      patient: "患者",
      improve: "改善する",
      ignored: "別の語",
    }),
  ).toEqual({ 1: ["患者"], 2: ["改善する"] });
});

test("unalignable parser sentences remain readable and are labeled", () => {
  const parsed: UdSentence[] = [{ text: "unrelated sentence", words: [] }];
  const [fallback] = alignParsedSentences("a different article", parsed);
  expect(fallback).toMatchObject({ text: "a different article", analysisStatus: "unparsed" });
  expect(fallback.words.map((word) => word.form)).toEqual(["a", "different", "article"]);
});

test("an unaligned passage between parsed sentences is preserved in place", () => {
  const source = "One. Missing text. Two.";
  const parsed: UdSentence[] = [
    { text: "One.", words: [{ id: 1, form: "One", lemma: "one", upos: "NUM", head: 0, deprel: "root" }] },
    { text: "not in source", words: [] },
    { text: "Two.", words: [{ id: 1, form: "Two", lemma: "two", upos: "NUM", head: 0, deprel: "root" }] },
  ];
  const aligned = alignParsedSentences(source, parsed);
  expect(aligned.map((sentence) => sentence.text)).toEqual(["One.", "Missing text.", "Two."]);
  expect(aligned[1].analysisStatus).toBe("unparsed");
});

test("words that fail alignment remain as fallback tokens in the original order", () => {
  const source = "We read the study carefully.";
  const parsed: UdSentence[] = [
    {
      text: source,
      words: [
        { id: 1, form: "We", lemma: "we", upos: "PRON", head: 2, deprel: "nsubj" },
        { id: 2, form: "read", lemma: "read", upos: "VERB", head: 0, deprel: "root" },
        { id: 3, form: "carefully", lemma: "carefully", upos: "ADV", head: 2, deprel: "advmod" },
      ],
    },
  ];
  const [aligned] = alignParsedSentences(source, parsed);
  expect(aligned.analysisStatus).toBe("partial");
  expect(aligned.words.map((word) => [word.form, !!word.unparsed])).toEqual([
    ["We", false],
    ["read", false],
    ["the", true],
    ["study", true],
    ["carefully", false],
  ]);
});

test("reading offset stays on the same text after dictionary phrases regroup words", () => {
  const singles = [{ word: { start: 0, end: 5 } }, { word: { start: 6, end: 8 } }, { word: { start: 9, end: 13 } }];
  const grouped = [{ word: { start: 0, end: 8 } }, { word: { start: 9, end: 13 } }];
  expect(getCursorForOffset(singles, 6)).toBe(1);
  expect(getCursorForOffset(grouped, 6)).toBe(0);
  expect(grouped[getCursorForOffset(grouped, 9)].word.start).toBe(9);
});

test("split English clitics still align to their exact source offsets", () => {
  const parsed: UdSentence[] = [
    {
      text: "The treatment didn't reduce risk.",
      words: [
        { id: 1, form: "The", lemma: "the", upos: "DET", head: 2, deprel: "det" },
        { id: 2, form: "treatment", lemma: "treatment", upos: "NOUN", head: 4, deprel: "nsubj" },
        { id: 3, form: "did", lemma: "do", upos: "AUX", head: 4, deprel: "aux" },
        { id: 4, form: "n't", lemma: "not", upos: "PART", head: 0, deprel: "root" },
        { id: 5, form: "reduce", lemma: "reduce", upos: "VERB", head: 4, deprel: "xcomp" },
        { id: 6, form: "risk", lemma: "risk", upos: "NOUN", head: 5, deprel: "obj" },
      ],
    },
  ];
  const [sentence] = alignParsedSentences("The treatment didn't reduce risk.", parsed);
  expect(sentence.words.map(({ form, start, end }) => [form, start, end])).toEqual([
    ["The", 0, 3],
    ["treatment", 4, 13],
    ["did", 14, 17],
    ["n't", 17, 20],
    ["reduce", 21, 27],
    ["risk", 28, 32],
  ]);
});

test("keeps inline Eijiro glosses short without examples or sense labels", () => {
  expect(
    getWordGloss(["{形-1} : 頭がおかしい［変で・どうかして］、気が狂って■・Are you crazy? ばかじゃないの？"]),
  ).toBe("頭がおかしい");
  expect(getWordGloss(["{1-名-1} : 〔聞こえる〕音、物音、響き、声◆可算または不可算"])).toBe("音");
  expect(getWordGloss(["{前-1} : ～について、～に関して"])).toBe("～について");
});

test("selects an Eijiro sense matching parsed POS and object relation", () => {
  const entries = ["{名-1} : 音\n{自動-1} : 鳴る\n{他動-1} : ～を鳴らす"];
  const verb = { id: 1, form: "sound", lemma: "sound", upos: "VERB", head: 0, deprel: "root", start: 0, end: 5 };
  const object = { ...verb, id: 2, form: "bell", upos: "NOUN", head: 1, deprel: "obj", start: 6, end: 10 };
  expect(getGrammaticalGloss(entries, verb, { text: "sound", start: 0, end: 5, words: [verb] })).toBe("鳴る");
  expect(getGrammaticalGloss(entries, verb, { text: "sound bell", start: 0, end: 10, words: [verb, object] })).toBe(
    "～を鳴らす",
  );
  expect(
    getGrammaticalGloss(entries, { ...verb, upos: "NOUN" }, { text: "sound", start: 0, end: 5, words: [verb] }),
  ).toBe("音");
  expect(getGrammaticalGloss(["{名} : 音"], verb, { text: "sound", start: 0, end: 5, words: [verb] })).toBe(
    "語義を確認",
  );
});

test("distinguishes a grammatical match from multiple unverified meanings", () => {
  const noun = { id: 1, form: "sound", lemma: "sound", upos: "NOUN", head: 0, deprel: "root", start: 0, end: 5 };
  const sentence = { text: "sound", start: 0, end: 5, words: [noun] };
  expect(chooseGrammaticalGloss(["{名-1} : 音"], noun, sentence)).toEqual({ gloss: "音", status: "matched" });
  expect(chooseGrammaticalGloss(["{名-1} : 音\n{名-2} : 響き"], noun, sentence)).toEqual({
    gloss: "音",
    status: "multiple",
  });
  expect(chooseGrammaticalGloss(["{動} : 鳴る"], noun, sentence)).toEqual({
    gloss: "語義を確認",
    status: "unverified",
  });
});
