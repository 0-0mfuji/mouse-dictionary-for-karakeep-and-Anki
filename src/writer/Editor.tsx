import { type CSSProperties, Fragment, useMemo } from "react";
import { t } from "../i18n";
import { buildSegments, categoryOf, type Mark } from "./marks";

type Props = {
  text: string;
  marks: Mark[];
  activeId: string | null;
  placeholder?: string;
  onChange: (text: string) => void;
  onCaret: (position: number, collapsed: boolean) => void;
};

/** Underline offsets per overlap layer; only two layers are drawn so the line box never grows. */
const LAYER_OFFSETS = [3, 7];

const renderSegments = (text: string, marks: Mark[], activeId: string | null) =>
  buildSegments(text.length, marks).map((segment) => {
    let node: React.ReactNode = text.slice(segment.start, segment.end);
    const layers = segment.marks.slice(0, LAYER_OFFSETS.length);
    for (let layer = layers.length - 1; layer >= 0; layer--) {
      const mark = layers[layer];
      node = (
        <span
          key={mark.id}
          data-mark-id={mark.id}
          className={`ed-mark${mark.edited ? " is-edited" : ""}${mark.id === activeId ? " is-active" : ""}`}
          style={{ "--c": categoryOf(mark.category).color, "--off": `${LAYER_OFFSETS[layer]}px` } as CSSProperties}
        >
          {node}
        </span>
      );
    }
    return <Fragment key={`${segment.start}-${segment.end}`}>{node}</Fragment>;
  });

/**
 * A plain <textarea> is the only editable surface (caret, selection and IME stay native). The
 * wavy underlines live in a hidden-text mirror laid out with identical metrics; the mirror defines
 * the height and the textarea simply covers it, so nothing can drift while typing.
 */
export const Editor: React.FC<Props> = ({ text, marks, activeId, placeholder, onChange, onCaret }) => {
  const mirror = useMemo(() => renderSegments(text, marks, activeId), [text, marks, activeId]);
  const report = (target: HTMLTextAreaElement) =>
    onCaret(target.selectionStart, target.selectionStart === target.selectionEnd);
  return (
    <div className="ed-frame">
      <div className="ed-surface ed-mirror" aria-hidden="true">
        {mirror}
        {"​"}
      </div>
      <textarea
        id="writer-editor"
        className="ed-surface ed-input"
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={t("ui.manuscript")}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => report(event.currentTarget)}
        onClick={(event) => report(event.currentTarget)}
      />
    </div>
  );
};
