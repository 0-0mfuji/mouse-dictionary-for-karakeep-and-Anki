import { parseConllu } from "./conllu";
import { alignParsedSentences } from "./readerLogic";
import { maskUrlsForParsing, restoreUrlOffsets } from "./urlText";

let parserModule;
let modelPointer;

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (message?.type !== "parse") return;

  try {
    const { masked, spans } = maskUrlsForParsing(message.text);
    const mod = await getParser(message.assets);
    const outputPointer = mod.ccall(
      "udpipe_process",
      "number",
      ["number", "string", "string", "string", "string", "string"],
      [modelPointer, masked, "tokenize", "", "", "conllu"],
    );
    if (!outputPointer) throw new Error(mod.ccall("udpipe_last_error", "string", [], []) || "Parsing failed.");
    const conllu = mod.UTF8ToString(outputPointer);
    mod.ccall("udpipe_free_string", null, ["number"], [outputPointer]);
    const parsed = parseConllu(conllu);
    self.postMessage({
      id: message.id,
      sentences: restoreUrlOffsets(message.text, alignParsedSentences(masked, parsed), spans),
    });
  } catch (error) {
    const { masked, spans } = maskUrlsForParsing(message.text);
    self.postMessage({
      id: message.id,
      sentences: restoreUrlOffsets(message.text, alignParsedSentences(masked, []), spans),
      warning: error instanceof Error ? error.message : String(error),
    });
  }
});

const getParser = async (assets) => {
  if (parserModule) return parserModule;
  const runtime = await import(assets.runtimeUrl);
  const factory = runtime.default;
  // This runtime initializes synchronously; preload bytes instead of using its
  // asynchronous instantiateWasm hook, which returns before runtime startup.
  const wasmResponse = await fetch(assets.wasmUrl);
  if (!wasmResponse.ok) throw new Error(`Unable to load the parser runtime (${wasmResponse.status}).`);
  parserModule = await factory({
    wasmBinary: new Uint8Array(await wasmResponse.arrayBuffer()),
    locateFile: () => assets.wasmUrl,
  });
  const response = await fetch(assets.modelUrl);
  if (!response.ok) throw new Error(`Unable to load the English parser model (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pointer = parserModule._malloc(bytes.length);
  if (!pointer) throw new Error("Unable to allocate parser model memory.");
  parserModule.HEAPU8.set(bytes, pointer);
  modelPointer = parserModule.ccall("udpipe_load_model", "number", ["number", "number"], [pointer, bytes.length]);
  parserModule._free(pointer);
  if (!modelPointer) {
    throw new Error(
      parserModule.ccall("udpipe_last_error", "string", [], []) || "Unable to load the English parser model.",
    );
  }
  return parserModule;
};
