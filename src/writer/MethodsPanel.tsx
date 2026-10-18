import { getLocale, t } from "../i18n";
import { categoryOf, type Mark } from "./marks";
import type { MethodResult } from "./methods";
import type { ComparisonRecord } from "./store";

type Props = {
  result: MethodResult | null;
  busy: boolean;
  passCount: number;
  onRun: () => void;
  onApply: (marks: Mark[], requested: string) => void;
  saved: ComparisonRecord[];
  loadedId: string | null;
  onLoad: (record: ComparisonRecord) => void;
  onExport: (record: ComparisonRecord) => void;
};

const count = (value: number) => new Intl.NumberFormat(getLocale()).format(value);

const byCategory = (marks: Mark[]): string => {
  const counts = new Map<Mark["category"], number>();
  for (const mark of marks) counts.set(mark.category, (counts.get(mark.category) ?? 0) + 1);
  return [...counts].map(([id, total]) => `${categoryOf(id).label} ${total}`).join(" ・ ") || t("ui.none");
};

const Findings: React.FC<{ marks: Mark[] }> = ({ marks }) => (
  <div className="w-cards">
    {marks.map((mark) => (
      <article
        key={mark.id}
        className="w-card"
        style={{ "--c": categoryOf(mark.category).color } as React.CSSProperties}
      >
        <div className="w-card-head">
          <span className="w-tag">
            <i />
            {categoryOf(mark.category).label}
          </span>
          {mark.rule && <small>{mark.rule}</small>}
        </div>
        <p className="w-quote">{mark.quote}</p>
        <p className="w-reason">{mark.reason}</p>
      </article>
    ))}
  </div>
);

export const MethodsPanel: React.FC<Props> = ({
  result,
  busy,
  passCount,
  onRun,
  onApply,
  saved,
  loadedId,
  onLoad,
  onExport,
}) => (
  <>
    <p className="w-empty" style={{ paddingBottom: 8 }}>
      {t("ui.runs_both_combined_all_categories_in_one_call")}
      {passCount}
      {t("ui.calls_on_the_same_manuscript_to_compare_findings")}
      {passCount + 1}
      {t("ui.calls_263")}
    </p>
    <div style={{ padding: "0 12px 12px" }}>
      <button type="button" className="w-btn is-filled" disabled={busy} onClick={onRun}>
        {t("ui.run_and_compare_both_methods")}
      </button>
    </div>
    {result && (
      <>
        <div className="w-cards">
          {(
            [
              { name: t("ui.combined"), data: result.single, shared: result.comparison.singleShared, calls: 1 },
              {
                name: t("ui.by_pass"),
                data: result.pass,
                shared: result.comparison.passShared,
                calls: result.pass.usage.calls,
              },
            ] as const
          ).map(({ name, data, shared }) => (
            <article className="w-card" key={name}>
              <p className="w-best-title">{name}</p>
              <p className="w-reason">
                {t("ui.findings")}
                <strong>
                  {data.marks.length}
                  {t("ui.entries")}
                </strong>
                {t("ui.by_category")}
                {byCategory(data.marks)}）
              </p>
              <p className="w-reason">
                {t("ui.locations_also_flagged_by_the_other_method")}
                <strong>
                  {shared}
                  {t("ui.entries")}
                </strong>
              </p>
              <p className="w-reason">
                {t("ui.ai_calls")}
                {data.usage.calls}
                {t("ui.calls_input")}
                {count(data.usage.inputTokens)} {t("ui.output_272")} {count(data.usage.outputTokens)} {t("ui.tokens")}
              </p>
              {"failed" in data && data.failed > 0 && (
                <p className="w-reason">
                  {t("ui.failed_passes")}
                  {data.failed}/{data.total}
                  {t("ui.findings_from_these_passes_are_excluded")}
                </p>
              )}
              <button
                type="button"
                className="w-btn is-small is-tonal"
                onClick={() => onApply(data.marks, result.requested)}
              >
                {t("ui.apply_this_result_to_the_manuscript")}
              </button>
            </article>
          ))}
        </div>
        <details className="w-details">
          <summary>
            {t("ui.combined_only")}
            {result.comparison.singleOnly.length}
            {t("ui.findings_278")}
          </summary>
          <Findings marks={result.comparison.singleOnly} />
        </details>
        <details className="w-details">
          <summary>
            {t("ui.by_pass_only")}
            {result.comparison.passOnly.length}
            {t("ui.findings_278")}
          </summary>
          <Findings marks={result.comparison.passOnly} />
        </details>
      </>
    )}
    {saved.length > 0 && (
      <details className="w-details" open={!result}>
        <summary>
          {t("ui.saved_comparisons")}
          {saved.length}
          {t("ui.saved_automatically")}
        </summary>
        <div className="w-cards">
          {saved.map((record) => (
            <article className={`w-card${record.id === loadedId ? " is-active" : ""}`} key={record.id}>
              <p className="w-reason">
                <strong>
                  {new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "medium" }).format(
                    record.createdAt,
                  )}
                </strong>
                <br />
                {t("ui.combined")}
                {record.result.single.marks.length}
                {t("ui.findings_by_pass")}
                {record.result.pass.marks.length}
                {t("ui.findings_shared")} {record.result.comparison.singleShared}
                {t("ui.findings_284")}
                {record.model}
              </p>
              <div className="w-card-actions">
                <button type="button" className="w-btn is-small is-tonal" onClick={() => onLoad(record)}>
                  {t("ui.open")}
                </button>
                <button type="button" className="w-btn is-small is-text" onClick={() => onExport(record)}>
                  {t("ui.export_json")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </details>
    )}
  </>
);
