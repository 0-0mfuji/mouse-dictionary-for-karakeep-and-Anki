import type { ParsedSentence } from "./readerLogic";

type ParseResponse = { id?: string; type?: string; sentences?: ParsedSentence[]; error?: string };

export const createParserClient = () => {
  const worker = new Worker(chrome.runtime.getURL("reader/worker.js"));
  const pending = new Map<string, { resolve: (value: ParsedSentence[]) => void; reject: (error: Error) => void }>();

  worker.addEventListener("message", (event: MessageEvent<ParseResponse>) => {
    const message = event.data;
    if (message.type === "fatal") {
      for (const task of pending.values()) task.reject(new Error(message.error ?? "Parser failed to start."));
      pending.clear();
      return;
    }
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.sentences ?? []);
  });

  return {
    parse(text: string): Promise<ParsedSentence[]> {
      const id = crypto.randomUUID();
      const base = "reader/wasm/";
      worker.postMessage({
        type: "parse",
        id,
        text,
        assets: {
          runtimeUrl: chrome.runtime.getURL(`${base}udpipe-wasm.mjs`),
          wasmUrl: chrome.runtime.getURL(`${base}udpipe-wasm.wasm`),
          modelUrl: chrome.runtime.getURL(`${base}english-gum-ud-2.5-191206.udpipe`),
        },
      });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close(): void {
      worker.terminate();
      for (const task of pending.values()) task.reject(new Error("Parser stopped."));
      pending.clear();
    },
  };
};
