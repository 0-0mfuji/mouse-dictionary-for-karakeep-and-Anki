import { env, type ProgressInfo, pipeline } from "@huggingface/transformers";
import { locales, setLocale, t } from "../i18n";

type Request = { id: number; audio: Float32Array; wasmBase: string; language?: string };
type SpeechPipeline = Awaited<ReturnType<typeof pipeline>>;
let transcriber: SpeechPipeline | null = null;
let backend: "webgpu" | "wasm" = "wasm";

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, audio, wasmBase, language } = event.data;
  setLocale(language);
  try {
    env.allowLocalModels = false;
    if (!env.backends.onnx.wasm) throw new Error(t("ui.whisper_wasm_runtime_is_missing"));
    env.backends.onnx.wasm.wasmPaths = wasmBase;
    if (!transcriber) {
      self.postMessage({ id, state: "loading" });
      let lastPercent = -1;
      const onModelProgress = (progress: ProgressInfo) => {
        if (progress.status !== "progress_total" || progress.total <= 0 || !Number.isFinite(progress.progress)) return;
        const percent = Math.max(0, Math.min(100, Math.floor(progress.progress)));
        if (percent === lastPercent) return;
        lastPercent = percent;
        self.postMessage({ id, state: "loading", percent });
      };
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          transcriber = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
            device: "webgpu",
            progress_callback: onModelProgress,
          });
          backend = "webgpu";
        } catch {
          transcriber = null;
          lastPercent = -1;
          self.postMessage({ id, state: "loading" });
        }
      }
      if (!transcriber) {
        transcriber = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
          device: "wasm",
          progress_callback: onModelProgress,
        });
        backend = "wasm";
      }
    }
    self.postMessage({ id, state: "transcribing", backend });
    const result = await (transcriber as any)(audio, {
      language: locales.find((item) => item.code === language)?.speech ?? "japanese",
      task: "transcribe",
    });
    self.postMessage({ id, state: "done", text: result.text ?? "", backend });
  } catch (error) {
    self.postMessage({ id, state: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
