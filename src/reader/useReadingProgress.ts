import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import {
  fingerprintText,
  type LocalProgress,
  type ProgressMap,
  type RemoteProgress,
  restoreReadingOffset,
  sameRemoteProgress,
  toRemoteProgress,
} from "./readingProgress";

type Article = {
  bookmarkId: string;
  sourceUrl: string;
  text: string;
  progressMap?: ProgressMap;
  progressScope?: string;
};
type Word = { word: { start: number; end: number } };

export function useReadingProgress(
  article: Article | null,
  words: Word[],
  cursor: number,
  playing: boolean,
  completed: boolean,
  setCursor: (cursor: number) => void,
) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const context = useRef<{ scope: string; fingerprint: string; baseline: RemoteProgress | null } | null>(null);
  const pending = useRef<LocalProgress | null>(null);
  const busy = useRef(0);
  const previousOffset = useRef(0);
  const loadedArticle = useRef<Article | null>(null);
  const mounted = useRef(true);
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const wordsAvailable = words.length > 0;

  const flush = async (force = false) => {
    const snapshot = pending.current;
    if (!snapshot || !article || !context.current || (busy.current > 0 && !force)) return;
    busy.current++;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "rsvp_progress_save",
        bookmarkId: article.bookmarkId,
        sourceUrl: article.sourceUrl,
        scope: context.current.scope,
        local: snapshot,
      });
      if (!response?.ok) throw new Error(response?.message || t("ui.could_not_save_reading_position"));
      if (response.synced) {
        context.current.baseline = snapshot.remote;
        if (pending.current === snapshot) pending.current = null;
      }
      if (mounted.current)
        setMessage(
          response.synced
            ? t("ui.reading_position_synced_to_karakeep")
            : t("ui.message_saved_on_this_device", { p0: response.message }),
        );
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : t("ui.could_not_save_reading_position"));
    } finally {
      busy.current--;
      // A pause/close can arrive while the preceding save is in flight.
      if (busy.current === 0 && pending.current && pending.current !== snapshot) void flush();
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!article || !wordsAvailable || loadedArticle.current === article) return;
    let cancelled = false;
    void (async () => {
      try {
        const [fingerprint, result] = await Promise.all([
          fingerprintText(article.text),
          chrome.runtime.sendMessage({
            type: "rsvp_progress_load",
            bookmarkId: article.bookmarkId,
            sourceUrl: article.sourceUrl,
            scope: article.progressScope,
          }),
        ]);
        if (cancelled) return;
        if (!result?.ok) throw new Error(result?.message || t("ui.could_not_load_reading_position"));
        const offset = restoreReadingOffset(
          article.text,
          article.progressMap,
          fingerprint,
          result.local,
          result.remote,
          result.remoteAvailable,
        );
        const currentWords = wordsRef.current;
        const found = currentWords.findIndex(({ word }) => word.end > offset);
        const restored = found < 0 ? currentWords.length - 1 : found;
        previousOffset.current = currentWords[restored].word.start;
        setCursor(restored);
        context.current = {
          scope: result.scope,
          fingerprint,
          baseline: result.remoteAvailable ? result.remote : (result.local?.baseline ?? null),
        };
        if (
          result.local?.pending &&
          result.local.fingerprint === fingerprint &&
          (!result.remoteAvailable ||
            sameRemoteProgress(result.remote, result.local.baseline) ||
            sameRemoteProgress(result.remote, result.local.remote))
        ) {
          pending.current = { ...result.local, baseline: context.current.baseline };
        }
        setMessage(
          result.message
            ? t("ui.message_could_not_confirm_sync", { p0: result.message })
            : offset > 0
              ? t("ui.resume_from_your_saved_reading_position")
              : t("ui.reading_position_is_saved_automatically"),
        );
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : t("ui.could_not_load_reading_position"));
      } finally {
        if (!cancelled) {
          loadedArticle.current = article;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [article, wordsAvailable, setCursor]);

  useEffect(() => {
    if (!ready || !article || !context.current || !words[cursor]) return;
    // Merely opening the page or browsing the sentence picker never writes progress.
    const offset = words[cursor].word.start;
    if (offset !== previousOffset.current || playing || completed) {
      pending.current = {
        fingerprint: context.current.fingerprint,
        offset,
        completed,
        remote: toRemoteProgress(article.progressMap, offset, completed),
        baseline: context.current.baseline,
        pending: true,
      };
    }
    previousOffset.current = offset;
    if (!playing) void flushRef.current(true);
  }, [ready, article, words, cursor, playing, completed]);

  useEffect(() => {
    mounted.current = true;
    const save = () => {
      void flushRef.current(true);
    };
    const periodicSave = () => {
      void flushRef.current();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    const interval = window.setInterval(periodicSave, 3000);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      save();
      window.clearInterval(interval);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return { ready, message, flush };
}
