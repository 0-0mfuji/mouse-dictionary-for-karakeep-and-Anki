# Reader comprehension review

The learner writes a short explanation of one English sentence in the language selected in settings (Japanese by default). This is a meaning check, not a demand for literal translation. One interactive Responses API request returns a localized model answer, semantic points, answer/source alignments, concrete issues, and nuances. The selected model defaults to `gpt-6-luna` and remains configurable in Mouse Dictionary settings.

## Scoring and feedback

1. Luna identifies 2–6 non-overlapping meaning points and assigns each importance 1–3. The points name the exact supporting English span.
2. Each point is classified as understood, partial, missing, misunderstood, or uncertain. Paraphrase and reasonable speech-recognition repair count as understanding. Unclear transcription is marked uncertain rather than automatically wrong.
3. The app calculates the displayed score: understood earns the full weight, partial earns half, missing or misunderstood earns zero. Uncertain points are excluded from the denominator. If all points are uncertain, the score is withheld. The point list exposes each judgment and its reason.
4. A model answer is an example, not the only accepted wording. It appears directly below the marked answer. For a clear correction, the old phrase appears in muted gray with a strikethrough and the replacement in black. The clickable marker opens a popover with the exact English evidence, explanation, and local correction. Suspected speech-recognition errors remain unstruck because they are not confirmed misunderstandings. Missing information is reachable through an issue button. Nuances show the English phrase, a natural paraphrase in the selected language, and why it matters.

The model's point classifications remain fallible. The score is intended as study feedback, not a calibrated exam grade. We do not silently equate a fluent paraphrase with an error or silently score ambiguous voice input as wrong. A future live evaluation should compare Luna's classifications with human labels for paraphrases, missing negation/quantity, and transcription errors before treating percentages as comparable across passages.

## Sources and decisions

- [OpenAI GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna): model ID and Structured Outputs support.
- [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs): strict schema with required fields and incomplete-response handling.
- [OpenAI Evals model-graded templates](https://github.com/openai/evals/blob/main/docs/eval-templates.md): explicit criteria and parsable categories for variable free-text answers. This informed point-level classification instead of a free-form number.
- [Unbabel COMET/XCOMET](https://github.com/Unbabel/COMET): span-level translation error evidence informed the marker and correction UI; its trained scores are not used here.
- [Hacker News discussion on grading notes](https://news.ycombinator.com/item?id=41365273): a practitioner discussion of notes about concepts graders often miss. This motivated recording exact evidence and examples, but is anecdotal rather than validation.

The API call is interactive, so the batch API is not used. It sends the selected sentence, the answer, and up to 500 characters each of the immediately preceding and following sentences, without the article body or audio recording. The adjacent sentences are context only; all grading evidence must be quoted from the selected sentence. The same structured response supplies all review sections, avoiding separate paid calls for score, model answer, and annotations. Returned token usage is stored alongside each review attempt, including responses that are incomplete after usage is reported, and summarized in local history. Aborted requests and older calls without a returned usage record cannot be measured retrospectively.

Before calling the API, the reader looks for a successful saved review with an exact match on the selected sentence, answer, input method, gloss condition, bounded adjacent context, model, and a manually incremented review-prompt version. A reused result is labeled and adds no new API usage. Simultaneous duplicate submissions from the same reader tab are suppressed. Changed answers or context always receive a fresh review.
