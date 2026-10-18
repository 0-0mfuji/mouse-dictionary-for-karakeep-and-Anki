import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLocale, initializeLocale, t } from "../i18n";
import { useLocale } from "../i18n/react";
import { compareRevisions, requestCritique, requestPasses } from "./critique";
import { diffParagraphs } from "./diff";
import { Editor } from "./Editor";
import { detectLocal } from "./localChecks";
import { MethodsPanel } from "./MethodsPanel";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { CATEGORIES, type Category, categoryOf, locateFindings, type Mark, markAt, remapMarks } from "./marks";
import { compareMethods, dedupeMarks, type MethodResult } from "./methods";
import { PASSES } from "./passes";
import { removeNonProse } from "./prose";
import {
  type ComparisonRecord,
  deleteDoc,
  getDoc,
  listComparisons,
  listDocs,
  listRevisions,
  newId,
  putComparison,
  putDoc,
  putRevision,
  type Revision,
  type WriterDoc,
} from "./store";
import { runTournament, type Tournament } from "./tournament";

const LAST_DOC_KEY = "writer_last_doc";
const SAVE_DELAY = 600;
const CURRENT = "current";
const MAX_PICKED = 2;

type ReviewMode = "combined" | "single" | "passes";
type Settings = { apiKey: string; model: string };
type Editing = {
  id: string;
  title: string;
  frontmatter: string;
  source?: string;
  text: string;
  marks: Mark[];
  localDismissed: string[];
};

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(timestamp);

const loadSettings = async (): Promise<Settings> => {
  try {
    const [stored, local] = await Promise.all([
      chrome.storage.sync.get("**** config ****"),
      chrome.storage.local.get("reader_openai_api_key"),
    ]);
    const config = JSON.parse(typeof stored["**** config ****"] === "string" ? stored["**** config ****"] : "{}");
    return {
      apiKey: typeof local.reader_openai_api_key === "string" ? local.reader_openai_api_key : "",
      model: typeof config.openaiModel === "string" && config.openaiModel ? config.openaiModel : "gpt-6-luna",
    };
  } catch {
    return { apiKey: "", model: "gpt-6-luna" };
  }
};

const download = (name: string, content: string, type = "text/markdown;charset=utf-8") => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const WriterApp: React.FC = () => {
  useLocale();
  document.title = t("ui.writing_mouse_dictionary");
  const [docs, setDocs] = useState<WriterDoc[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [settings, setSettings] = useState<Settings>({ apiKey: "", model: "gpt-6-luna" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Set<Category>>(new Set(CATEGORIES.map((category) => category.id)));
  const [showHandled, setShowHandled] = useState(false);
  const [tab, setTab] = useState<"findings" | "revisions">("findings");
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [busy, setBusy] = useState<"" | "review" | "compare" | "methods">("");
  const [mode, setMode] = useState<ReviewMode>("combined");
  const [methodResult, setMethodResult] = useState<MethodResult | null>(null);
  const [savedComparisons, setSavedComparisons] = useState<ComparisonRecord[]>([]);
  const [loadedComparison, setLoadedComparison] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const editingRef = useRef<Editing | null>(null);
  editingRef.current = editing;

  const refreshDocs = useCallback(async () => setDocs(await listDocs()), []);

  const persist = useCallback(async () => {
    const current = editingRef.current;
    if (!current) return;
    await putDoc({
      id: current.id,
      title: current.title,
      frontmatter: current.frontmatter,
      body: current.text,
      marks: current.marks,
      localDismissed: current.localDismissed,
      updatedAt: Date.now(),
      source: current.source,
    });
    await refreshDocs();
  }, [refreshDocs]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(), SAVE_DELAY);
  }, [persist]);

  const openDoc = useCallback(
    async (id: string) => {
      window.clearTimeout(saveTimer.current);
      await persist();
      const doc = await getDoc(id);
      if (!doc) return;
      setEditing({
        id: doc.id,
        title: doc.title,
        frontmatter: doc.frontmatter,
        source: doc.source,
        text: doc.body,
        marks: doc.marks,
        localDismissed: doc.localDismissed ?? [],
      });
      setRevisions(await listRevisions(doc.id));
      setSavedComparisons(await listComparisons(doc.id));
      setLoadedComparison(null);
      setActiveId(null);
      setPicked([]);
      setTournament(null);
      setMethodResult(null);
      setPreviewId(null);
      setStatus(null);
      setDrawer(null);
      try {
        localStorage.setItem(LAST_DOC_KEY, id);
      } catch {
        /* Storage may be unavailable. */
      }
    },
    [persist],
  );

  const createDoc = useCallback(
    async (init: { title?: string; frontmatter?: string; body?: string; source?: string } = {}) => {
      const doc: WriterDoc = {
        id: newId(),
        title: init.title ?? t("ui.untitled"),
        frontmatter: init.frontmatter ?? "",
        body: init.body ?? "",
        marks: [],
        updatedAt: Date.now(),
        source: init.source,
      };
      await putDoc(doc);
      await refreshDocs();
      return doc.id;
    },
    [refreshDocs],
  );

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings());
      const all = await listDocs();
      setDocs(all);
      let last = "";
      try {
        last = localStorage.getItem(LAST_DOC_KEY) ?? "";
      } catch {
        /* ignore */
      }
      const target = all.find((doc) => doc.id === last)?.id ?? all[0]?.id ?? (await createDoc());
      await openDoc(target);
    })();
    const onChanged = () => void loadSettings().then(setSettings);
    chrome.storage.onChanged.addListener(onChanged);
    const flush = () => void persist();
    window.addEventListener("pagehide", flush);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const changeText = useCallback(
    (next: string) => {
      setEditing((current) =>
        current ? { ...current, text: next, marks: remapMarks(current.text, next, current.marks) } : current,
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const setMarkStatus = (mark: Mark, status: Mark["status"]) => {
    setEditing((current) => {
      if (!current) return current;
      if (mark.source === "local" && mark.key) {
        const rest = current.localDismissed.filter((key) => key !== mark.key);
        return { ...current, localDismissed: status === "dismissed" ? [...rest, mark.key] : rest };
      }
      return { ...current, marks: current.marks.map((item) => (item.id === mark.id ? { ...item, status } : item)) };
    });
    scheduleSave();
  };

  const selectMark = (mark: Mark, focusEditor: boolean) => {
    setActiveId(mark.id);
    if (!focusEditor) return;
    const input = document.getElementById("writer-editor") as HTMLTextAreaElement | null;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(mark.start, mark.end);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-mark-id="${CSS.escape(mark.id)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };

  const snapshot = useCallback(async (label: string, major = false) => {
    const current = editingRef.current;
    if (!current || !current.text.trim()) return;
    const [latest] = await listRevisions(current.id);
    if (latest && latest.body === current.text && !major) return;
    await putRevision({ id: newId(), docId: current.id, createdAt: Date.now(), body: current.text, label, major });
    setRevisions(await listRevisions(current.id));
  }, []);

  /** Replaces the AI marks with `located` (found in `requested`), keeping what the writer dismissed. */
  const applyMarks = (requested: string, located: Mark[]) => {
    const current = editingRef.current;
    if (!current) return;
    setEditing((now) => {
      if (!now || now.id !== current.id) return now;
      const dismissed = now.marks.filter((mark) => mark.status === "dismissed");
      const skip = new Set(dismissed.map((mark) => `${mark.category}|${mark.quote}`));
      const fresh = remapMarks(
        requested,
        now.text,
        located.filter((mark) => !skip.has(`${mark.category}|${mark.quote}`)),
      );
      return { ...now, marks: [...dismissed, ...fresh] };
    });
    scheduleSave();
    setTab("findings");
    setActiveId(null);
  };

  const withBusy = async (kind: "review" | "methods", work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(kind);
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus({ text: error instanceof Error ? error.message : String(error), error: true });
      } else {
        setStatus(null);
      }
    } finally {
      setBusy("");
      abortRef.current = null;
    }
  };

  const tagPasses = (requested: string, results: Awaited<ReturnType<typeof requestPasses>>["results"]): Mark[] =>
    dedupeMarks(
      results.flatMap(({ pass, findings }) =>
        locateFindings(requested, findings).map((mark) => ({ ...mark, rule: pass.label })),
      ),
    );

  const runReview = async () => {
    const current = editingRef.current;
    if (!current || busy) return;
    if (!current.text.trim()) return setStatus({ text: t("ui.the_manuscript_is_empty"), error: true });
    const requested = current.text;
    // Frontmatter, code, shortcodes and link targets are not prose; they are never sent.
    const prose = removeNonProse(requested);
    if (!prose.trim()) return setStatus({ text: t("ui.no_manuscript_available_to_review"), error: true });
    setStatus({ text: t("ui.reading_manuscript") });
    await withBusy("review", async (signal) => {
      await snapshot(t("ui.before_review"));
      const onProgress = (done: number, total: number) =>
        setStatus({ text: t("ui.message_reviewing_individual_categories", { p0: done, p1: total }) });
      const [single, passes] = await Promise.all([
        mode === "passes" ? null : requestCritique(prose, settings.apiKey, settings.model, signal),
        mode === "single" ? null : requestPasses(prose, PASSES, settings.apiKey, settings.model, signal, onProgress),
      ]);
      const singleMarks = single ? locateFindings(requested, single.findings) : [];
      const passMarks = passes ? tagPasses(requested, passes.results) : [];
      // The one-shot findings come first, so they win where a pass flags the same spot.
      const located = dedupeMarks([...singleMarks, ...passMarks]);
      const note = passes?.failed.length ? t("ui.message_categories_failed", { p0: passes.failed.length }) : "";
      applyMarks(requested, located);
      setStatus({
        text: located.length
          ? t("ui.message_findings_ai_findings_are_a_guide_the", { p0: located.length, p1: note })
          : t("ui.message_no_findings", { p0: note }),
      });
    });
  };

  const runMethodComparison = async () => {
    const current = editingRef.current;
    if (!current || busy) return;
    if (!current.text.trim()) return setStatus({ text: t("ui.the_manuscript_is_empty"), error: true });
    const requested = current.text;
    const prose = removeNonProse(requested);
    setMethodResult(null);
    setStatus({ text: t("ui.reviewing_with_both_combined_and_individual_passes") });
    await withBusy("methods", async (signal) => {
      await snapshot(t("ui.before_method_comparison"));
      const [single, passes] = await Promise.all([
        requestCritique(prose, settings.apiKey, settings.model, signal),
        requestPasses(prose, PASSES, settings.apiKey, settings.model, signal, (done, total) =>
          setStatus({
            text: t("ui.message_reviewing_passes_combined_review_running_in_parallel", { p0: done, p1: total }),
          }),
        ),
      ]);
      const singleMarks = locateFindings(requested, single.findings);
      const passMarks = tagPasses(requested, passes.results);
      const result: MethodResult = {
        requested,
        single: { marks: singleMarks, usage: single.usage },
        pass: {
          marks: passMarks,
          usage: passes.usage,
          failed: passes.failed.length,
          total: PASSES.length,
        },
        comparison: compareMethods(singleMarks, passMarks),
      };
      setMethodResult(result);
      const record: ComparisonRecord = {
        id: newId(),
        docId: current.id,
        docTitle: current.title,
        createdAt: Date.now(),
        model: settings.model,
        result,
      };
      setLoadedComparison(record.id);
      try {
        await putComparison(record);
        setSavedComparisons(await listComparisons(current.id));
        setStatus({ text: t("ui.comparison_saved_automatically_open_it_from_saved_comparisons") });
      } catch {
        setStatus({ text: t("ui.could_not_save_comparison"), error: true });
      }
    });
  };

  const bodyOf = (id: string): string =>
    id === CURRENT ? (editingRef.current?.text ?? "") : (revisions.find((revision) => revision.id === id)?.body ?? "");

  const runCompare = async () => {
    if (picked.length !== 2 || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const bodies = new Map(picked.map((id) => [id, removeNonProse(bodyOf(id))]));
    setBusy("compare");
    setTournament(null);
    setStatus({ text: t("ui.comparing_two_revisions_in_a_fresh_context_without") });
    try {
      const result = await runTournament(picked, (a, b) =>
        compareRevisions(bodies.get(a) ?? "", bodies.get(b) ?? "", settings.apiKey, settings.model, controller.signal),
      );
      setTournament(result);
      setStatus(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus({ text: error instanceof Error ? error.message : String(error), error: true });
      }
    } finally {
      setBusy("");
      abortRef.current = null;
    }
  };

  const importFiles = async (files: FileList | File[]) => {
    let last = "";
    for (const file of Array.from(files)) {
      if (!/\.(md|markdown|mdx|txt)$/i.test(file.name) && !file.type.startsWith("text/")) continue;
      const parsed = parseMarkdown(await file.text(), file.name);
      last = await createDoc({ ...parsed, source: file.name });
    }
    if (last) await openDoc(last);
    else setStatus({ text: t("ui.no_readable_markdown_or_text_file_found"), error: true });
  };

  const exportMarkdown = () => {
    if (!editing) return;
    download(
      `${editing.source?.replace(/\.[^.]+$/, "") || editing.title || "document"}.md`,
      serializeMarkdown({ frontmatter: editing.frontmatter, body: editing.text }),
    );
  };
  const copyMarkdown = async () => {
    if (!editing) return;
    try {
      await navigator.clipboard.writeText(serializeMarkdown({ frontmatter: editing.frontmatter, body: editing.text }));
      setStatus({ text: t("ui.markdown_copied") });
    } catch {
      setStatus({ text: t("ui.could_not_copy"), error: true });
    }
  };

  const removeDoc = async (id: string) => {
    if (!window.confirm(t("ui.delete_this_document_and_its_revision_history"))) return;
    await deleteDoc(id);
    const rest = await listDocs();
    setDocs(rest);
    if (editing?.id === id) {
      editingRef.current = null;
      await openDoc(rest[0]?.id ?? (await createDoc()));
    }
  };

  // Rule-based marks are derived from the current text in the same render as the editor text, so
  // their underlines can never lag behind typing. AI marks win where the two overlap.
  const allMarks = useMemo(() => {
    if (!editing) return [];
    const ai = editing.marks;
    const local = detectLocal(editing.text, new Set(editing.localDismissed)).filter(
      (mark) => !ai.some((other) => other.status === "open" && other.start < mark.end && mark.start < other.end),
    );
    return [...ai, ...local];
  }, [editing]);
  const visibleMarks = useMemo(
    () =>
      allMarks
        .filter((mark) => filter.has(mark.category) && (showHandled ? true : mark.status === "open"))
        .sort((a, b) => a.start - b.start),
    [allMarks, filter, showHandled],
  );
  const openMarks = useMemo(
    () => allMarks.filter((mark) => mark.status === "open" && filter.has(mark.category)),
    [allMarks, filter],
  );
  const step = (delta: number) => {
    if (!openMarks.length) return;
    const sorted = [...openMarks].sort((a, b) => a.start - b.start);
    const at = sorted.findIndex((mark) => mark.id === activeId);
    const next = sorted[(at + delta + sorted.length) % sorted.length];
    selectMark(next, true);
  };

  const preview = previewId ? revisions.find((revision) => revision.id === previewId) : undefined;
  const counts = useMemo(() => {
    const result = new Map<Category, number>();
    for (const mark of allMarks) {
      if (mark.status === "open") result.set(mark.category, (result.get(mark.category) ?? 0) + 1);
    }
    return result;
  }, [allMarks]);

  return (
    <div
      className="w-shell"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void importFiles(event.dataTransfer.files);
      }}
    >
      <header className="w-top">
        <a
          className="w-btn is-text w-home"
          href={chrome.runtime.getURL("options/options.html")}
          aria-label={t("ui.open_home_settings")}
        >
          {t("ui.home")}
        </a>
        <button
          type="button"
          className="w-btn is-text w-narrow"
          onClick={() => setDrawer(drawer === "left" ? null : "left")}
        >
          {t("ui.documents")}
        </button>
        <input
          className="w-title"
          aria-label={t("ui.document_title")}
          value={editing?.title ?? ""}
          onChange={(event) => {
            setEditing((current) => (current ? { ...current, title: event.target.value } : current));
            scheduleSave();
          }}
        />
        <div className="w-actions">
          <button type="button" className="w-btn is-optional" onClick={exportMarkdown}>
            {t("ui.export")}
          </button>
          <button type="button" className="w-btn is-optional" onClick={() => void copyMarkdown()}>
            {t("ui.copy")}
          </button>
          {busy === "review" ? (
            <button type="button" className="w-btn" onClick={() => abortRef.current?.abort()}>
              {t("ui.cancel")}
            </button>
          ) : (
            <>
              <select
                className="w-select"
                aria-label={t("ui.review_method")}
                value={mode}
                disabled={!!busy}
                onChange={(event) => setMode(event.target.value as ReviewMode)}
              >
                <option value="combined">
                  {t("ui.combined_individual_passes")}
                  {PASSES.length + 1}
                  {t("ui.calls_308")}
                </option>
                <option value="single">{t("ui.combined_only_1_call")}</option>
                <option value="passes">
                  {t("ui.individual_passes_only")}
                  {PASSES.length}
                  {t("ui.calls_308")}
                </option>
              </select>
              <button type="button" className="w-btn is-filled" disabled={!!busy} onClick={() => void runReview()}>
                {t("ui.review_writing")}
              </button>
            </>
          )}
          <button
            type="button"
            className="w-btn is-text w-narrow"
            onClick={() => setDrawer(drawer === "right" ? null : "right")}
          >
            {t("ui.findings")}
            {openMarks.length ? ` ${openMarks.length}` : ""}
          </button>
        </div>
      </header>

      <div className="w-main">
        <aside className={`w-side is-left${drawer === "left" ? " is-open" : ""}`} aria-label={t("ui.documents")}>
          <div className="w-side-head">
            <h2>{t("ui.documents")}</h2>
            <span>
              <label className="w-btn is-small is-tonal" style={{ display: "inline-flex", alignItems: "center" }}>
                {t("ui.import")}
                <input
                  type="file"
                  multiple
                  accept=".md,.markdown,.mdx,.txt,text/*"
                  hidden
                  onChange={(event) => {
                    if (event.target.files) void importFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>{" "}
              <button
                type="button"
                className="w-btn is-small is-tonal"
                onClick={() => void createDoc().then((id) => openDoc(id))}
              >
                {t("ui.new")}
              </button>
            </span>
          </div>
          <ul className="w-docs">
            {docs.map((doc) => (
              <li key={doc.id} className={`w-doc${doc.id === editing?.id ? " is-current" : ""}`}>
                <button type="button" onClick={() => void openDoc(doc.id)} aria-current={doc.id === editing?.id}>
                  <strong>
                    {doc.id === editing?.id ? editing.title || t("ui.untitled") : doc.title || t("ui.untitled")}
                  </strong>
                  <small>{formatDate(doc.updatedAt)}</small>
                </button>
                <button
                  type="button"
                  className="w-btn is-text is-small"
                  aria-label={t("ui.message_delete", { p0: doc.title })}
                  onClick={() => void removeDoc(doc.id)}
                >
                  {t("ui.delete")}
                </button>
              </li>
            ))}
          </ul>
          <p className="w-empty">{t("ui.you_can_also_drag_and_drop_md_txt")}</p>
        </aside>

        <main className="w-center">
          <div className="w-page">
            {editing && (
              <Editor
                text={editing.text}
                marks={allMarks}
                activeId={activeId}
                placeholder={t("ui.write_in_your_own_words_here_ai_points")}
                onChange={changeText}
                onCaret={(position, collapsed) => {
                  if (collapsed) setActiveId(markAt(allMarks, position)?.id ?? null);
                }}
              />
            )}
          </div>
        </main>

        <aside className={`w-side is-right${drawer === "right" ? " is-open" : ""}`} aria-label={t("ui.review")}>
          <div className="w-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="w-tab"
              aria-selected={tab === "findings"}
              onClick={() => setTab("findings")}
            >
              {t("ui.findings")}
            </button>
            <button
              type="button"
              role="tab"
              className="w-tab"
              aria-selected={tab === "revisions"}
              onClick={() => setTab("revisions")}
            >
              {t("ui.revisions")}
            </button>
          </div>

          {status && (
            <p className={`w-status${status.error ? " is-error" : ""}`} role="status">
              {status.text}
            </p>
          )}

          {tab === "findings" ? (
            <>
              <div className="w-side-head">
                <h2>{t("ui.category")}</h2>
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={showHandled}
                    onChange={(event) => setShowHandled(event.target.checked)}
                  />{" "}
                  {t("ui.show_resolved_and_ignored_findings")}
                </label>
              </div>
              <div className="w-chips">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className="w-chip"
                    aria-pressed={filter.has(category.id)}
                    title={category.hint}
                    style={{ "--c": category.color } as React.CSSProperties}
                    onClick={() =>
                      setFilter((current) => {
                        const next = new Set(current);
                        if (!next.delete(category.id)) next.add(category.id);
                        return next;
                      })
                    }
                  >
                    <i />
                    {category.label} {counts.get(category.id) ?? 0}
                  </button>
                ))}
              </div>
              <div className="w-nav">
                <button type="button" className="w-btn is-small" disabled={!openMarks.length} onClick={() => step(-1)}>
                  {t("ui.previous")}
                </button>
                <button type="button" className="w-btn is-small" disabled={!openMarks.length} onClick={() => step(1)}>
                  {t("ui.next")}
                </button>
                <span>
                  {openMarks.length}
                  {t("ui.entries")}
                </span>
              </div>
              {visibleMarks.length ? (
                <div className="w-cards">
                  {visibleMarks.map((mark) => {
                    const category = categoryOf(mark.category);
                    return (
                      <article
                        key={mark.id}
                        className={`w-card${mark.id === activeId ? " is-active" : ""}${mark.status !== "open" || mark.edited ? " is-stale" : ""}`}
                        style={{ "--c": category.color } as React.CSSProperties}
                      >
                        <div className="w-card-head">
                          <span className="w-tag">
                            <i />
                            {category.label}
                            {mark.rule
                              ? ` ・ ${mark.source === "local" ? t("ui.detected_locally") : ""}${mark.rule}`
                              : ""}
                          </span>
                          <small>
                            {mark.status === "dismissed"
                              ? t("ui.ignore")
                              : mark.status === "resolved"
                                ? t("ui.resolved")
                                : mark.edited
                                  ? t("ui.edited")
                                  : ""}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="w-quote"
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: 0,
                            borderLeft: `3px solid ${category.color}`,
                            cursor: "pointer",
                          }}
                          onClick={() => selectMark(mark, true)}
                        >
                          {mark.quote}
                        </button>
                        <p className="w-reason">{mark.reason}</p>
                        <p className="w-question">{mark.question}</p>
                        <div className="w-card-actions">
                          {mark.status === "open" ? (
                            <>
                              {mark.source !== "local" && (
                                <button
                                  type="button"
                                  className="w-btn is-small is-tonal"
                                  onClick={() => setMarkStatus(mark, "resolved")}
                                >
                                  {t("ui.resolved")}
                                </button>
                              )}
                              <button
                                type="button"
                                className="w-btn is-small is-text"
                                onClick={() => setMarkStatus(mark, "dismissed")}
                              >
                                {t("ui.ignore")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="w-btn is-small is-text"
                              onClick={() => setMarkStatus(mark, "open")}
                            >
                              {t("ui.restore")}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="w-empty">{t("ui.select_review_writing_to_underline_problem_passages_and")}</p>
              )}
              <details className="w-details w-tools">
                <summary>{t("ui.compare_methods_evaluation")}</summary>
                <MethodsPanel
                  result={methodResult}
                  busy={!!busy}
                  passCount={PASSES.length}
                  onRun={() => void runMethodComparison()}
                  saved={savedComparisons}
                  loadedId={loadedComparison}
                  onLoad={(record) => {
                    setMethodResult(record.result);
                    setLoadedComparison(record.id);
                  }}
                  onExport={(record) =>
                    download(
                      `writer-comparison-${new Date(record.createdAt).toISOString().replace(/[:.]/g, "-")}.json`,
                      JSON.stringify(record, null, 2),
                      "application/json;charset=utf-8",
                    )
                  }
                  onApply={(marks, requested) => {
                    applyMarks(requested, marks);
                    setStatus({ text: t("ui.message_applied_findings_to_the_manuscript", { p0: marks.length }) });
                  }}
                />
              </details>
            </>
          ) : (
            <>
              <div className="w-side-head">
                <h2>{t("ui.revisions")}</h2>
                <button
                  type="button"
                  className="w-btn is-small is-tonal"
                  onClick={() =>
                    void snapshot(t("ui.manual_save"), true).then(() =>
                      setStatus({ text: t("ui.saved_as_a_major_revision") }),
                    )
                  }
                >
                  {t("ui.save_as_major_revision")}
                </button>
              </div>
              <p className="w-empty" style={{ paddingTop: 0 }}>
                {t("ui.select_two_revisions_to_compare_ai_judges_them")}
              </p>
              <div style={{ padding: "0 8px" }}>
                {[
                  {
                    id: CURRENT,
                    get label() {
                      return t("ui.current_manuscript");
                    },
                    createdAt: Date.now(),
                    major: false,
                    body: editing?.text ?? "",
                  } as const,
                  ...revisions,
                ].map((revision) => (
                  <div className="w-rev" key={revision.id}>
                    <input
                      type="checkbox"
                      id={`rev-${revision.id}`}
                      checked={picked.includes(revision.id)}
                      onChange={(event) =>
                        setPicked((current) =>
                          event.target.checked
                            ? [...current, revision.id].slice(-MAX_PICKED)
                            : current.filter((id) => id !== revision.id),
                        )
                      }
                    />
                    <label htmlFor={`rev-${revision.id}`}>
                      <strong>
                        {tournament?.bestId === revision.id && <span className="w-best">{t("ui.best")}</span>}
                        {revision.major ? "★ " : ""}
                        {revision.label}
                      </strong>
                      {revision.id !== CURRENT && (
                        <small>
                          {formatDate(revision.createdAt)} ・ {revision.body.length}
                          {t("ui.characters")}
                          <br />「{excerpt(revision.body)}」
                        </small>
                      )}
                    </label>
                    {revision.id !== CURRENT && (
                      <button
                        type="button"
                        className="w-btn is-small is-text"
                        onClick={() => setPreviewId(previewId === revision.id ? null : revision.id)}
                      >
                        {t("ui.diff")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ padding: 12 }}>
                <button
                  type="button"
                  className="w-btn is-filled"
                  disabled={picked.length !== 2 || !!busy}
                  onClick={() => void runCompare()}
                >
                  {t("ui.compare_selected_revisions")}
                </button>
              </div>
              {tournament && (
                <div className="w-cards">
                  <article className="w-card is-active">
                    <p className="w-best-title">
                      <span className="w-best">{t("ui.best")}</span>
                      {bodyLabel(tournament.bestId, revisions)}
                    </p>
                    {tournament.matches.every((match) => !match.winner) && (
                      <p className="w-reason">{t("ui.no_clear_winner_between_the_selected_revisions")}</p>
                    )}
                  </article>
                  {tournament.matches.map((match) => (
                    <article className="w-card" key={`${match.a}-${match.b}`}>
                      <p className="w-reason">
                        <strong>{bodyLabel(match.a, revisions)}</strong> {t("ui.and")}{" "}
                        <strong>{bodyLabel(match.b, revisions)}</strong>
                      </p>
                      <p className="w-question">
                        {match.winner
                          ? t("ui.message_is_clearer", { p0: bodyLabel(match.winner, revisions) })
                          : t("ui.tie_kept_the_first_selected_revision")}
                      </p>
                      <p className="w-reason">{match.result.reason}</p>
                      {match.result.remaining.map((item) => (
                        <p className="w-reason" key={item}>
                          ・{item}
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
              )}
              {preview && (
                <div className="w-diff">
                  {diffParagraphs(preview.body, editing?.text ?? "").map((op, index) => (
                    <p key={index} className={op.type}>
                      {op.text}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      <div className={`w-scrim${drawer ? " is-on" : ""}`} onClick={() => setDrawer(null)} aria-hidden="true" />
      {dragging && <div className="w-drop">{t("ui.drop_a_markdown_file_here_to_import")}</div>}
    </div>
  );
};

const excerpt = (body: string): string => {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
};
const bodyLabel = (id: string, revisions: Revision[]): string => {
  if (id === CURRENT) return t("ui.current_manuscript");
  const revision = revisions.find((item) => item.id === id);
  if (!revision) return t("ui.selected_revision");
  const time = new Intl.DateTimeFormat(getLocale(), { timeStyle: "medium" }).format(revision.createdAt);
  return `${revision.label} ${time}「${excerpt(revision.body)}」`;
};

const root = document.getElementById("root");
if (root) void initializeLocale().then(() => createRoot(root).render(<WriterApp />));
