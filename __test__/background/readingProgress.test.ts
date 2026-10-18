import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { handleReadingProgress, progressScope, requestReadingProgress } from "../../src/background/readingProgress";
import config from "../../src/main/core/config";

vi.mock("../../src/main/core/config", () => ({ default: { loadSettings: vi.fn() } }));
const remote = { readingProgressOffset: 12, readingProgressAnchor: "Example", readingProgressPercent: 20 };
let data: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  data = {};
  vi.stubGlobal("crypto", webcrypto);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { data: { json: remote } } }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set: vi.fn(async (values) => {
          Object.assign(data, structuredClone(values));
        }),
      },
    },
  });
  vi.mocked(config.loadSettings).mockResolvedValue({
    karakeepUrl: "https://reader.example",
    karakeepApiKey: "test-key",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("uses v0.33.2 tRPC SuperJSON envelopes and the configured bearer key", async () => {
  await requestReadingProgress("https://reader.example/", "test-key", "abc");
  const [url, options] = fetchMock.mock.calls[0];
  expect(JSON.parse(new URL(url).searchParams.get("input") ?? "null")).toEqual({ json: { bookmarkId: "abc" } });
  expect(options.headers.Authorization).toBe("Bearer test-key");
  await requestReadingProgress("https://reader.example", "test-key", "abc", remote);
  expect(fetchMock.mock.calls[1][0]).toBe("https://reader.example/api/trpc/bookmarks.updateReadingProgress");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ json: { bookmarkId: "abc", ...remote } });
});

test("persists locally before failed sync and retries successfully", async () => {
  const scope = await progressScope("https://reader.example", "test-key");
  const request = {
    bookmarkId: "abc",
    sourceUrl: "https://reader.example/dashboard/preview/abc",
    scope,
    local: { fingerprint: "a".repeat(64), offset: 24, completed: false, remote, baseline: null, pending: true },
  };
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  expect(await handleReadingProgress(request, true)).toMatchObject({ ok: true, synced: false });
  expect(Object.values(data)[0]).toMatchObject({ offset: 24, pending: true });
  expect(await handleReadingProgress(request, true)).toMatchObject({ ok: true, synced: true });
  expect(Object.values(data)[0]).toMatchObject({ offset: 24, pending: false, baseline: remote });
});

test("rejects changed instance/account and never sends an old bookmark to a new server", async () => {
  const scope = await progressScope("https://old.example", "test-key");
  expect(
    await handleReadingProgress({ bookmarkId: "abc", sourceUrl: "https://old.example/dashboard/preview/abc", scope }),
  ).toMatchObject({ ok: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a restored remote position that changed externally is not incorrectly deduplicated", async () => {
  const scope = await progressScope("https://reader.example", "test-key");
  const request = {
    bookmarkId: "abc",
    sourceUrl: "https://reader.example/dashboard/preview/abc",
    scope,
    local: { fingerprint: "b".repeat(64), offset: 24, completed: false, remote, baseline: null, pending: true },
  };
  await handleReadingProgress(request, true);
  fetchMock.mockClear();
  await handleReadingProgress(
    { ...request, local: { ...request.local, baseline: { ...remote, readingProgressOffset: 70 } } },
    true,
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});
