import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useReadingProgress } from "../../src/reader/useReadingProgress";

vi.mock("../../src/reader/readingProgress", async (original) => ({
  ...(await original<typeof import("../../src/reader/readingProgress")>()),
  fingerprintText: async () => "a".repeat(64),
}));
const remote = { readingProgressOffset: 0, readingProgressAnchor: "One two three.", readingProgressPercent: 0 };
const article = {
  bookmarkId: "abc",
  sourceUrl: "https://example.com/dashboard/preview/abc",
  text: "One two three.",
  progressMap: { totalLength: 14, paragraphs: [{ start: 0, end: 14, offset: 0, anchor: "One two three." }] },
};
const words = [{ word: { start: 0, end: 3 } }, { word: { start: 4, end: 7 } }, { word: { start: 8, end: 13 } }];
let api: {
  setCursor: (index: number) => void;
  setPlaying: (playing: boolean) => void;
  ready: boolean;
  cursor: number;
  flush: (force?: boolean) => Promise<void>;
  setUnits: (units: typeof words) => void;
};
function Harness() {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [units, setUnits] = useState(words);
  const progress = useReadingProgress(article, units, cursor, playing, false, setCursor);
  api = { setCursor, setPlaying, setUnits, ready: progress.ready, cursor, flush: progress.flush };
  return <p>{progress.message}</p>;
}
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("changing phrase grouping does not reload saved progress or jump the cursor", async () => {
  const send = await mount();
  await act(async () => {
    api.setCursor(2);
    api.setUnits([{ word: { start: 0, end: 7 } }, { word: { start: 8, end: 13 } }]);
    api.setCursor(1);
  });
  expect(api.cursor).toBe(1);
  expect(send.mock.calls.filter(([request]) => request.type === "rsvp_progress_load")).toHaveLength(1);
});
async function mount() {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sendMessage = vi.fn().mockImplementation(async (request) =>
    request.type === "rsvp_progress_load"
      ? {
          ok: true,
          scope: "scope",
          remoteAvailable: true,
          remote,
          local: { fingerprint: "a".repeat(64), offset: 4, remote, baseline: remote, pending: false, completed: false },
        }
      : { ok: true, synced: true },
  );
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return sendMessage;
}

test("restores the exact word without writing on open or idle; pausing persists the current word", async () => {
  const send = await mount();
  expect(api.ready).toBe(true);
  expect(api.cursor).toBe(1);
  await act(async () => vi.advanceTimersByTime(6000));
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    api.setPlaying(true);
    api.setCursor(2);
  });
  await act(async () => api.setPlaying(false));
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: "rsvp_progress_save", local: { offset: 8 } });
});

test("continuous reading saves on the interval and pagehide enqueues the newest word during an in-flight save", async () => {
  const send = await mount();
  let resolveSave: (result: unknown) => void = () => {};
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  await act(async () => api.setPlaying(true));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: "rsvp_progress_save", local: { offset: 4 } });
  await act(async () => api.setCursor(2));
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: "rsvp_progress_save", local: { offset: 8 } });
  await act(async () => resolveSave({ ok: true, synced: true }));
});
