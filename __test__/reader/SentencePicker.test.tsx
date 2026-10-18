import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { ParsedSentence } from "../../src/reader/readerLogic";
import { SentencePicker } from "../../src/reader/SentencePicker";

const sentences = ["First sentence.", "Second sentence.", "Last sentence."].map((text, index) => ({
  text,
  start: index * 17,
  end: index * 17 + text.length,
  words: [{}],
})) as ParsedSentence[];
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(initialIndex = 1, reducedMotion = true) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  let scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const options = [...document.querySelectorAll(".sentence-option")];
    const index = options.indexOf(this);
    const top = index < 0 ? 0 : 200 + index * 80 - scrollTop;
    return {
      top,
      bottom: top + (index < 0 ? 400 : 40),
      left: 0,
      right: 600,
      width: 600,
      height: 40,
      x: 0,
      y: top,
      toJSON() {},
    };
  });
  const scroll = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    scrollTop = options.top ?? 0;
    this.scrollTop = scrollTop;
    this.dispatchEvent(new Event("scroll"));
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  HTMLElement.prototype.scrollTo = scroll;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  await act(async () =>
    root.render(
      <SentencePicker
        sentences={sentences}
        text={sentences.map((s) => s.text).join(" ")}
        title="Example"
        initialIndex={initialIndex}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, scroll, onConfirm, onCancel, region: host.querySelector(".sentence-picker-scroll") as HTMLElement };
}

test("opens with current sentence centered; arrows reach the last sentence and Enter confirms", async () => {
  const { host, scroll, region, onConfirm } = await mount();
  expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
  expect(document.activeElement).toBe(region);
  await act(async () => region.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(host.querySelectorAll('[aria-pressed="true"]')[0].textContent).toBe("Last sentence.");
  expect(scroll).toHaveBeenLastCalledWith({ top: 180, behavior: "instant" });
  await act(async () => region.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onConfirm).toHaveBeenCalledWith(2);
});

test("click selects without confirming; Escape cancels", async () => {
  const { host, onConfirm, onCancel, region, scroll } = await mount();
  await act(async () => (host.querySelector(".sentence-option") as HTMLElement).click());
  expect(scroll).toHaveBeenLastCalledWith({ top: 20, behavior: "instant" });
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => region.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onCancel).toHaveBeenCalledOnce();
});

test("manual scroll snaps the nearest sentence to the center after scrolling stops", async () => {
  vi.useFakeTimers();
  const { region, scroll, host } = await mount(0);
  await act(async () => {
    region.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    region.scrollTo({ top: 160 });
    vi.advanceTimersByTime(200);
  });
  expect(scroll).toHaveBeenLastCalledWith({ top: 180, behavior: "instant" });
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe("Last sentence.");
});

test("motion advances gradually, can be interrupted and retargets from the current position", async () => {
  vi.useFakeTimers();
  const { region, scroll } = await mount(0, false);
  await act(async () => region.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(region.scrollTop).toBe(20);
  await act(async () => vi.advanceTimersByTime(160));
  expect(region.scrollTop).toBeGreaterThan(20);
  expect(region.scrollTop).toBeLessThan(180);
  await act(async () => region.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
  const interruptedPosition = region.scrollTop;
  const calls = scroll.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(600));
  expect(scroll).toHaveBeenCalledTimes(calls);
  expect(region.scrollTop).toBe(interruptedPosition);
  await act(async () => region.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  await act(async () => vi.advanceTimersByTime(800));
  expect(region.scrollTop).toBe(20);
});
