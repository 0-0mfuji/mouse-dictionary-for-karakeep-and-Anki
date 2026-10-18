import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { buildAnswerMarkers } from "./annotationRanges";
import type { ComprehensionReview, ReviewIssue } from "./comprehensionReview";

type Selection = { type: "marker" | "issue"; index: number };
type PopoverPosition = { left: number; top?: number; bottom?: number; width: number };

const issueLabel = (issue: ReviewIssue): string =>
  issue.kind === "recognition"
    ? t("ui.check_transcription")
    : issue.kind === "missing"
      ? t("ui.missing_key_point")
      : t("ui.meaning_mismatch");

const replacementForIssue = (answer: string, issue: ReviewIssue): string => {
  if (issue.kind === "recognition" || !issue.answerQuote || !issue.suggestion.trim()) return "";
  const suggestion = issue.suggestion.trim();
  const start = answer.indexOf(issue.answerQuote);
  if (start < 0) return "";
  const prefix = answer.slice(0, start);
  const suffix = answer.slice(start + issue.answerQuote.length);
  // The model may return a whole corrected sentence. Use only the changed phrase inline.
  const isWholeAnswer =
    suggestion.startsWith(prefix) && suggestion.endsWith(suffix) && suggestion.length >= prefix.length + suffix.length;
  const replacement = isWholeAnswer ? suggestion.slice(prefix.length, suggestion.length - suffix.length) : suggestion;
  if (replacement === issue.answerQuote || replacement.includes(issue.answerQuote)) return "";
  // A full sentence that cannot be aligned is still available in the popover.
  if (!isWholeAnswer && ((prefix && suggestion.includes(prefix)) || (suffix && suggestion.includes(suffix)))) return "";
  return replacement;
};

export const AnswerAnnotations: React.FC<{ answer: string; review: ComprehensionReview }> = ({ answer, review }) => {
  const markers = useMemo(() => buildAnswerMarkers(answer, review), [answer, review]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelection(null);
  }, [review]);
  useEffect(() => {
    if (!selection) return;
    closeRef.current?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node))
        setSelection(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        triggerRef.current?.focus();
      }
    };
    const closeOnMove = () => setSelection(null);
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnMove, true);
    window.addEventListener("resize", closeOnMove);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnMove, true);
      window.removeEventListener("resize", closeOnMove);
    };
  }, [selection]);

  const openPopover = (event: React.MouseEvent<HTMLElement>, next: Selection) => {
    if (selection?.type === next.type && selection.index === next.index) {
      setSelection(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    const above = window.innerHeight - rect.bottom < 260 && rect.top > window.innerHeight - rect.bottom;
    setPosition(
      above ? { left, bottom: window.innerHeight - rect.top + 8, width } : { left, top: rect.bottom + 8, width },
    );
    triggerRef.current = event.currentTarget;
    setSelection(next);
  };

  const selectedMarker = selection?.type === "marker" ? markers[selection.index] : undefined;
  const selectedIssue =
    selection?.type === "issue"
      ? review.issues[selection.index]
      : selectedMarker?.issueIndex === null || selectedMarker?.issueIndex === undefined
        ? undefined
        : review.issues[selectedMarker.issueIndex];
  const selectedAnswer =
    selectedIssue?.answerQuote || selectedMarker?.answerQuote || t("ui.key_point_missing_from_your_answer");
  const selectedEnglish = selectedIssue?.sourceQuote || selectedMarker?.sourceQuote || "";
  const selectedPoint = review.keyPoints.find(
    (point) =>
      selectedEnglish && (point.sourceQuote.includes(selectedEnglish) || selectedEnglish.includes(point.sourceQuote)),
  );
  const selectedReplacement = selectedIssue ? replacementForIssue(answer, selectedIssue) : "";

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, marker] of markers.entries()) {
    if (marker.start > cursor) parts.push(<span key={`plain-${cursor}`}>{answer.slice(cursor, marker.start)}</span>);
    const issue = marker.issueIndex === null ? undefined : review.issues[marker.issueIndex];
    const replacement = issue ? replacementForIssue(answer, issue) : "";
    parts.push(
      <button
        key={`marker-${index}`}
        type="button"
        className={`answer-marker ${issue?.kind ?? "matched"}`}
        aria-expanded={selection?.type === "marker" && selection.index === index}
        aria-label={t("ui.message_source", {
          p0: marker.answerQuote,
          p1: replacement ? t("ui.message_", { p0: replacement }) : "",
          p2: marker.sourceQuote,
          p3: issue ? `。${issueLabel(issue)}` : "",
        })}
        onClick={(event) => openPopover(event, { type: "marker", index })}
      >
        {replacement ? (
          <>
            <del className="answer-before">{marker.answerQuote}</del>
            <ins className="answer-after">{replacement}</ins>
          </>
        ) : (
          marker.answerQuote
        )}
      </button>,
    );
    cursor = marker.end;
  }
  if (cursor < answer.length) parts.push(<span key={`plain-${cursor}`}>{answer.slice(cursor)}</span>);

  return (
    <section className="answer-annotations" aria-label={t("ui.answer_and_source_alignment")}>
      <h3>{t("ui.your_answer")}</h3>
      <p className="annotation-guidance">{t("ui.select_an_underlined_phrase_to_see_the_corresponding")}</p>
      <div className="annotated-answer">{parts.length ? parts : answer}</div>
      {review.issues.length > 0 && (
        <div className="annotation-issue-list">
          {review.issues.map((issue, index) => (
            <button
              key={index}
              type="button"
              className="annotation-issue-button"
              aria-expanded={selection?.type === "issue" && selection.index === index}
              onClick={(event) => openPopover(event, { type: "issue", index })}
            >
              <span>{issueLabel(issue)}</span>
              <strong>{issue.answerQuote || issue.sourceQuote || t("ui.full_source_text")}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="annotation-model-answer">
        <h4>{t("ui.example_model_answer")}</h4>
        <p>{review.modelAnswer}</p>
        {review.modelAnswerNote && <small>{review.modelAnswerNote}</small>}
      </div>
      {selection && position && (selectedMarker || selectedIssue) && (
        <section
          ref={popoverRef}
          className="annotation-popover"
          role="dialog"
          aria-label={selectedIssue ? issueLabel(selectedIssue) : t("ui.source_alignment")}
          style={position as CSSProperties}
        >
          <div className="annotation-popover-heading">
            <h4>{selectedIssue ? issueLabel(selectedIssue) : t("ui.source_alignment")}</h4>
            <button
              ref={closeRef}
              type="button"
              className="annotation-popover-close"
              aria-label={t("ui.close_explanation")}
              onClick={() => {
                setSelection(null);
                triggerRef.current?.focus();
              }}
            >
              {t("ui.close")}
            </button>
          </div>
          <div className="annotation-comparison">
            <div>
              <small>{selectedReplacement ? t("ui.before_after") : t("ui.your_wording")}</small>
              {selectedReplacement ? (
                <div className="annotation-correction">
                  <del className="answer-before">{selectedAnswer}</del>
                  <ins className="answer-after">{selectedReplacement}</ins>
                </div>
              ) : (
                <strong>{selectedAnswer}</strong>
              )}
            </div>
            <div>
              <small>{t("ui.corresponding_source")}</small>
              <strong lang="en">{selectedEnglish || t("ui.full_source_text")}</strong>
            </div>
          </div>
          {selectedIssue ? (
            <>
              <p>{selectedIssue.explanation}</p>
              {selectedIssue.suggestion && (
                <p className="annotation-suggestion">
                  <b>{t("ui.suggested_correction")}</b>
                  {selectedIssue.suggestion}
                </p>
              )}
            </>
          ) : (
            <p>{selectedPoint?.meaning || t("ui.this_is_the_source_text_corresponding_to_your")}</p>
          )}
        </section>
      )}
    </section>
  );
};
