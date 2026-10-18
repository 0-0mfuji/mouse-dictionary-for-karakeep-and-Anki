import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => {}),
  settings: { width: 320 },
}));
vi.mock("../../../src/options/extern", () => ({
  config: { loadRawSettings: async () => mocks.settings, isDataReady: async () => true, saveSettings: mocks.save },
  defaultSettings: { get: () => ({ width: 200 }) },
  env: { get: () => ({ enableUserSettings: true, support: {} }) },
}));
vi.mock("../../../src/options/logic", () => ({
  data: { preProcessSettings: (s: unknown) => s, postProcessSettings: (s: unknown) => s },
  res: { getLang: () => "ja", get: (key: string) => key },
  dict: {},
  message: {},
}));
vi.mock("../../../src/options/logic/preview", () => ({
  usePreview: () => ({ updatePreview: vi.fn(), setPreviewVisible: vi.fn() }),
}));
vi.mock("../../../src/options/component/atom", () => ({
  Panel: ({ active, children }: any) => (active ? children : null),
  Overlay: ({ active, children }: any) => (active ? children : null),
  Button: ({ onClick, text }: any) => (
    <button type="button" onClick={onClick}>
      {text}
    </button>
  ),
  EditableSpan: () => null,
  DataUsage: () => null,
}));
vi.mock("../../../src/options/component/organism", () => ({
  BasicSettings: ({ onUpdate }: any) => (
    <button type="button" onClick={() => onUpdate(undefined, { width: 480 })}>
      change
    </button>
  ),
  AdvancedSettings: () => null,
  KarakeepSettings: () => null,
  OpenAISettings: () => null,
  LoadDictionary: () => null,
  WholeSettings: () => null,
}));

import { Main } from "../../../src/options/page/Main";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.useFakeTimers();
  mocks.save.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("VERSION", "test");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Main />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find((el) => el.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button?.click());
};
test("opens writing from home and does not save settings on initial load", () => {
  expect(host.querySelector('a[href$="writer/index.html"]')).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});
test("automatically saves changes and protects the page while a save is pending", async () => {
  await click("辞書の表示");
  await click("change");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(mocks.save).toHaveBeenCalledWith({ width: 480 });
  expect(host.textContent).toContain("保存しました");
  const saved = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);
});
test("shows failed persistence and retries the current settings", async () => {
  mocks.save.mockRejectedValueOnce(new Error("offline"));
  await click("辞書の表示");
  await click("change");
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(host.textContent).toContain("保存できませんでした");
  await click("再試行");
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("保存しました");
});

test("language selector comes first, switches immediately, and persists without losing other settings", async () => {
  const select = host.querySelector<HTMLSelectElement>("#interface-language");
  if (!select) throw new Error("Missing language selector");
  expect(select.value).toBe("ja");
  expect(select.disabled).toBe(false);
  expect(host.querySelector("main")?.firstElementChild?.contains(select)).toBe(true);
  await act(async () => {
    select.value = "en";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.documentElement.lang).toBe("en");
  expect(host.querySelector("h1")?.textContent).toBe("Home");
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(mocks.save).toHaveBeenCalledWith({ width: 320, language: "en" });
  expect(host.textContent).toContain("Saved");
});
