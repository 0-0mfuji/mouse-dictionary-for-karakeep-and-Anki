import { getLocale, t } from "../i18n";
export type VoiceProgress = {
  state: "loading" | "transcribing" | "done" | "error";
  text?: string;
  backend?: string;
  message?: string;
  percent?: number;
};

let worker: Worker | null = null;
let nextId = 0;

const pcmAt16k = async (blob: Blob): Promise<Float32Array> => {
  const bytes = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    if (decoded.duration < 0.2) throw new Error(t("ui.recording_is_too_short_please_speak_again"));
    const frameCount = Math.ceil(decoded.duration * 16000);
    const offline = new OfflineAudioContext(1, frameCount, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0).slice();
  } finally {
    await context.close();
  }
};

export const transcribeRecording = async (
  blob: Blob,
  onProgress: (progress: VoiceProgress) => void,
): Promise<string> => {
  const audio = await pcmAt16k(blob);
  if (!worker) worker = new Worker(chrome.runtime.getURL("reader/transcriptionWorker.js"));
  const currentWorker = worker;
  const id = ++nextId;
  return new Promise<string>((resolve, reject) => {
    const onMessage = (event: MessageEvent<VoiceProgress & { id: number }>) => {
      if (event.data.id !== id) return;
      if (event.data.state === "error") {
        currentWorker.removeEventListener("message", onMessage);
        reject(new Error(event.data.message || t("ui.could_not_transcribe_speech")));
      } else if (event.data.state === "done") {
        currentWorker.removeEventListener("message", onMessage);
        resolve(event.data.text?.trim() ?? "");
      } else {
        onProgress(event.data);
      }
    };
    currentWorker.addEventListener("message", onMessage);
    currentWorker.postMessage(
      { id, audio, language: getLocale(), wasmBase: chrome.runtime.getURL("reader/whisper/") },
      [audio.buffer],
    );
  });
};

export const stopVoiceWorker = (): void => {
  worker?.terminate();
  worker = null;
};
