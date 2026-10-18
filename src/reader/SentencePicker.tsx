import { useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { ParsedSentence } from "./readerLogic";
import { compactUrls } from "./urlText";

type Props = {
  sentences: ParsedSentence[];
  text: string;
  title: string;
  reviewStarts?: number[];
  initialIndex: number;
  onCancel: () => void;
  onConfirm: (index: number) => void;
};

export function SentencePicker({
  sentences,
  text,
  title,
  reviewStarts = [],
  initialIndex,
  onCancel,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState(initialIndex);
  const viewport = useRef<HTMLElement>(null);
  const items = useRef(new Map<number, HTMLSpanElement>());
  const current = useRef(initialIndex);
  const target = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const motionFrame = useRef(0);

  const interruptMotion = () => {
    cancelAnimationFrame(motionFrame.current);
    clearTimeout(timer.current);
    target.current = null;
  };

  const select = (index: number) => {
    current.current = index;
    setSelected(index);
  };
  const center = (index: number, smooth = true) => {
    const container = viewport.current;
    const element = items.current.get(index);
    if (!container || !element) return;
    interruptMotion();
    cancelAnimationFrame(frame.current);
    const rect = element.getBoundingClientRect();
    const offset = (rect.top + rect.bottom) / 2 - container.getBoundingClientRect().top - container.clientHeight / 2;
    select(index);
    if (Math.abs(offset) < 1) {
      target.current = null;
      return;
    }
    target.current = index;
    const start = container.scrollTop;
    const destination = start + offset;
    const finish = () => {
      // Keep the target through the final asynchronous scroll event.
      timer.current = setTimeout(() => {
        target.current = null;
      }, 100);
    };
    if (!smooth || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      container.scrollTo({ top: destination, behavior: "instant" });
      finish();
      return;
    }
    const duration = Math.min(520, 280 + Math.sqrt(Math.abs(offset)) * 12);
    const started = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      // A gentle deceleration settles exactly at center without overshoot.
      const eased = 1 - (1 - progress) ** 3;
      container.scrollTo({ top: start + offset * eased, behavior: "instant" });
      if (progress < 1) motionFrame.current = requestAnimationFrame(animate);
      else finish();
    };
    motionFrame.current = requestAnimationFrame(animate);
  };
  const nearest = () => {
    const container = viewport.current;
    if (!container) return current.current;
    const box = container.getBoundingClientRect();
    const centerY = box.top + container.clientHeight / 2;
    const centerX = (box.left + box.right) / 2;
    let best = current.current;
    let distance = Infinity;
    for (const [index, element] of items.current) {
      const rect = element.getBoundingClientRect();
      // Vertical distance takes precedence; horizontal position breaks ties on a shared line.
      const next =
        Math.abs((rect.top + rect.bottom) / 2 - centerY) * 10000 + Math.abs((rect.left + rect.right) / 2 - centerX);
      if (next < distance) {
        best = index;
        distance = next;
      }
    }
    return best;
  };
  const settle = () => {
    if (target.current !== null) {
      target.current = null;
      return;
    }
    center(nearest());
  };
  const onScroll = () => {
    if (target.current !== null) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (target.current === null) select(nearest());
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, 180);
  };

  useLayoutEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const resize = () => {
      container.style.setProperty("--reading-half-height", `${container.clientHeight / 2}px`);
      center(current.current, false);
    };
    resize();
    container.focus({ preventScroll: true });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(motionFrame.current);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const move = (index: number) => {
    center(Math.max(0, Math.min(sentences.length - 1, index)));
  };

  return (
    <section
      className="sentence-picker-screen"
      aria-labelledby="sentence-picker-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <header className="sentence-picker-appbar">
        <div className="sentence-picker-heading">
          <h1 id="sentence-picker-title">{t("ui.choose_a_starting_sentence")}</h1>
          <p>{title}</p>
        </div>
        <button className="button secondary" type="button" onClick={onCancel}>
          {t("ui.back")}
        </button>
      </header>
      <p className="sentence-picker-guidance" id="sentence-picker-help">
        {t("ui.scroll_to_select_click_a_sentence_or_use")}
      </p>
      <div className="sentence-picker-reading-area">
        <div className="sentence-picker-center-mark" aria-hidden="true" />
        <section
          className="sentence-picker-scroll"
          ref={viewport}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users navigate and scroll the prose region.
          tabIndex={0}
          aria-label={t("ui.article_text")}
          aria-describedby="sentence-picker-help"
          onScroll={onScroll}
          onWheel={interruptMotion}
          onTouchStart={interruptMotion}
          onPointerDown={interruptMotion}
          onKeyDown={(event) => {
            const moves: Record<string, number> = {
              ArrowDown: current.current + 1,
              ArrowUp: current.current - 1,
              Home: 0,
              End: sentences.length - 1,
            };
            if (event.key in moves) {
              event.preventDefault();
              move(moves[event.key]);
            }
            if (["PageDown", "PageUp", " "].includes(event.key)) interruptMotion();
            if (event.key === "Enter" && sentences[current.current]?.words.length) {
              event.preventDefault();
              onConfirm(current.current);
            }
          }}
        >
          <p className="sentence-picker-prose" lang="en">
            {sentences.map((sentence, index) => (
              <span key={`${sentence.start}-${index}`}>
                {compactUrls(text.slice(index === 0 ? 0 : sentences[index - 1].end, sentence.start))}
                {/* biome-ignore lint/a11y/useSemanticElements: Inline spans wrap naturally across prose lines; native buttons are atomic boxes. */}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-pressed={selected === index}
                  aria-label={t("ui.message_sentence", {
                    p0: index + 1,
                    p1: reviewStarts.includes(sentence.start) ? t("ui.marked_for_rereading") : "",
                    p2:
                      sentence.analysisStatus && sentence.analysisStatus !== "parsed"
                        ? t("ui.contains_unparsed_text")
                        : "",
                    p3: compactUrls(sentence.text),
                  })}
                  className={`sentence-option${selected === index ? " selected" : ""}`}
                  ref={(element) => {
                    if (element) items.current.set(index, element);
                    else items.current.delete(index);
                  }}
                  onClick={() => {
                    center(index);
                    viewport.current?.focus({ preventScroll: true });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === " ") {
                      event.preventDefault();
                      center(index);
                    }
                  }}
                >
                  {reviewStarts.includes(sentence.start) && (
                    <span className="sentence-review-marker">{t("ui.reread")}</span>
                  )}
                  {sentence.analysisStatus && sentence.analysisStatus !== "parsed" && (
                    <span className="sentence-analysis-marker">{t("ui.unparsed")}</span>
                  )}
                  {compactUrls(sentence.text)}
                </span>
              </span>
            ))}
          </p>
        </section>
      </div>
      <footer className="sentence-picker-footer">
        <span role="status" aria-live="polite">
          {t("ui.sentence")}
          {selected + 1} / {sentences.length}
        </span>
        <button
          className="button"
          type="button"
          disabled={!sentences[selected]?.words.length}
          onClick={() => onConfirm(current.current)}
        >
          {t("ui.start_reading_here")}
        </button>
      </footer>
    </section>
  );
}
