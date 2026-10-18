import { expect, test } from "vitest";
import { alignParsedSentences, type UdSentence } from "../../src/reader/readerLogic";
import { compactUrls, maskUrlsForParsing, restoreUrlOffsets } from "../../src/reader/urlText";

test("shortens a URL without changing saved source offsets", () => {
  const source = "Read https://patents.google.com/patent/US4629325 and continue.";
  const { masked, spans } = maskUrlsForParsing(source);
  expect(masked).toHaveLength(source.length);
  expect(masked).toContain("Read link ");
  expect(compactUrls(source)).toBe("Read patents.google.com/… and continue.");
  const parsed: UdSentence[] = [
    {
      text: masked,
      words: [
        { id: 1, form: "Read", lemma: "read", upos: "VERB", head: 0, deprel: "root" },
        { id: 2, form: "link", lemma: "link", upos: "NOUN", head: 1, deprel: "obj" },
        { id: 3, form: "and", lemma: "and", upos: "CCONJ", head: 1, deprel: "cc" },
        { id: 4, form: "continue", lemma: "continue", upos: "VERB", head: 1, deprel: "conj" },
      ],
    },
  ];
  const [sentence] = restoreUrlOffsets(source, alignParsedSentences(masked, parsed), spans);
  const urlWord = sentence.words[1];
  expect(urlWord).toMatchObject({ form: "patents.google.com/…", url: spans[0].url });
  expect(source.slice(urlWord.start, urlWord.end)).toBe(spans[0].url);
  expect(sentence.text).toBe(source);
});

test("keeps sentence punctuation outside a shortened URL", () => {
  const source = "See https://example.org/a?b=1. Next.";
  const { masked, spans } = maskUrlsForParsing(source);
  expect(spans[0].url).toBe("https://example.org/a?b=1");
  expect(masked.endsWith(". Next.")).toBe(true);
  expect(compactUrls(source)).toBe("See example.org/…. Next.");
});

test("extends a sentence ending at a masked URL to the original URL end", () => {
  const source = "See https://example.org/long/path";
  const { masked, spans } = maskUrlsForParsing(source);
  const parsed: UdSentence[] = [
    {
      text: "See link",
      words: [
        { id: 1, form: "See", lemma: "see", upos: "VERB", head: 0, deprel: "root" },
        { id: 2, form: "link", lemma: "link", upos: "NOUN", head: 1, deprel: "obj" },
      ],
    },
  ];
  const [sentence] = restoreUrlOffsets(source, alignParsedSentences(masked, parsed), spans);
  expect(sentence.end).toBe(source.length);
  expect(sentence.text).toBe(source);
  expect(sentence.words[1].end).toBe(source.length);
});
