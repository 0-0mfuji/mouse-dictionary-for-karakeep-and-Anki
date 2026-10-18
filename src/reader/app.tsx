import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { initializeLocale, t } from "../i18n";
import { useLocale } from "../i18n/react";
import { buildApkg } from "../options/logic/anki";
import { type ComprehensionReview, type ReviewUsage, reviewComprehension } from "./comprehensionReview";
import { acquireMicrophone, stopMicrophone } from "./microphone";
import { createParserClient } from "./parserClient";
import { phraseSplitsKey, togglePhraseSplit, validPhraseSplits } from "./phraseSplits";
import { groupReadingWords, type PhraseSplit, phraseCandidates } from "./phrases";
import { ReviewResult } from "./ReviewResult";
import {
  assignDependencyArcLanes,
  chooseGrammaticalGloss,
  type GlossChoice,
  getComprehensionHints,
  getCursorForOffset,
  getDependencyLabel,
  getDictionaryKeys,
  getSentenceRole,
  getSentenceStartCursor,
  getWordDelay,
  getWordGloss,
  mapDictionaryEntriesToWords,
  type ParsedSentence,
  type ParsedWord,
} from "./readerLogic";
import type { ProgressMap } from "./readingProgress";
import {
  findCachedReview,
  makeReviewHistoryEntry,
  type ReviewHistoryEntry,
  reviewCacheKey,
  saveReviewHistoryEntry,
} from "./reviewHistory";
import { type ReviewMark, reviewMarksKey, toggleReviewMark, validReviewMarks } from "./reviewMarks";
import { SentencePicker } from "./SentencePicker";
import { originalTranscriptOffset, prepareTranscript, type TranscriptMapping } from "./transcript";
import { compactUrls } from "./urlText";
import { useReadingProgress } from "./useReadingProgress";
import { stopVoiceWorker, transcribeRecording } from "./voiceInput";

type Article = {
  title: string;
  sourceUrl: string;
  bookmarkId: string;
  text: string;
  progressMap?: ProgressMap;
  progressScope?: string;
  transcriptMapping?: TranscriptMapping;
};
type Session = { article: Article; createdAt: number };

const RSVP_KEY = "rsvpSettingsV1";
const PRONUNCIATION_VOICE_KEY = "reader_pronunciation_voice";
const DEFAULT_WPM = 240;
const preferredEnglishVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined => {
  const english = voices.filter((voice) => /^en(?:-|$)/i.test(voice.lang));
  const local = english.filter((voice) => voice.localService);
  return (local.length ? local : english).sort((a, b) => {
    const score = (voice: SpeechSynthesisVoice) =>
      (/(natural|neural|premium|enhanced)/i.test(voice.name) ? 4 : 0) +
      (/^en-US$/i.test(voice.lang) ? 2 : 0) +
      (voice.default ? 1 : 0);
    return score(b) - score(a);
  })[0];
};
const glossStatusLabel = (status: GlossChoice["status"]): string =>
  ({
    matched: t("ui.part_of_speech_match"),
    multiple: t("ui.multiple_candidates"),
    unverified: t("ui.dictionary_candidate"),
    missing: "",
  })[status];

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

const dictionaryHtmlToText = (value: string): string => {
  const htmlWithLineBreaks = value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li)>/gi, "\n");
  const parsed = new DOMParser().parseFromString(htmlWithLineBreaks, "text/html");
  parsed.querySelectorAll("script, style").forEach((element) => {
    element.remove();
  });
  return parsed.body.textContent?.trim() ?? value;
};

const loadSession = async (): Promise<Session | null> => {
  const sessionId = new URLSearchParams(location.search).get("session");
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  const key = `rsvp_session_${sessionId}`;
  const stored = await chrome.storage.local.get(key);
  const sessionStorageKey = `rsvp_session_${sessionId}`;
  let session = stored[key] as Session | undefined;
  if (session) {
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
    await chrome.storage.local.remove(key);
  } else {
    try {
      session = (JSON.parse(sessionStorage.getItem(sessionStorageKey) ?? "null") as Session | null) ?? undefined;
    } catch {
      session = undefined;
    }
  }
  if (!session?.article?.text || Date.now() - session.createdAt > 24 * 60 * 60 * 1000) return null;
  return session;
};

const lookupSentenceEntries = async (sentence: ParsedSentence) => {
  const words = sentence.words;
  const candidates = phraseCandidates(sentence);
  const keys = [
    ...new Set([
      ...words.filter((word) => !word.url).flatMap(getDictionaryKeys),
      ...candidates.flatMap((phrase) => phrase.keys),
    ]),
  ];
  const data = await chrome.storage.local.get(keys);
  const entries = Object.fromEntries(
    Object.entries(mapDictionaryEntriesToWords(words, data)).map(([id, entries]) => [
      id,
      entries.map(dictionaryHtmlToText),
    ]),
  );
  const phrases = candidates
    .map((phrase) => ({
      ...phrase,
      entries: [
        ...new Set(
          phrase.keys.flatMap((key) => (typeof data[key] === "string" ? [dictionaryHtmlToText(data[key])] : [])),
        ),
      ],
    }))
    .filter((phrase) => phrase.entries.length > 0);
  return { entries, phrases };
};

const readWpm = async (): Promise<number> => {
  const data = await chrome.storage.sync.get(RSVP_KEY);
  const wpm = Number((data[RSVP_KEY] as { wpm?: number } | undefined)?.wpm);
  return Number.isFinite(wpm) ? Math.min(600, Math.max(100, wpm)) : DEFAULT_WPM;
};

const saveWpm = async (wpm: number): Promise<void> => {
  await chrome.storage.sync.set({ [RSVP_KEY]: { wpm } });
};

const ReaderApp: React.FC = () => {
  useLocale();
  document.title = t("ui.reader_title");
  const [article, setArticle] = useState<Article | null>(null);
  const [sentences, setSentences] = useState<ParsedSentence[]>([]);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [dictionary, setDictionary] = useState<Awaited<ReturnType<typeof lookupSentenceEntries>>[]>([]);
  const [status, setStatus] = useState(t("ui.loading_article"));
  const [error, setError] = useState("");
  const [savingCard, setSavingCard] = useState(false);
  const [savingWordCard, setSavingWordCard] = useState(false);
  const [markingSentence, setMarkingSentence] = useState(false);
  const [showSentencePicker, setShowSentencePicker] = useState(false);
  const [showGloss, setShowGloss] = useState(true);
  const [usedGloss, setUsedGloss] = useState(false);
  const [reviewMarks, setReviewMarks] = useState<ReviewMark[]>([]);
  const [reviewMarksLoaded, setReviewMarksLoaded] = useState(false);
  const [selfCheckDone, setSelfCheckDone] = useState(false);
  const [recallStarted, setRecallStarted] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [review, setReview] = useState<ComprehensionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewReused, setReviewReused] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [answerMethod, setAnswerMethod] = useState<"text" | "voice">("text");
  const [checkMode, setCheckMode] = useState<"off" | "voice" | "text">("off");
  const [voiceState, setVoiceState] = useState("");
  const [pronunciationVoices, setPronunciationVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [pronunciationVoiceURI, setPronunciationVoiceURI] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);
  const [openaiSettings, setOpenaiSettings] = useState({ apiKey: "", model: "gpt-6-luna" });
  const [phraseSplits, setPhraseSplits] = useState<PhraseSplit[]>([]);
  const [phraseSplitsLoaded, setPhraseSplitsLoaded] = useState(false);
  const parserRef = useRef<ReturnType<typeof createParserClient> | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const reviewRequestInFlightRef = useRef<string | null>(null);
  const answerSubmissionRef = useRef(false);
  const historyEntryRef = useRef<ReviewHistoryEntry | null>(null);
  const historySaveRef = useRef<Promise<void>>(Promise.resolve());
  const microphoneRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const answerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSentenceIndexRef = useRef(-1);
  const voiceGenerationRef = useRef(0);
  const sentencePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const focusWordRef = useRef<HTMLDivElement>(null);
  const [fittedFontSize, setFittedFontSize] = useState<number | null>(null);

  const releaseMicrophone = (stream: MediaStream | null = microphoneRef.current) => {
    if (!stream) return;
    stopMicrophone(stream);
    if (microphoneRef.current === stream) microphoneRef.current = null;
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === "recording") recorder.stop();
    releaseMicrophone();
    setRecording(false);
    setRecordingPending(false);
  };

  const cancelRecording = () => {
    voiceGenerationRef.current += 1;
    stopRecording();
    setVoiceState("");
  };

  const words = useMemo(
    () =>
      sentences.flatMap((sentence, sentenceIndex) =>
        groupReadingWords(sentence, dictionary[sentenceIndex]?.phrases ?? [], phraseSplits).map((word, wordIndex) => ({
          sentenceIndex,
          wordIndex,
          word,
        })),
      ),
    [sentences, dictionary, phraseSplits],
  );
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const cursor = getCursorForOffset(words, cursorOffset);
  const setCursor: Dispatch<SetStateAction<number>> = useCallback((next) => {
    setCursorOffset((offset) => {
      const currentWords = wordsRef.current;
      if (!currentWords.length) return offset;
      const current = getCursorForOffset(currentWords, offset);
      const index = typeof next === "function" ? next(current) : next;
      const bounded = Math.max(0, Math.min(currentWords.length - 1, index));
      return currentWords[bounded].word.start;
    });
  }, []);
  const readingProgress = useReadingProgress(
    article,
    words,
    cursor,
    playing,
    completed && !playing && cursor === words.length - 1,
    setCursor,
  );
  useEffect(() => {
    setCompleted(false);
  }, [cursor]);
  const active = words[cursor];
  activeSentenceIndexRef.current = active?.sentenceIndex ?? -1;
  const sentence = active ? sentences[active.sentenceIndex] : undefined;
  const activeWord = active?.word;
  const sentenceDictionaryEntries = dictionary[active?.sentenceIndex ?? -1]?.entries ?? {};
  const sentenceDictionaryLoaded = !!dictionary[active?.sentenceIndex ?? -1];
  const unitEntries = (word: (typeof words)[number]["word"]): string[] => {
    if (word.phraseEntries.length) return word.phraseEntries;
    if (word.members.length > 1) {
      // A grammatical group without a dictionary entry has no reliable
      // whole-phrase translation. Component glosses are shown separately.
      return [];
    }
    return sentenceDictionaryEntries[word.id] ?? [];
  };
  const dictionaryEntries = activeWord ? unitEntries(activeWord) : [];
  const componentChoice = (word: ParsedWord): GlossChoice => {
    if (word.url) return { gloss: t("ui.link"), status: "matched" };
    if (word.unparsed) {
      const entries = sentenceDictionaryEntries[word.id] ?? [];
      return entries.length
        ? { gloss: getWordGloss(entries), status: "unverified" }
        : { gloss: t("ui.unparsed"), status: "missing" };
    }
    if (word.upos === "DET") {
      if (word.form.toLowerCase() === "the") return { gloss: t("ui.the"), status: "matched" };
      if (/^(a|an)$/i.test(word.form)) return { gloss: t("ui.a_one"), status: "matched" };
    }
    return sentence
      ? chooseGrammaticalGloss(sentenceDictionaryEntries[word.id] ?? [], word, sentence)
      : { gloss: t("ui.not_found"), status: "missing" };
  };
  const unitChoice = (word: (typeof words)[number]["word"]): GlossChoice => {
    if (word.url) return { gloss: t("ui.link"), status: "matched" };
    if (word.members.length > 1 && !word.phraseEntries.length)
      return { gloss: t("ui.phrase_no_phrase_gloss"), status: "missing" };
    if (word.phraseEntries.length) return { gloss: getWordGloss(word.phraseEntries), status: "unverified" };
    return componentChoice(word.members[0]);
  };
  const memberGloss = (word: (typeof words)[number]["word"]) => (
    <span className="phrase-members">
      {word.members.map((member) => (
        <span className="phrase-member-column" key={member.id}>
          <span className="phrase-member-form">{member.form}</span>
          <span className="phrase-member-gloss">{componentChoice(member).gloss}</span>
        </span>
      ))}
    </span>
  );
  const detailEntries =
    activeWord && activeWord.members.length > 1
      ? [
          `${activeWord.form}\n${dictionaryEntries.join("\n") || t("ui.no_dictionary_entry_for_this_phrase")}`,
          ...activeWord.members.map(
            (member) => `${member.form}\n${(sentenceDictionaryEntries[member.id] ?? [t("ui.not_found")]).join("\n")}`,
          ),
        ]
      : dictionaryEntries;
  const sentenceUnits = useMemo(
    () => words.filter((item) => item.sentenceIndex === active?.sentenceIndex).map((item) => item.word),
    [words, active?.sentenceIndex],
  );
  const previousSentence = active ? sentences[active.sentenceIndex - 1] : undefined;
  const nextSentence = active ? sentences[active.sentenceIndex + 1] : undefined;
  const isMarked = !!sentence && reviewMarks.some((mark) => mark.start === sentence.start);
  const activeSplit = activeWord
    ? phraseSplits.find((item) => activeWord.start >= item.start && activeWord.start < item.end)
    : undefined;
  const canSplitPhrase =
    !!activeWord &&
    activeWord.members.length > 1 &&
    activeWord.members.some((member, index) => index > 0 && member.start > activeWord.members[index - 1].end);

  useEffect(() => {
    cancelRecording();
    reviewAbortRef.current?.abort();
    reviewRequestInFlightRef.current = null;
    setReviewLoading(false);
    setSelfCheckDone(false);
    setRecallStarted(false);
    setUsedGloss(false);
    setResponseText("");
    setAnswerSubmitted(false);
    setReview(null);
    setReviewError("");
    setReviewReused(false);
    answerSubmissionRef.current = false;
    setHistoryError("");
    historyEntryRef.current = null;
    setVoiceState("");
  }, [active?.sentenceIndex]);

  useEffect(() => {
    if (!answerSubmitted) answerSubmissionRef.current = false;
  }, [answerSubmitted]);

  const requestReview = async (answer: string) => {
    if (!sentence) return;
    const key = reviewCacheKey(sentence.text, answer, answerMethod, usedGloss, openaiSettings.model, {
      previous: previousSentence?.text,
      next: nextSentence?.text,
    });
    if (reviewRequestInFlightRef.current === key && !reviewAbortRef.current?.signal.aborted) return;
    reviewAbortRef.current?.abort();
    const controller = new AbortController();
    const historyEntry = historyEntryRef.current;
    const attemptUsage: ReviewUsage[] = [];
    let completedReview: ComprehensionReview | null = null;
    let reusedReview = false;
    reviewAbortRef.current = controller;
    reviewRequestInFlightRef.current = key;
    setReviewLoading(true);
    setReviewError("");
    setReviewReused(false);
    try {
      await historySaveRef.current.catch(() => {});
      const cached = await findCachedReview(key, historyEntry?.id).catch(() => null);
      if (controller.signal.aborted) return;
      if (cached) {
        completedReview = cached;
        reusedReview = true;
        setReview(cached);
        setReviewReused(true);
        return;
      }
      if (!openaiSettings.apiKey.trim()) throw new Error(t("ui.enter_your_openai_api_key_in_mouse_dictionary"));
      const allowed = await chrome.permissions.contains({ origins: ["https://api.openai.com/*"] });
      if (!allowed) throw new Error(t("ui.allow_openai_api_access_in_mouse_dictionary_settings"));
      const result = await reviewComprehension(
        sentence.text,
        answer,
        answerMethod,
        usedGloss,
        openaiSettings.apiKey.trim(),
        openaiSettings.model,
        controller.signal,
        { previous: previousSentence?.text, next: nextSentence?.text },
        (usage) => attemptUsage.push(usage),
      );
      if (!controller.signal.aborted) {
        setReview(result);
        completedReview = result;
      }
    } catch (error) {
      if (!controller.signal.aborted) setReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (historyEntry && (completedReview || attemptUsage.length)) {
        const current = historyEntryRef.current?.id === historyEntry.id ? historyEntryRef.current : historyEntry;
        const updated = {
          ...current,
          review: completedReview ?? current.review,
          usage: [...(current.usage ?? []), ...attemptUsage],
          reusedReview,
        };
        if (historyEntryRef.current?.id === historyEntry.id) historyEntryRef.current = updated;
        historySaveRef.current = historySaveRef.current.catch(() => {}).then(() => saveReviewHistoryEntry(updated));
        try {
          await historySaveRef.current;
          if (historyEntryRef.current?.id === historyEntry.id) setHistoryError("");
        } catch {
          if (historyEntryRef.current?.id === historyEntry.id)
            setHistoryError(t("ui.could_not_save_api_usage_to_history"));
        }
      }
      if (reviewRequestInFlightRef.current === key) reviewRequestInFlightRef.current = null;
      if (!controller.signal.aborted) setReviewLoading(false);
    }
  };

  const startRecording = async () => {
    if (recorderRef.current?.state === "recording") return;
    const generation = ++voiceGenerationRef.current;
    const sentenceIndex = activeSentenceIndexRef.current;
    let stream: MediaStream | null = null;
    setRecordingPending(true);
    try {
      const allowed = await chrome.permissions.contains({
        origins: ["https://huggingface.co/*", "https://*.hf.co/*"],
      });
      if (!allowed) throw new Error(t("ui.allow_whisper_model_downloads_in_mouse_dictionary_settings"));
      const isCurrent = () =>
        generation === voiceGenerationRef.current && activeSentenceIndexRef.current === sentenceIndex;
      if (!isCurrent()) return;
      setVoiceState(t("ui.preparing_microphone"));
      stream = await acquireMicrophone(() => navigator.mediaDevices.getUserMedia({ audio: true }), isCurrent);
      if (!stream) return;
      microphoneRef.current = stream;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        releaseMicrophone(stream);
        if (recorderRef.current === recorder) {
          recorderRef.current = null;
          setRecording(false);
        }
        if (generation !== voiceGenerationRef.current) return;
        setVoiceState(t("ui.analyzing_audio"));
        void transcribeRecording(new Blob(chunks, { type: recorder.mimeType }), (progress) => {
          if (generation !== voiceGenerationRef.current) return;
          setVoiceState(
            progress.state === "loading"
              ? progress.percent === undefined
                ? t("ui.loading_whisper_model")
                : t("ui.message_downloading_whisper_model", { p0: progress.percent })
              : t("ui.transcribing_speech"),
          );
        })
          .then((text) => {
            if (generation !== voiceGenerationRef.current || activeSentenceIndexRef.current !== sentenceIndex) return;
            setResponseText(text);
            setAnswerMethod("voice");
            setVoiceState(
              text
                ? t("ui.check_the_transcript_and_correct_it_if_needed")
                : t("ui.no_speech_recognized_try_speaking_again_or_type"),
            );
            requestAnimationFrame(() => answerTextareaRef.current?.focus());
          })
          .catch((error) => {
            if (generation === voiceGenerationRef.current)
              setVoiceState(error instanceof Error ? error.message : String(error));
          });
      };
      recorder.start();
      setRecordingPending(false);
      setRecording(true);
      setAnswerMethod("voice");
      setVoiceState(t("ui.recording_select_stop_recording_when_you_finish_speaking"));
    } catch (error) {
      releaseMicrophone(stream);
      recorderRef.current = null;
      if (generation !== voiceGenerationRef.current) return;
      setRecordingPending(false);
      setVoiceState(error instanceof Error ? error.message : t("ui.could_not_start_the_microphone_you_can_type"));
    }
  };

  const changeCheckMode = async (mode: "off" | "voice" | "text") => {
    cancelRecording();
    const generation = voiceGenerationRef.current;
    if (mode === "off") {
      setCheckMode("off");
      setPlaying(false);
      return;
    }
    if (mode === "voice") {
      try {
        const allowed = await chrome.permissions.contains({
          origins: ["https://huggingface.co/*", "https://*.hf.co/*"],
        });
        if (!allowed) throw new Error(t("ui.allow_whisper_model_downloads_in_mouse_dictionary_settings"));
      } catch (error) {
        if (generation !== voiceGenerationRef.current) return;
        const message =
          error instanceof Error ? error.message : t("ui.microphone_unavailable_you_can_continue_by_typing");
        setVoiceState(message);
        setError(message);
        return;
      }
    }
    if (generation !== voiceGenerationRef.current) return;
    setCheckMode(mode);
    setPlaying(true);
    setShowGloss(false);
    setUsedGloss(false);
    setRecallStarted(false);
    setAnswerSubmitted(false);
  };

  const pronounceWord = () => {
    if (!activeWord || !("speechSynthesis" in window)) return;
    cancelRecording();
    setPlaying(false);
    speechSynthesis.cancel();
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((item) => item.voiceURI === pronunciationVoiceURI) ?? preferredEnglishVoice(voices);
    const utterance = new SpeechSynthesisUtterance(activeWord.form);
    utterance.lang = voice?.lang ?? "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const updateVoices = () =>
      setPronunciationVoices(speechSynthesis.getVoices().filter((voice) => /^en(?:-|$)/i.test(voice.lang)));
    updateVoices();
    speechSynthesis.addEventListener("voiceschanged", updateVoices);
    void chrome.storage.local.get(PRONUNCIATION_VOICE_KEY).then((stored) => {
      if (typeof stored[PRONUNCIATION_VOICE_KEY] === "string")
        setPronunciationVoiceURI(stored[PRONUNCIATION_VOICE_KEY]);
    });
    return () => speechSynthesis.removeEventListener("voiceschanged", updateVoices);
  }, []);

  useEffect(
    () => () => {
      voiceGenerationRef.current += 1;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMicrophone();
      stopVoiceWorker();
      reviewAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") cancelRecording();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", cancelRecording);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", cancelRecording);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [stored, local] = await Promise.all([
          chrome.storage.sync.get("**** config ****"),
          chrome.storage.local.get("reader_openai_api_key"),
        ]);
        if (cancelled) return;
        const settings = JSON.parse(typeof stored["**** config ****"] === "string" ? stored["**** config ****"] : "{}");
        setOpenaiSettings({
          apiKey: typeof local.reader_openai_api_key === "string" ? local.reader_openai_api_key : "",
          model: typeof settings.openaiModel === "string" && settings.openaiModel ? settings.openaiModel : "gpt-6-luna",
        });
      } catch {
        if (!cancelled) setReviewError(t("ui.could_not_load_openai_settings"));
      }
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if ((area === "sync" && changes["**** config ****"]) || (area === "local" && changes.reader_openai_api_key)) {
        void load();
      }
    };
    void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    if (!article || !sentences.length) return;
    let cancelled = false;
    const key = reviewMarksKey(article);
    setReviewMarksLoaded(false);
    void chrome.storage.local.get(key).then((data) => {
      if (cancelled) return;
      setReviewMarks(validReviewMarks(data[key], sentences));
      setReviewMarksLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [article, sentences]);

  const updateReviewMarks = (target: ParsedSentence) => {
    if (!article || !reviewMarksLoaded) return;
    const next = toggleReviewMark(reviewMarks, target);
    setReviewMarks(next);
    void chrome.storage.local.set({ [reviewMarksKey(article)]: next }).catch(() => {
      setError(t("ui.could_not_save_the_rereading_mark"));
    });
  };

  const jumpToSentence = (index: number) => {
    const target = words.findIndex((item) => item.sentenceIndex === index);
    if (target < 0) return;
    cancelRecording();
    setPlaying(false);
    setCompleted(false);
    setCursor(target);
  };

  const changePhraseSplit = () => {
    if (!article || !sentence || !activeWord || !active || !phraseSplitsLoaded) return;
    const target = activeSplit ?? {
      start: activeWord.start,
      end: activeWord.end,
      text: sentence.text.slice(activeWord.start - sentence.start, activeWord.end - sentence.start),
    };
    const next = togglePhraseSplit(phraseSplits, target);
    const newUnits = groupReadingWords(sentence, dictionary[active.sentenceIndex]?.phrases ?? [], next);
    const previousCount = words.findIndex((item) => item.sentenceIndex === active.sentenceIndex);
    const localIndex = newUnits.findIndex((unit) => unit.start <= activeWord.start && unit.end > activeWord.start);
    if (previousCount >= 0 && localIndex >= 0) setCursor(previousCount + localIndex);
    setPlaying(false);
    setPhraseSplits(next);
    void chrome.storage.local.set({ [phraseSplitsKey(article)]: next }).catch(() => {
      setError(t("ui.could_not_save_phrase_split_settings"));
    });
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const [session, initialWpm] = await Promise.all([loadSession(), readWpm()]);
        if (cancelled) return;
        setWpm(initialWpm);
        setSettingsLoaded(true);
        if (!session) {
          setStatus("");
          setError(t("ui.article_data_not_found_please_reopen_it_from"));
          return;
        }
        const prepared = prepareTranscript(session.article.text, session.article.progressMap);
        const readerArticle: Article = {
          ...session.article,
          text: prepared.text,
          progressMap: prepared.progressMap,
          transcriptMapping: prepared.mapping,
        };
        setArticle(readerArticle);
        setStatus(t("ui.analyzing_english_text"));
        const parser = createParserClient();
        parserRef.current = parser;
        const parsed = await parser.parse(readerArticle.text);
        if (cancelled) return;
        if (!parsed.length || parsed.every((item) => !item.words.length)) {
          throw new Error(t("ui.no_readable_words_found_in_the_article"));
        }
        setStatus(t("ui.looking_up_the_first_sentence"));
        type SentenceDictionary = Awaited<ReturnType<typeof lookupSentenceEntries>>;
        const dictionaries = new Array<SentenceDictionary>(parsed.length);
        let lookupFailures = 0;
        const loadBatch = async (start: number, count: number) => {
          const batch = await Promise.all(
            parsed.slice(start, start + count).map(async (item) => {
              try {
                return await lookupSentenceEntries(item);
              } catch {
                lookupFailures++;
                return { entries: {} as Record<number, string[]>, phrases: [] };
              }
            }),
          );
          if (cancelled) return false;
          batch.forEach((value, index) => {
            dictionaries[start + index] = value;
          });
          setDictionary([...dictionaries]);
          return true;
        };
        const firstCount = Math.min(4, parsed.length);
        if (!(await loadBatch(0, firstCount))) return;
        const splitKey = phraseSplitsKey(readerArticle);
        const storedSplits = await chrome.storage.local.get(splitKey);
        if (cancelled) return;
        setPhraseSplits(validPhraseSplits(storedSplits[splitKey], parsed));
        setPhraseSplitsLoaded(true);
        setSentences(parsed);
        setStatus(
          firstCount < parsed.length
            ? t("ui.message_loading_remaining_dictionary_entries", { p0: firstCount, p1: parsed.length })
            : "",
        );
        for (let start = firstCount; start < parsed.length; start += 24) {
          const count = Math.min(24, parsed.length - start);
          if (!(await loadBatch(start, count))) return;
          setStatus(
            start + count < parsed.length
              ? t("ui.message_loading_remaining_dictionary_entries", { p0: start + count, p1: parsed.length })
              : "",
          );
        }
        if (lookupFailures)
          setError(t("ui.message_could_not_load_dictionary_entries_for_sentences", { p0: lookupFailures }));
      } catch (reason) {
        if (!cancelled) {
          setStatus("");
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
      parserRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!playing || !readingProgress.ready || cursor >= words.length) return;
    const next = words[cursor + 1];
    const gap =
      sentence && activeWord && next?.sentenceIndex === active?.sentenceIndex
        ? sentence.text.slice(activeWord.end - sentence.start, next.word.start - sentence.start)
        : next
          ? "."
          : undefined;
    const timer = window.setTimeout(
      () => {
        if (checkMode !== "off" && (!next || next.sentenceIndex !== active?.sentenceIndex)) {
          setPlaying(false);
          setRecallStarted(true);
          setShowGloss(false);
          setUsedGloss(false);
          setAnswerSubmitted(false);
          setResponseText("");
          setReview(null);
          if (checkMode === "voice") void startRecording();
          else requestAnimationFrame(() => answerTextareaRef.current?.focus());
          return;
        }
        if (cursor + 1 >= words.length) {
          setPlaying(false);
          setCompleted(true);
        } else setCursor((index) => Math.min(words.length - 1, index + 1));
      },
      getWordDelay(wpm, gap, activeWord),
    );
    return () => window.clearTimeout(timer);
  }, [playing, cursor, wpm, words, sentence, activeWord, active, readingProgress.ready, checkMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (showSentencePicker) {
        if (event.key === "Escape") setShowSentencePicker(false);
        return;
      }
      if (
        !readingProgress.ready ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        event.preventDefault();
        cancelRecording();
        setPlaying((value) => !value);
      } else if (key === "w") {
        setWpm((value) => Math.min(600, value + 20));
      } else if (key === "s") {
        setWpm((value) => Math.max(100, value - 20));
      } else if (key === "a") {
        cancelRecording();
        setPlaying(false);
        setCursor((value) => Math.max(0, value - 1));
      } else if (key === "d") {
        cancelRecording();
        setPlaying(false);
        setCursor((value) => Math.min(words.length - 1, value + 1));
      } else if (key === "q" || key === "e") {
        event.preventDefault();
        const targetSentence = (active?.sentenceIndex ?? -1) + (key === "q" ? -1 : 1);
        const targetCursor = words.findIndex((item) => item.sentenceIndex === targetSentence);
        if (targetCursor >= 0) {
          setCompleted(false);
          setCursor(targetCursor);
        }
      } else if (event.key === "Escape") {
        window.close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [words, active?.sentenceIndex, showSentencePicker, readingProgress.ready]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => void saveWpm(wpm).catch(() => undefined), 250);
    return () => window.clearTimeout(timer);
  }, [settingsLoaded, wpm]);

  const addClozeCard = async () => {
    if (!sentence || !activeWord || savingCard) return;
    setSavingCard(true);
    try {
      const localStart = activeWord.start - sentence.start;
      const localEnd = activeWord.end - sentence.start;
      const clozeText = `${escapeHtml(sentence.text.slice(0, localStart))}{{c1::${escapeHtml(sentence.text.slice(localStart, localEnd))}}}${escapeHtml(sentence.text.slice(localEnd))}`;
      const choice = unitChoice(activeWord);
      const details = [
        `${escapeHtml(activeWord.form)} — ${escapeHtml(activeWord.lemma)}`,
        t("ui.message_gloss_candidate_context_not_verified", {
          p0: escapeHtml(choice.gloss),
          p1: escapeHtml(glossStatusLabel(choice.status) || t("ui.no_gloss")),
        }),
        ...dictionaryEntries.map(escapeHtml),
        `Relation: ${escapeHtml(activeWord.deprel)}`,
        article?.sourceUrl ? `<a href="${escapeHtml(article.sourceUrl)}">Article source</a>` : "",
      ]
        .filter(Boolean)
        .join("<br>");
      const blob = await buildApkg(
        [{ front: clozeText, back: "", type: "cloze", extra: details }],
        "Medical English RSVP",
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medical-english-${activeWord.lemma.replace(/[^a-z0-9-]/gi, "-")}.apkg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(t("ui.cloze_cards_exported_for_anki_import_the_file"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingCard(false);
    }
  };

  const downloadAnkiWordCard = async () => {
    if (!sentence || !activeWord || savingWordCard) return;
    setSavingWordCard(true);
    try {
      const choice = unitChoice(activeWord);
      const back = [
        t("ui.message_gloss_candidate_context_not_verified", {
          p0: escapeHtml(choice.gloss),
          p1: escapeHtml(glossStatusLabel(choice.status) || t("ui.no_gloss")),
        }),
        ...dictionaryEntries.map(escapeHtml),
        `<hr>${escapeHtml(sentence.text)}`,
        article?.sourceUrl ? t("ui.message_a_hrefopen_articlea", { p0: escapeHtml(article.sourceUrl) }) : "",
      ]
        .filter(Boolean)
        .join("<br>");
      const blob = await buildApkg(
        [
          {
            front: escapeHtml(activeWord.members.length > 1 ? activeWord.form : activeWord.lemma || activeWord.form),
            back,
            type: "basic",
          },
        ],
        "Medical English Vocabulary",
      );
      downloadApkg(blob, `medical-english-word-${activeWord.lemma.replace(/[^a-z0-9-]/gi, "-")}.apkg`);
      setStatus(t("ui.vocabulary_cards_exported_for_anki_import_the_file"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingWordCard(false);
    }
  };

  const markSentenceInKarakeep = async () => {
    if (!article?.bookmarkId || !sentence || markingSentence) return;
    setMarkingSentence(true);
    try {
      const startOffset = article.transcriptMapping
        ? originalTranscriptOffset(article.transcriptMapping, sentence.start)
        : sentence.start;
      const endOffset = article.transcriptMapping
        ? originalTranscriptOffset(article.transcriptMapping, sentence.end)
        : sentence.end;
      const response = await chrome.runtime.sendMessage({
        type: "karakeep_create_highlight",
        bookmarkId: article.bookmarkId,
        startOffset,
        endOffset,
        text: article.transcriptMapping
          ? article.transcriptMapping.originalText.slice(startOffset, endOffset)
          : sentence.text,
        note: t("ui.message_rsvp_practice", { p0: activeWord?.form ?? "" }),
        color: "yellow",
      });
      if (!response?.ok) throw new Error(response?.message || t("ui.could_not_add_a_highlight_in_karakeep"));
      setStatus(t("ui.highlighted_the_current_sentence_in_karakeep"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMarkingSentence(false);
    }
  };

  const selectSentence = (sentenceIndex: number) => {
    const nextCursor = getSentenceStartCursor(
      words.map((word) => word.sentenceIndex),
      sentenceIndex,
    );
    if (nextCursor < 0) return;
    setCursor(nextCursor);
    setShowSentencePicker(false);
    setPlaying(true);
    requestAnimationFrame(() => sentencePickerTriggerRef.current?.focus());
  };

  const closeSentencePicker = () => {
    setShowSentencePicker(false);
    requestAnimationFrame(() => sentencePickerTriggerRef.current?.focus());
  };

  useEffect(() => {
    const element = focusWordRef.current;
    if (!element || !activeWord) return;
    const measure = () => {
      const available = Math.max(100, element.clientWidth - 24);
      const base = Math.min(76, Math.max(42, window.innerWidth * 0.08));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = `500 ${base}px ${getComputedStyle(element).fontFamily}`;
      const natural = context.measureText(activeWord.form).width;
      setFittedFontSize(natural > available ? Math.max(16, Math.floor((base * available) / natural)) : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeWord?.form]);

  if (showSentencePicker && article) {
    return (
      <SentencePicker
        sentences={sentences}
        text={article.text}
        title={article.title}
        reviewStarts={reviewMarks.map((mark) => mark.start)}
        initialIndex={active?.sentenceIndex ?? 0}
        onCancel={closeSentencePicker}
        onConfirm={selectSentence}
      />
    );
  }

  if (!article && error) {
    return (
      <main className="empty-state">
        <h1>RSVP Reader</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <h1 className="brand-title">{article?.title || "Medical English RSVP"}</h1>
          <div className="source">
            {article?.sourceUrl && (
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                {t("ui.open_article_in_karakeep")}
              </a>
            )}
          </div>
        </div>
        <div className="top-actions">
          <a
            className="button secondary"
            href={chrome.runtime.getURL("reader/history.html")}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("ui.history")}
          </a>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              void readingProgress.flush(true).finally(() => window.close());
            }}
          >
            {t("ui.close")}
          </button>
        </div>
      </header>

      <main className="main-content">
        {(status || error) && (
          <div className="error-banner" role={error ? "alert" : "status"}>
            {error || status}
          </div>
        )}
        <p className="reading-progress-status" role="status">
          {readingProgress.message || (words.length ? t("ui.checking_reading_position") : "")}
        </p>
        <section className="reader-card" aria-label="RSVP reader">
          <button
            ref={sentencePickerTriggerRef}
            className="button sentence-picker-trigger"
            type="button"
            onClick={() => {
              cancelRecording();
              setPlaying(false);
              setShowSentencePicker(true);
            }}
            disabled={!sentences.length || !readingProgress.ready}
          >
            {t("ui.choose_a_sentence_to_resume")}
          </button>
          {previousSentence && (
            <button
              className="sentence-peek previous-sentence"
              type="button"
              disabled={!readingProgress.ready}
              aria-label={t("ui.message_go_to_previous_sentence", { p0: compactUrls(previousSentence.text) })}
              onClick={() => {
                const previousCursor = words.findIndex(
                  (item) => item.sentenceIndex === (active?.sentenceIndex ?? 0) - 1,
                );
                if (previousCursor >= 0) {
                  setCompleted(false);
                  setCursor(previousCursor);
                }
              }}
            >
              <span>{t("ui.previous_sentence")}</span>
              <p>{compactUrls(previousSentence.text)}</p>
            </button>
          )}
          <div className="reader-label">{activeWord ? `${cursor + 1} / ${words.length} words` : "Loading"}</div>
          {sentence?.analysisStatus && sentence.analysisStatus !== "parsed" && (
            <p className="analysis-warning" role="status">
              {sentence.analysisStatus === "unparsed"
                ? t("ui.this_sentence_could_not_be_parsed_words_appear")
                : t("ui.part_of_this_sentence_could_not_be_parsed")}
            </p>
          )}
          <div
            ref={focusWordRef}
            className={`focus-word${playing ? " is-playing" : ""}${activeWord?.members.length === 1 ? " single-word" : ""}`}
            style={
              {
                "--word-enter-duration": `${Math.min(90, (60000 / wpm) * 0.3)}ms`,
                "--focus-font-size": fittedFontSize ? `${fittedFontSize}px` : undefined,
              } as CSSProperties
            }
            aria-live={playing ? "off" : "polite"}
          >
            {activeWord ? (
              <>
                {activeWord.members.length === 1 ? (
                  <>
                    <span key={`before-${cursor}`} className="focus-before">
                      {activeWord.form.slice(0, Math.floor(activeWord.form.length / 3))}
                    </span>
                    <span key={`pivot-${cursor}`} className="focus-pivot">
                      {activeWord.form[Math.floor(activeWord.form.length / 3)]}
                    </span>
                    <span key={`after-${cursor}`} className="focus-after">
                      {activeWord.form.slice(Math.floor(activeWord.form.length / 3) + 1)}
                    </span>
                  </>
                ) : (
                  <span key={`word-${cursor}`} className="focus-text">
                    {activeWord.form}
                  </span>
                )}
                {showGloss && (
                  <span
                    key={`meaning-${cursor}`}
                    className={`focus-meaning${activeWord.members.length > 1 ? " phrase-meaning" : ""}`}
                  >
                    <span className="focus-primary-meaning">
                      {sentenceDictionaryLoaded ? unitChoice(activeWord).gloss : t("ui.loading")}
                    </span>
                    {sentenceDictionaryLoaded && glossStatusLabel(unitChoice(activeWord).status) && (
                      <span className="gloss-evidence">{glossStatusLabel(unitChoice(activeWord).status)}</span>
                    )}
                    {activeWord.members.length > 1 && (
                      <span className="phrase-member-meanings">{memberGloss(activeWord)}</span>
                    )}
                  </span>
                )}
              </>
            ) : (
              <span className="context-line">{status || ""}</span>
            )}
          </div>
          {sentence && activeWord && (
            <div className="sentence-glosses">
              <div className="annotated-sentence">
                {sentenceUnits.map((word, index) => {
                  const wordStart = word.start - sentence.start;
                  const wordEnd = word.end - sentence.start;
                  const previousEnd = index === 0 ? 0 : sentenceUnits[index - 1].end - sentence.start;
                  const entries = unitEntries(word);
                  const choice = sentenceDictionaryLoaded
                    ? unitChoice(word)
                    : { gloss: t("ui.loading"), status: "missing" as const };
                  return (
                    <span className="annotated-word-group" key={word.id}>
                      {wordStart > previousEnd && (
                        <span className="sentence-gap">{compactUrls(sentence.text.slice(previousEnd, wordStart))}</span>
                      )}
                      <button
                        type="button"
                        className={`gloss-token${word.id === activeWord.id ? " current" : ""}${word.members.length > 1 ? " phrase-member" : ""}`}
                        title={
                          showGloss
                            ? `${glossStatusLabel(choice.status)}\n${entries.join("\n\n") || (sentenceDictionaryLoaded ? t("ui.no_dictionary_entry") : t("ui.loading_dictionary"))}`
                            : t("ui.gloss_hidden")
                        }
                        onClick={() => {
                          const nextCursor = words.findIndex(
                            (item) => item.sentenceIndex === active?.sentenceIndex && item.word.id === word.id,
                          );
                          if (readingProgress.ready && nextCursor >= 0) setCursor(nextCursor);
                        }}
                      >
                        <span className="gloss-token-word">{word.form}</span>
                        {word.unparsed && <span className="unparsed-label">{t("ui.unparsed")}</span>}
                        {showGloss && (
                          <span
                            className={`gloss-token-meaning${choice.gloss === t("ui.not_found") ? " missing" : ""}${word.members.length > 1 ? " phrase-primary-meaning" : ""}`}
                          >
                            {choice.gloss}
                          </span>
                        )}
                        {showGloss && choice.status === "multiple" && (
                          <span className="gloss-evidence">{t("ui.multiple_candidates")}</span>
                        )}
                        {showGloss && word.members.length > 1 && (
                          <span className="phrase-member-meanings">{memberGloss(word)}</span>
                        )}
                      </button>
                      {index === sentenceUnits.length - 1 && wordEnd < sentence.text.length && (
                        <span className="sentence-gap">{compactUrls(sentence.text.slice(wordEnd))}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {nextSentence && (
            <button
              className="sentence-peek next-sentence"
              type="button"
              disabled={!readingProgress.ready}
              aria-label={t("ui.message_go_to_next_sentence", { p0: compactUrls(nextSentence.text) })}
              onClick={() => {
                const nextCursor = words.findIndex((item) => item.sentenceIndex === (active?.sentenceIndex ?? -1) + 1);
                if (nextCursor >= 0) {
                  setCompleted(false);
                  setCursor(nextCursor);
                }
              }}
            >
              <span>{t("ui.next_sentence")}</span>
              <p>{compactUrls(nextSentence.text)}</p>
            </button>
          )}
        </section>

        <fieldset className="toolbar">
          <legend className="sr-only">Reading controls</legend>
          <button
            className="button secondary"
            type="button"
            disabled={!readingProgress.ready || cursor <= 0}
            onClick={() => {
              cancelRecording();
              setPlaying(false);
              setCursor((value) => Math.max(0, value - 1));
            }}
          >
            {t("ui.previous")}
          </button>
          <button
            className="button"
            type="button"
            disabled={!words.length || !readingProgress.ready}
            onClick={() => {
              cancelRecording();
              setPlaying((value) => !value);
            }}
          >
            {playing ? t("ui.pause") : t("ui.play")}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!readingProgress.ready || cursor >= words.length - 1}
            onClick={() => {
              cancelRecording();
              setPlaying(false);
              setCursor((value) => Math.min(words.length - 1, value + 1));
            }}
          >
            {t("ui.next")}
          </button>
          <div className="speed-controls">
            <label htmlFor="speed">{t("ui.speed")}</label>
            <div className="speed-meter" style={{ "--speed-progress": (wpm - 100) / 500 } as CSSProperties}>
              <div className="speed-track" aria-hidden="true">
                <span className="speed-fill" />
                <span className="speed-thumb" />
              </div>
              <input
                id="speed"
                aria-label="Words per minute"
                type="range"
                min="100"
                max="600"
                step="10"
                value={wpm}
                onChange={(event) => setWpm(Number(event.target.value))}
              />
            </div>
            <span className="speed-value">{wpm} WPM</span>
          </div>
        </fieldset>
        <fieldset className="study-controls">
          <legend className="sr-only">{t("ui.learning_settings")}</legend>
          <label className="study-mode-select">
            {t("ui.playback_mode")}
            <select
              value={checkMode}
              onChange={(event) => void changeCheckMode(event.target.value as "off" | "text" | "voice")}
              aria-label={t("ui.playback_mode")}
            >
              <option value="off">{t("ui.continuous_playback")}</option>
              <option value="text">{t("ui.answer_each_sentence_text")}</option>
              <option value="voice">{t("ui.answer_each_sentence_voice")}</option>
            </select>
          </label>
          <button
            className="button secondary gloss-toggle"
            type="button"
            aria-pressed={showGloss}
            onClick={() => {
              if (!showGloss && recallStarted && !answerSubmitted) setUsedGloss(true);
              setShowGloss((value) => !value);
            }}
          >
            {t("ui.gloss")}
            {showGloss ? t("ui.visible") : t("ui.hidden")}
          </button>
          <button
            className="button secondary pronunciation"
            type="button"
            disabled={!activeWord}
            onClick={pronounceWord}
            aria-label={t("ui.message_listen_to_the_pronunciation_of", { p0: activeWord?.form ?? "" })}
          >
            {activeWord?.form ?? t("ui.word")}
            {t("ui.pronunciation")}
          </button>
          <details className="reader-actions-menu">
            <summary>{t("ui.more")}</summary>
            <div className="reader-actions-panel">
              <button
                className="button secondary"
                type="button"
                disabled={!sentence || !reviewMarksLoaded}
                aria-pressed={isMarked}
                onClick={() => sentence && updateReviewMarks(sentence)}
              >
                {isMarked ? t("ui.remove_rereading_mark") : t("ui.mark_this_sentence_for_rereading")}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!reviewMarks.length}
                onClick={() => {
                  const next = reviewMarks.find((mark) => mark.start > (sentence?.start ?? -1)) ?? reviewMarks[0];
                  const index = sentences.findIndex((item) => item.start === next.start);
                  if (index >= 0) jumpToSentence(index);
                }}
              >
                {t("ui.next_rereading_sentence")}
                {reviewMarks.length}）
              </button>
              {pronunciationVoices.length > 0 && (
                <label className="pronunciation-voice">
                  {t("ui.pronunciation_voice")}
                  <select
                    aria-label={t("ui.pronunciation_voice")}
                    value={
                      pronunciationVoices.some((voice) => voice.voiceURI === pronunciationVoiceURI)
                        ? pronunciationVoiceURI
                        : ""
                    }
                    onChange={(event) => {
                      setPronunciationVoiceURI(event.target.value);
                      void chrome.storage.local.set({ [PRONUNCIATION_VOICE_KEY]: event.target.value });
                    }}
                  >
                    <option value="">{t("ui.select_automatically")}</option>
                    {pronunciationVoices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
        </fieldset>
        <p className="shortcut-hint">{t("ui.space_play_pause_w_s_speed_a_d")}</p>

        {!playing && sentence && activeWord && (
          <fieldset className="self-check">
            <legend className="sr-only">{t("ui.check_comprehension")}</legend>
            {!recallStarted ? (
              <p>
                {t("ui.explain_the_key_points_in_english_gloss")}
                {showGloss ? t("ui.visible") : t("ui.hidden")}
              </p>
            ) : answerSubmitted ? (
              <p>{t("ui.compare_your_answer_with_the_source_and_syntax")}</p>
            ) : (
              <p>
                {usedGloss
                  ? t("ui.use_the_gloss_to_help_explain_the_key")
                  : t("ui.explain_the_key_points_in_english_without_looking")}
              </p>
            )}
            {!recallStarted ? (
              <button
                className="button tonal"
                type="button"
                onClick={() => {
                  setRecallStarted(true);
                  setUsedGloss(showGloss);
                  requestAnimationFrame(() => answerTextareaRef.current?.focus());
                }}
              >
                {t("ui.answer_this_sentence")}
              </button>
            ) : !answerSubmitted ? (
              <form
                className="self-check-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (answerSubmissionRef.current || !responseText.trim()) return;
                  answerSubmissionRef.current = true;
                  cancelRecording();
                  setAnswerSubmitted(true);
                  setShowGloss(true);
                  if (sentence) {
                    const entry = makeReviewHistoryEntry(
                      article?.title ?? "",
                      sentence.text,
                      getComprehensionHints(sentence),
                      responseText.trim(),
                      answerMethod,
                      usedGloss,
                      { previous: previousSentence?.text, next: nextSentence?.text },
                      openaiSettings.model,
                    );
                    historyEntryRef.current = entry;
                    historySaveRef.current = saveReviewHistoryEntry(entry).catch(() => {
                      setHistoryError(t("ui.could_not_save_this_answer_to_history"));
                    });
                  }
                  void requestReview(responseText.trim());
                }}
              >
                <label htmlFor="comprehension-response">{t("ui.your_answer")}</label>
                <textarea
                  id="comprehension-response"
                  ref={answerTextareaRef}
                  value={responseText}
                  onChange={(event) => {
                    setResponseText(event.target.value);
                    if (!voiceState) setAnswerMethod("text");
                  }}
                  rows={3}
                  placeholder={t("ui.for_example_who_did_what_explain_the_meaning")}
                />
                <div className="voice-controls">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={
                      recording ? stopRecording : recordingPending ? cancelRecording : () => void startRecording()
                    }
                  >
                    {recording
                      ? t("ui.stop_recording")
                      : recordingPending
                        ? t("ui.cancel_microphone_setup")
                        : t("ui.answer_by_voice")}
                  </button>
                  {voiceState && <span role="status">{voiceState}</span>}
                </div>
                <div className="self-check-actions">
                  <button className="button tonal" type="submit" disabled={!responseText.trim()}>
                    {t("ui.review_answer")}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      cancelRecording();
                      setRecallStarted(false);
                      setUsedGloss(false);
                      setShowGloss(true);
                      setResponseText("");
                    }}
                  >
                    {t("ui.cancel")}
                  </button>
                </div>
              </form>
            ) : selfCheckDone ? (
              <div className="self-check-actions">
                <span className="self-check-result" role="status">
                  {t("ui.reviewed")}
                </span>
                {checkMode !== "off" && nextSentence && (
                  <button
                    className="button tonal"
                    type="button"
                    onClick={() => {
                      jumpToSentence((active?.sentenceIndex ?? 0) + 1);
                      setPlaying(true);
                    }}
                  >
                    {t("ui.play_next_sentence")}
                  </button>
                )}
              </div>
            ) : (
              <div className="self-check-feedback">
                {review ? (
                  <>
                    {reviewReused && (
                      <p className="review-assistance">{t("ui.reused_a_saved_review_no_api_request_was")}</p>
                    )}
                    <ReviewResult answer={responseText} review={review} usedGloss={usedGloss} />
                  </>
                ) : (
                  <p className="self-check-answer">
                    <strong>{t("ui.your_answer")}</strong>
                    <br />
                    {responseText}
                  </p>
                )}
                {reviewLoading && (
                  <p className="review-status" role="status">
                    {t("ui.checking_comprehension")}
                  </p>
                )}
                {reviewError && (
                  <div className="review-error" role="alert">
                    {reviewError}{" "}
                    {openaiSettings.apiKey && (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void requestReview(responseText.trim())}
                      >
                        {t("ui.retry")}
                      </button>
                    )}
                  </div>
                )}
                {historyError && (
                  <p className="review-error" role="alert">
                    {historyError}
                  </p>
                )}
                <p className="self-check-source">
                  <strong>{t("ui.english_source")}</strong>
                  <br />
                  {compactUrls(sentence.text)}
                </p>
                <p className="self-check-hints">
                  <strong>{t("ui.syntax_hints_automatic_parsing")}</strong>
                  <br />
                  {getComprehensionHints(sentence).join(" · ") || t("ui.no_syntax_hints")}
                </p>
                <div className="self-check-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      reviewAbortRef.current?.abort();
                      reviewRequestInFlightRef.current = null;
                      setAnswerSubmitted(false);
                      setReview(null);
                      setReviewError("");
                      setReviewLoading(false);
                      setShowGloss(usedGloss);
                    }}
                  >
                    {t("ui.edit_answer")}
                  </button>
                  <button
                    className="button tonal"
                    type="button"
                    disabled={reviewLoading}
                    onClick={() => {
                      if (checkMode !== "off" && nextSentence) {
                        jumpToSentence((active?.sentenceIndex ?? 0) + 1);
                        setPlaying(true);
                      } else setSelfCheckDone(true);
                    }}
                  >
                    {checkMode !== "off" && nextSentence ? t("ui.play_next_sentence") : t("ui.understood")}
                  </button>
                  <details className="reader-actions-menu review-more-menu">
                    <summary>{t("ui.more")}</summary>
                    <div className="reader-actions-panel">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => {
                          if (!isMarked) updateReviewMarks(sentence);
                          jumpToSentence(active?.sentenceIndex ?? 0);
                          setShowGloss(false);
                          setRecallStarted(false);
                          setAnswerSubmitted(false);
                          setResponseText("");
                          setPlaying(true);
                        }}
                      >
                        {t("ui.reread_this_sentence")}
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            )}
          </fieldset>
        )}

        {!playing && sentence && activeWord && (
          <SentenceReview
            sentence={sentence}
            units={sentenceUnits}
            currentWord={activeWord}
            dictionaryEntries={detailEntries}
            sentenceDictionaryEntries={sentenceDictionaryEntries}
            sentenceDictionaryLoaded={sentenceDictionaryLoaded}
            showGloss={showGloss}
            phraseActionLabel={
              phraseSplitsLoaded && (activeSplit || canSplitPhrase)
                ? activeSplit
                  ? t("ui.join_phrase")
                  : t("ui.split_phrase")
                : null
            }
            onTogglePhraseSplit={changePhraseSplit}
            onSelectWord={(word) => {
              const wordCursor = words.findIndex(
                (item) =>
                  item.word.members.some((member) => member.id === word.id) &&
                  item.sentenceIndex === active?.sentenceIndex,
              );
              if (wordCursor >= 0) setCursor(wordCursor);
            }}
            onAddCard={addClozeCard}
            savingCard={savingCard}
            onAddWordCard={downloadAnkiWordCard}
            savingWordCard={savingWordCard}
            onMarkSentence={markSentenceInKarakeep}
            markingSentence={markingSentence}
            sourceUrl={article?.sourceUrl ?? ""}
            bookmarkId={article?.bookmarkId ?? ""}
          />
        )}
      </main>
    </div>
  );
};

const downloadApkg = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type ReviewUnit = ReturnType<typeof groupReadingWords>[number];
type SentenceReviewProps = {
  sentence: ParsedSentence;
  units: ReviewUnit[];
  currentWord: ReviewUnit;
  dictionaryEntries: string[];
  sentenceDictionaryEntries: Record<number, string[]>;
  sentenceDictionaryLoaded: boolean;
  showGloss: boolean;
  phraseActionLabel: string | null;
  onTogglePhraseSplit: () => void;
  onSelectWord: (word: ParsedWord) => void;
  onAddCard: () => void;
  savingCard: boolean;
  onAddWordCard: () => void;
  savingWordCard: boolean;
  onMarkSentence: () => void;
  markingSentence: boolean;
  sourceUrl: string;
  bookmarkId: string;
};

const SentenceReview: React.FC<SentenceReviewProps> = ({
  sentence,
  units,
  currentWord,
  dictionaryEntries,
  sentenceDictionaryEntries,
  sentenceDictionaryLoaded,
  showGloss,
  phraseActionLabel,
  onTogglePhraseSplit,
  onSelectWord,
  onAddCard,
  savingCard,
  onAddWordCard,
  savingWordCard,
  onMarkSentence,
  markingSentence,
  sourceUrl,
  bookmarkId,
}) => {
  const diagramRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef(new Map<number, HTMLButtonElement>());
  const [positions, setPositions] = useState<Record<number, number>>({});
  const width = diagramRef.current?.scrollWidth ?? 0;
  const unitForId = (id: number) => units.find((unit) => unit.members.some((member) => member.id === id));
  const grammarWord = (unit: ReviewUnit) =>
    unit.members.find((member) => member.head === 0 || !unit.members.some((other) => other.id === member.head)) ??
    unit.members[0];
  const headUnit = (unit: ReviewUnit) => unitForId(grammarWord(unit).head);
  const currentHead = headUnit(currentWord);
  const currentGrammar = grammarWord(currentWord);

  useEffect(() => {
    const measure = () => {
      const container = diagramRef.current;
      if (!container) return;
      const root = container.getBoundingClientRect();
      const next: Record<number, number> = {};
      for (const word of units) {
        const element = wordRefs.current.get(word.id);
        if (element) next[word.id] = element.getBoundingClientRect().left - root.left + element.offsetWidth / 2;
      }
      setPositions(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (diagramRef.current) observer.observe(diagramRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [units]);

  const arcs = assignDependencyArcLanes(
    units
      .filter(
        (word) =>
          headUnit(word) && positions[word.id] !== undefined && positions[headUnit(word)?.id ?? -1] !== undefined,
      )
      .map((word) => {
        const child = positions[word.id];
        const head = positions[headUnit(word)?.id ?? -1];
        const labelWidth = Math.max(20, getDependencyLabel(grammarWord(word).deprel).length * 5);
        const simpleRelations = new Set(["nsubj", "nsubj:pass", "obj", "iobj", "det", "case", "aux", "cop"]);
        return {
          word,
          child,
          head,
          left: Math.min(child, head) - labelWidth / 2,
          right: Math.max(child, head) + labelWidth / 2,
          priority: simpleRelations.has(grammarWord(word).deprel) ? 0 : 1,
        };
      }),
  );
  const maxLane = Math.max(-1, ...arcs.map((arc) => arc.lane));
  const arcSvgHeight = Math.max(78, 52 + Math.max(0, maxLane) * 22);

  return (
    <section className="review-panel" aria-labelledby="review-title">
      <div className="top-actions" style={{ justifyContent: "space-between" }}>
        <h2 className="section-title" id="review-title">
          {t("ui.current_sentence")}
        </h2>
        <details className="reader-actions-menu review-actions-menu">
          <summary>{t("ui.phrases_saving")}</summary>
          <div className="reader-actions-panel">
            {phraseActionLabel && (
              <button className="button secondary" type="button" onClick={onTogglePhraseSplit}>
                {phraseActionLabel}
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              onClick={onMarkSentence}
              disabled={markingSentence || !bookmarkId}
            >
              {markingSentence ? t("ui.saving_171") : t("ui.highlight_sentence_in_karakeep")}
            </button>
            <button className="button secondary" type="button" onClick={onAddWordCard} disabled={savingWordCard}>
              {savingWordCard ? t("ui.creating") : t("ui.create_vocabulary_cards_for_anki")}
            </button>
            <button className="button secondary" type="button" onClick={onAddCard} disabled={savingCard}>
              {savingCard ? t("ui.creating") : t("ui.create_a_cloze_card_for_this_word")}
            </button>
          </div>
        </details>
      </div>
      <p className="dependency-focus" aria-live="polite">
        {currentGrammar.unparsed
          ? t("ui.message_dependency_for_could_not_be_parsed", { p0: currentWord.form })
          : !currentHead
            ? t("ui.message_is_the_sentence_root", { p0: currentWord.form })
            : `${currentWord.form} → ${currentHead.form}（${getDependencyLabel(currentGrammar.deprel)}）`}
      </p>
      <div className="sentence-box" style={{ paddingTop: arcSvgHeight + 12 }}>
        <div className="sentence-diagram" ref={diagramRef}>
          <svg
            className="dependency-svg"
            width={Math.max(width, 100)}
            height={arcSvgHeight}
            style={{ top: -arcSvgHeight }}
            aria-hidden="true"
          >
            <defs>
              <marker id="dependency-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M 0 0 L 6 3 L 0 6 z" className="dependency-arrowhead" />
              </marker>
            </defs>
            {[...arcs]
              .sort((a, b) => Number(a.word.id === currentWord.id) - Number(b.word.id === currentWord.id))
              .map(({ word, child, head, lane }) => {
                const baseline = arcSvgHeight - 8;
                const lift = 20 + lane * 22;
                const middle = (head + child) / 2;
                const headWord = headUnit(word);
                return (
                  <g key={word.id} className={word.id === currentWord.id ? "dependency-selected" : "dependency-muted"}>
                    <title>
                      {word.form} {t("ui.separator")}
                      {headWord?.form} {t("ui.depends_on")}
                      {getDependencyLabel(grammarWord(word).deprel)}）
                    </title>
                    <path
                      className="arc-path"
                      d={`M ${child} ${baseline} Q ${middle} ${baseline - lift * 2} ${head} ${baseline}`}
                      markerEnd={word.id === currentWord.id ? "url(#dependency-arrow)" : undefined}
                    />
                    <text className="arc-label" x={middle} y={baseline - lift - 4}>
                      {getDependencyLabel(grammarWord(word).deprel)}
                    </text>
                  </g>
                );
              })}
          </svg>
          {units.map((word) => {
            const isCurrent = word.id === currentWord.id;
            const role = getSentenceRole(grammarWord(word), sentence);
            const entries = word.phraseEntries.length ? word.phraseEntries : (sentenceDictionaryEntries[word.id] ?? []);
            const choice: GlossChoice = !sentenceDictionaryLoaded
              ? { gloss: t("ui.loading"), status: "missing" }
              : word.url
                ? { gloss: t("ui.link"), status: "matched" }
                : grammarWord(word).unparsed
                  ? entries.length
                    ? { gloss: getWordGloss(entries), status: "unverified" }
                    : { gloss: t("ui.unparsed"), status: "missing" }
                  : word.members.length > 1 && !word.phraseEntries.length
                    ? { gloss: t("ui.phrase_no_phrase_gloss"), status: "missing" }
                    : word.phraseEntries.length
                      ? { gloss: getWordGloss(entries), status: "unverified" }
                      : chooseGrammaticalGloss(entries, grammarWord(word), sentence);
            const headForm = headUnit(word)?.form;
            const relation = grammarWord(word).unparsed
              ? t("ui.dependency_not_parsed")
              : headForm
                ? t("ui.message_depends_on", { p0: word.form, p1: headForm })
                : t("ui.sentence_root");
            return (
              <button
                key={word.id}
                ref={(element) => {
                  if (element) wordRefs.current.set(word.id, element);
                  else wordRefs.current.delete(word.id);
                }}
                type="button"
                className={`diagram-word${isCurrent ? " current" : ""}${word.id === currentHead?.id ? " dependency-target" : ""}`}
                aria-label={`${word.form}${showGloss ? `, ${choice.gloss}, ${glossStatusLabel(choice.status)}` : ""}, ${relation}${role ? `, ${role}` : ""}`}
                title={`${relation}${showGloss ? `\n${entries.join("\n\n") || (sentenceDictionaryLoaded ? t("ui.no_dictionary_entry") : t("ui.loading_dictionary"))}` : ""}`}
                onClick={() => onSelectWord(word)}
              >
                <span className="diagram-word-form">{word.form}</span>
                {grammarWord(word).unparsed && <span className="unparsed-label">{t("ui.unparsed")}</span>}
                {role && <span className="word-role">{role}</span>}
                {showGloss && (
                  <span className={`diagram-gloss${choice.gloss === t("ui.not_found") ? " missing" : ""}`}>
                    {choice.gloss}
                  </span>
                )}
                {showGloss && choice.status === "multiple" && (
                  <span className="gloss-evidence">{t("ui.multiple_candidates")}</span>
                )}
                {showGloss && word.members.length > 1 && (
                  <span className="diagram-members">
                    {word.members
                      .map((member) => `${member.form}: ${getWordGloss(sentenceDictionaryEntries[member.id] ?? [])}`)
                      .join(" · ")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="analysis-note">
        {sentence.analysisStatus &&
          sentence.analysisStatus !== "parsed" &&
          t("ui.part_of_this_sentence_could_not_be_parsed_180")}
        {t("ui.labels_indicate_word_roles_arrows_point_to_their")}
      </p>
      <div className="study-grid">
        <article className="study-card">
          <h3>{t("ui.eijiro_entries_and_examples")}</h3>
          <div className="dictionary-entry">
            {showGloss
              ? dictionaryEntries.length
                ? dictionaryEntries.join("\n\n")
                : t("ui.no_dictionary_entry_found_for_this_word_the")
              : t("ui.glosses_are_hidden_select_gloss_hidden_above_to")}
            <p className="example-sentence">{compactUrls(sentence.text)}</p>
          </div>
        </article>
        <article className="study-card">
          <h3>{t("ui.anki_card_front")}</h3>
          <div className="cloze-preview">
            {compactUrls(sentence.text.slice(0, currentWord.start - sentence.start))}
            <strong>［　　　］</strong>
            {compactUrls(sentence.text.slice(currentWord.end - sentence.start))}
          </div>
          <p className="analysis-note">
            {t("ui.creates_an_apkg_with_the_target_word_dictionary")}
            {sourceUrl ? "" : t("ui.no_source_url")}
          </p>
        </article>
      </div>
    </section>
  );
};

const root = document.getElementById("root");
if (root) void initializeLocale().then(() => createRoot(root).render(<ReaderApp />));
