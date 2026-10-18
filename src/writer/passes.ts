import { t } from "../i18n";
import type { Category } from "./marks";

export type Pass = { id: string; label: string; category: Category; focus: string };

/**
 * One focused check per pass, run on top of the one-shot review. Only the checks that a real
 * comparison showed the one-shot review misses are kept; filler words, repeats, passive voice and
 * "light verb" nominalisation are handled for free by the local rules (localChecks.ts).
 */
export const PASSES: Pass[] = [
  {
    id: "metadiscourse",
    get label() {
      return t("ui.remove_preambles");
    },
    category: "wordy",
    get focus() {
      return t("ui.find_only_preambles_that_discuss_the_text_itself");
    },
  },
  {
    id: "responsibility",
    get label() {
      return t("ui.accountability");
    },
    category: "clarity",
    get focus() {
      return t("ui.find_wording_that_obscures_who_judges_claims_or");
    },
  },
  {
    id: "topic-sentence",
    get label() {
      return t("ui.paragraph_topic_sentence");
    },
    category: "structure",
    get focus() {
      return t("ui.find_paragraphs_whose_topic_is_unclear_from_the");
    },
  },
  {
    id: "topic-flow",
    get label() {
      return t("ui.topic_flow");
    },
    category: "clarity",
    get focus() {
      return t("ui.find_only_topic_jumps_where_a_sentence_does");
    },
  },
  {
    id: "verbs",
    get label() {
      return t("ui.restore_actions_to_verbs");
    },
    category: "style",
    get focus() {
      return t("ui.find_only_sentences_that_hide_actions_in_nouns");
    },
  },
];
