import { t } from "../i18n";
import type { ParsedSentence } from "./readerLogic";

type UrlSpan = { start: number; end: number; url: string; display: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'“”‘’]+/gi;

const shortUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    return `${host}${parsed.pathname !== "/" || parsed.search || parsed.hash ? "/…" : ""}`;
  } catch {
    return t("ui.link");
  }
};

const urlSpans = (text: string): UrlSpan[] =>
  [...text.matchAll(URL_PATTERN)].flatMap((match) => {
    const url = match[0].replace(/[.,;:!?)}\]]+$/, "");
    if (!url) return [];
    return [{ start: match.index, end: match.index + url.length, url, display: shortUrl(url) }];
  });

/** Keep UTF-16 offsets stable so highlights and saved progress still refer to the original article. */
export const maskUrlsForParsing = (text: string): { masked: string; spans: UrlSpan[] } => {
  const spans = urlSpans(text);
  let masked = text;
  for (const span of [...spans].reverse()) {
    masked = `${masked.slice(0, span.start)}link${" ".repeat(Math.max(0, span.end - span.start - 4))}${masked.slice(span.end)}`;
  }
  return { masked, spans };
};

export const compactUrls = (text: string): string => {
  const spans = urlSpans(text);
  let result = text;
  for (const span of [...spans].reverse()) {
    result = `${result.slice(0, span.start)}${span.display}${result.slice(span.end)}`;
  }
  return result;
};

export const restoreUrlOffsets = (source: string, sentences: ParsedSentence[], spans: UrlSpan[]): ParsedSentence[] =>
  sentences.map((sentence) => {
    const words = sentence.words.map((word) => {
      const span = spans.find((item) => item.start === word.start && word.end === item.start + 4);
      return span ? { ...word, form: span.display, end: span.end, url: span.url } : word;
    });
    const end = Math.max(sentence.end, ...words.map((word) => word.end));
    return { ...sentence, text: source.slice(sentence.start, end), end, words };
  });
