import { t } from "../i18n";
import type { Category, Mark } from "./marks";
import { maskNonProse } from "./prose";

type Rule = { id: string; label: string; category: Category; reason: string; question: string };
type Hit = { rule: Rule; start: number; end: number };

export const LOCAL_RULES: Record<string, Rule> = {
  filler: {
    id: "filler",
    get label() {
      return t("ui.filler_word");
    },
    category: "wordy",
    get reason() {
      return t("ui.this_modifier_may_add_no_meaning");
    },
    get question() {
      return t("ui.would_removing_this_word_change_the_meaning");
    },
  },
  repeat: {
    id: "repeat",
    get label() {
      return t("ui.repeated_phrase");
    },
    category: "wordy",
    get reason() {
      return t("ui.the_same_word_appears_nearby");
    },
    get question() {
      return t("ui.should_one_instance_be_rephrased_or_removed");
    },
  },
  passive: {
    id: "passive",
    get label() {
      return t("ui.passive_voice");
    },
    category: "style",
    get reason() {
      return t("ui.passive_voice_may_hide_the_person_or_organization");
    },
    get question() {
      return t("ui.who_performs_the_action_in_this_sentence");
    },
  },
  lightVerb: {
    id: "lightVerb",
    get label() {
      return t("ui.nominalization");
    },
    category: "style",
    get reason() {
      return t("ui.the_action_is_hidden_in_a_noun_with");
    },
    get question() {
      return t("ui.which_verb_expresses_this_action");
    },
  },
};

const FILLER_JA = [
  "とても",
  "非常に",
  "かなり",
  "ちょっと",
  "少し",
  "やや",
  "すごく",
  "結構",
  "実は",
  "やはり",
  "一応",
  "正直",
  "基本的に",
  "ある意味",
  "いわゆる",
];
const FILLER_EN = [
  "very",
  "really",
  "actually",
  "basically",
  "simply",
  "just",
  "quite",
  "rather",
  "somewhat",
  "fairly",
  "extremely",
  "literally",
  "definitely",
  "certainly",
  "essentially",
  "virtually",
];
const IRREGULAR = [
  "known",
  "made",
  "done",
  "given",
  "taken",
  "seen",
  "written",
  "shown",
  "found",
  "held",
  "built",
  "chosen",
  "bought",
  "brought",
  "sent",
  "kept",
  "told",
  "left",
  "set",
  "put",
  "read",
  "thought",
  "understood",
  "called",
];
const STOP_EN = new Set([
  "there",
  "their",
  "these",
  "those",
  "which",
  "would",
  "could",
  "should",
  "about",
  "other",
  "where",
  "while",
  "being",
  "after",
  "before",
  "because",
  "again",
  "still",
]);

const FILLER_RE = new RegExp(
  `(?<![一-龥々])(?:${[...FILLER_JA].sort((a, b) => b.length - a.length).join("|")})|\\b(?:${FILLER_EN.join("|")})\\b`,
  "gi",
);
const PASSIVE_RE = new RegExp(
  `\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w{3,}ed|${IRREGULAR.join("|")})\\b`,
  "gi",
);
const LIGHT_VERB_RE = /[一-龥々]{2,}[をが](?:行う|行った|行い|行って|行われ[るたて]|実施(?:する|した|し))/g;

const scan = (text: string, pattern: RegExp, rule: Rule): Hit[] =>
  [...text.matchAll(pattern)].map((match) => ({ rule, start: match.index, end: match.index + match[0].length }));

/** A word that recurs this often across the whole text is the subject matter, not a stutter. */
const TOPIC_WORD_COUNT = 4;

const repetitions = (text: string): Hit[] => {
  if (typeof Intl.Segmenter !== "function") return [];
  const words: { key: string; index: number; length: number; latin: boolean }[] = [];
  const total = new Map<string, number>();
  for (const { segment, index, isWordLike } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (!isWordLike) continue;
    const latin = /^[a-z]+$/i.test(segment);
    const eligible = latin
      ? segment.length >= 5 && !STOP_EN.has(segment.toLowerCase())
      : segment.length >= 2 && /[一-龥々ァ-ヶー]/.test(segment);
    if (!eligible) continue;
    const key = segment.toLowerCase();
    words.push({ key, index, length: segment.length, latin });
    total.set(key, (total.get(key) ?? 0) + 1);
  }
  const hits: Hit[] = [];
  const last = new Map<string, number>();
  for (const { key, index, length, latin } of words) {
    const previous = last.get(key);
    if (previous !== undefined && index - previous <= (latin ? 60 : 30) && (total.get(key) ?? 0) < TOPIC_WORD_COUNT) {
      hits.push({ rule: LOCAL_RULES.repeat, start: index, end: index + length });
    }
    last.set(key, index);
  }
  return hits;
};

/**
 * Rule-based checks for the mechanical, tiring faults. They are derived from the current text on
 * every change (nothing is stored), so the underlines can never lag behind typing. "Ignore" is
 * remembered by key: rule + quote + which occurrence of that quote it is.
 */
export const detectLocal = (text: string, dismissed: ReadonlySet<string> = new Set()): Mark[] => {
  const prose = maskNonProse(text);
  const hits = [
    ...scan(prose, FILLER_RE, LOCAL_RULES.filler),
    ...repetitions(prose),
    ...scan(prose, PASSIVE_RE, LOCAL_RULES.passive),
    ...scan(prose, LIGHT_VERB_RE, LOCAL_RULES.lightVerb),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const seen = new Map<string, number>();
  return hits.map(({ rule, start, end }) => {
    const quote = text.slice(start, end);
    const base = `${rule.id}|${quote.toLowerCase()}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    const key = `${base}|${nth}`;
    return {
      id: `local:${key}`,
      start,
      end,
      category: rule.category,
      quote,
      reason: rule.reason,
      question: rule.question,
      status: dismissed.has(key) ? "dismissed" : "open",
      edited: false,
      source: "local",
      key,
      rule: rule.label,
    } satisfies Mark;
  });
};
