import { afterEach, expect, test, vi } from "vitest";
import { registerReaderLauncher } from "../../src/background/readerLauncher";

vi.mock("../../src/main/core/config", () => ({
  default: { loadSettings: async () => ({ karakeepUrl: "https://reader.example/" }) },
}));
afterEach(() => vi.unstubAllGlobals());
test("registers only the already permitted instance and updates open tabs", async () => {
  const register = vi.fn();
  const execute = vi.fn();
  vi.stubGlobal("chrome", {
    scripting: {
      registerContentScripts: register,
      getRegisteredContentScripts: async () => [],
      executeScript: execute,
    },
    permissions: { contains: async () => true },
    tabs: { query: async () => [{ id: 3 }] },
  });
  await registerReaderLauncher();
  expect(register).toHaveBeenCalledWith([
    expect.objectContaining({ matches: ["https://reader.example/*"], js: ["karakeep-reader.js"] }),
  ]);
  expect(execute).toHaveBeenCalledWith({ target: { tabId: 3 }, files: ["karakeep-reader.js"] });
});
test("removes a stale registration when its site permission is missing", async () => {
  const unregister = vi.fn();
  const register = vi.fn();
  vi.stubGlobal("chrome", {
    scripting: {
      registerContentScripts: register,
      getRegisteredContentScripts: async () => [{ id: "karakeep-reader-launcher" }],
      unregisterContentScripts: unregister,
    },
    permissions: { contains: async () => false },
  });
  await registerReaderLauncher();
  expect(unregister).toHaveBeenCalledWith({ ids: ["karakeep-reader-launcher"] });
  expect(register).not.toHaveBeenCalled();
});
