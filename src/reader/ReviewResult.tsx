import { t } from "../i18n";
import { AnswerAnnotations } from "./AnswerAnnotations";
import type { ComprehensionReview } from "./comprehensionReview";

const statusLabels = () =>
  ({
    understood: t("ui.understood"),
    partial: t("ui.partially_understood"),
    missing: t("ui.missing_key_point"),
    misunderstood: t("ui.meaning_mismatch"),
    uncertain: t("ui.uncertain"),
  }) as const;

export const ReviewResult: React.FC<{
  answer: string;
  review: ComprehensionReview;
  usedGloss: boolean;
}> = ({ answer, review, usedGloss }) => (
  <div className="review-result">
    <AnswerAnnotations answer={answer} review={review} />
    <section className="ai-review" aria-label={t("ui.ai_reading_review")}>
      {usedGloss && <p className="review-assistance">{t("ui.this_review_accounts_for_your_use_of_the")}</p>}
      <div className="review-score">
        <strong>
          {review.score === null ? t("ui.uncertain") : review.score}
          {review.score !== null && <small> {t("ui.100_points")}</small>}
        </strong>
        <span>{review.scoreReason}</span>
      </div>
      <div className="review-panel">
        <h3>{t("ui.understanding_by_key_point")}</h3>
        <div className="review-point-list">
          {review.keyPoints.map((point, index) => (
            <article className={`review-point ${point.status}`} key={index}>
              <div className="review-point-heading">
                <span className="review-chip">{statusLabels()[point.status]}</span>
                <small>
                  {t("ui.weight")}
                  {point.weight}
                </small>
              </div>
              <strong>{point.meaning}</strong>
              <p lang="en">{point.sourceQuote}</p>
              <p>{point.explanation}</p>
            </article>
          ))}
        </div>
        <small className="review-scoring-note">{t("ui.scores_use_the_importance_of_each_key_point")}</small>
      </div>
      {review.nuances.length > 0 && (
        <div className="review-panel">
          <h3>{t("ui.nuances_to_learn")}</h3>
          <ul className="review-nuances">
            {review.nuances.map((item, index) => (
              <li key={index}>
                <strong lang="en">{item.sourceQuote}</strong>
                <span>{item.naturalJapanese}</span>
                <p>{item.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <small className="review-caveat">{t("ui.scores_are_a_learning_guide_if_transcription_is")}</small>
    </section>
  </div>
);
