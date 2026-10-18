import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLocale, initializeLocale, t } from "../i18n";
import { useLocale } from "../i18n/react";
import { ReviewResult } from "./ReviewResult";
import { loadReviewHistory, type ReviewHistoryEntry, totalReviewUsage } from "./reviewHistory";

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
const formatCount = (count: number) => new Intl.NumberFormat(getLocale()).format(count);

const UsageSummary: React.FC<{ entries: ReviewHistoryEntry[]; title: string }> = ({ entries, title }) => {
  const usage = totalReviewUsage(entries);
  return (
    <section className="review-panel history-usage" aria-label={title}>
      <h3>{title}</h3>
      {usage.calls ? (
        <div className="history-usage-grid">
          <span>
            {t("ui.api_calls")}
            <strong>
              {formatCount(usage.calls)}
              {t("ui.calls")}
            </strong>
          </span>
          <span>
            {t("ui.input")}
            <strong>{formatCount(usage.inputTokens)}</strong>
          </span>
          <span>
            {t("ui.cached_input")}
            <strong>{formatCount(usage.cachedInputTokens)}</strong>
          </span>
          <span>
            {t("ui.cache_writes")}
            <strong>{formatCount(usage.cacheWriteTokens)}</strong>
          </span>
          <span>
            {t("ui.output")}
            <strong>{formatCount(usage.outputTokens)}</strong>
          </span>
          <span>
            {t("ui.reasoning")}
            <strong>{formatCount(usage.reasoningTokens)}</strong>
          </span>
        </div>
      ) : (
        <p>{t("ui.no_usage_recorded_yet")}</p>
      )}
    </section>
  );
};

const HistoryApp: React.FC = () => {
  useLocale();
  document.title = t("ui.history_title");
  const [entries, setEntries] = useState<ReviewHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const history = await loadReviewHistory();
      setEntries(history);
      setSelectedId((current) => (history.some((entry) => entry.id === current) ? current : (history[0]?.id ?? "")));
      setError("");
    } catch {
      setError(t("ui.could_not_load_history"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some((key) => key.startsWith("reader_review_history_")))
        void reload();
    };
    const onFocus = () => void reload();
    chrome.storage.onChanged.addListener(onChange);
    window.addEventListener("focus", onFocus);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const selected = entries.find((entry) => entry.id === selectedId);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <h1 className="brand-title">{t("ui.reading_history")}</h1>
          <span className="source">{t("ui.revisit_saved_answers_and_reviews")}</span>
        </div>
        <div className="top-actions">
          <button className="button secondary" type="button" onClick={() => window.close()}>
            {t("ui.close")}
          </button>
        </div>
      </header>
      <main className="history-main">
        {error && (
          <p className="review-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">{t("ui.loading_history")}</p>
        ) : entries.length === 0 ? (
          <div className="history-empty">
            <h2>{t("ui.no_history_yet")}</h2>
            <p>{t("ui.review_an_answer_in_reader_to_save_the")}</p>
          </div>
        ) : (
          <>
            <UsageSummary entries={entries} title={t("ui.api_usage_in_saved_history")} />
            <p className="history-usage-note">{t("ui.input_and_output_are_token_counts_cache_and")}</p>
            <div className="history-layout">
              <nav className="history-list" aria-label={t("ui.answer_history")}>
                <h2>
                  {t("ui.answer_history")}
                  <small>
                    {entries.length}
                    {t("ui.entries")}
                  </small>
                </h2>
                {entries.map((entry) => (
                  <button
                    className="history-item"
                    type="button"
                    key={entry.id}
                    aria-current={selectedId === entry.id ? "true" : undefined}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <span className="history-item-meta">
                      <time dateTime={new Date(entry.createdAt).toISOString()}>{formatDate(entry.createdAt)}</time>
                      <span>
                        {entry.review?.score == null
                          ? t("ui.not_graded")
                          : t("ui.message_points", { p0: entry.review.score })}
                      </span>
                    </span>
                    <strong>{entry.articleTitle || t("ui.untitled_article")}</strong>
                    <span lang="en" className="history-item-english">
                      {entry.english}
                    </span>
                    <span className="history-item-answer">
                      {t("ui.your_answer_216")}
                      {entry.answer}
                    </span>
                  </button>
                ))}
              </nav>
              {selected && (
                <article className="history-detail" key={selected.id}>
                  <header className="history-detail-header">
                    <p>
                      <time dateTime={new Date(selected.createdAt).toISOString()}>
                        {formatDate(selected.createdAt)}
                      </time>{" "}
                      · {selected.inputMethod === "voice" ? t("ui.voice_input") : t("ui.text_input")}
                    </p>
                    <h2>{selected.articleTitle || t("ui.untitled_article")}</h2>
                    {selected.reusedReview && <small>{t("ui.reused_saved_review_no_api_request")}</small>}
                  </header>
                  <section className="review-panel history-source">
                    <h3>{t("ui.english_source")}</h3>
                    <p lang="en">{selected.english}</p>
                    {(selected.previous || selected.next) && (
                      <details className="history-context">
                        <summary>{t("ui.surrounding_sentences_used_in_the_review")}</summary>
                        {selected.previous && (
                          <p lang="en">
                            {t("ui.previous_221")}
                            {selected.previous}
                          </p>
                        )}
                        {selected.next && (
                          <p lang="en">
                            {t("ui.next_222")}
                            {selected.next}
                          </p>
                        )}
                      </details>
                    )}
                  </section>
                  <section className="review-panel history-hints">
                    <h3>{t("ui.syntax_hints")}</h3>
                    <p>{selected.hints.join(" · ") || t("ui.no_syntax_hints")}</p>
                  </section>
                  <UsageSummary entries={[selected]} title={t("ui.api_usage_for_this_answer")} />
                  {selected.review ? (
                    <ReviewResult answer={selected.answer} review={selected.review} usedGloss={selected.usedGloss} />
                  ) : (
                    <section className="review-panel">
                      <h3>{t("ui.your_answer")}</h3>
                      <p>{selected.answer}</p>
                      <small>{t("ui.this_answer_has_no_ai_review")}</small>
                    </section>
                  )}
                </article>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

const root = document.getElementById("root");
if (root) void initializeLocale().then(() => createRoot(root).render(<HistoryApp />));
