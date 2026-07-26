import { afterEach, expect, test, vi } from "vitest";
import { collectAnkiEntries, mergeDuplicateFronts } from "../../../src/options/logic/karakeepExport";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("mergeDuplicateFronts should keep unique words as-is", () => {
  const result = mergeDuplicateFronts([
    { front: "apple", back: "a fruit" },
    { front: "banana", back: "another fruit" },
  ]);

  expect(result).toEqual([
    { front: "apple", back: "a fruit" },
    { front: "banana", back: "another fruit" },
  ]);
});

test("mergeDuplicateFronts should merge case-insensitive duplicates, joining backs with <hr>", () => {
  const result = mergeDuplicateFronts([
    { front: "Hypertrophy", back: "enlargement of an organ" },
    { front: "banana", back: "a fruit" },
    { front: "hypertrophy", back: "seen in cardiac muscle" },
  ]);

  expect(result).toEqual([
    { front: "Hypertrophy", back: "enlargement of an organ<hr>seen in cardiac muscle" },
    { front: "banana", back: "a fruit" },
  ]);
});

test("mergeDuplicateFronts should trim whitespace and drop empty backs", () => {
  const result = mergeDuplicateFronts([
    { front: "  apple ", back: "  a fruit  " },
    { front: "apple", back: "  " },
  ]);

  expect(result).toEqual([{ front: "apple", back: "a fruit" }]);
});

test("collectAnkiEntries should paginate notes and highlights, then merge duplicates", async () => {
  const responses: Record<string, unknown> = {
    "https://karakeep.example.com/api/v1/tags": {
      tags: [{ id: "tag1", name: "vocab" }],
      nextCursor: null,
    },
    "https://karakeep.example.com/api/v1/tags/tag1/bookmarks?limit=50&includeContent=true": {
      bookmarks: [
        { title: "apple", content: { type: "text", text: "a fruit" } },
        { title: "ignored", content: { type: "link" } },
      ],
      nextCursor: "page2",
    },
    "https://karakeep.example.com/api/v1/tags/tag1/bookmarks?limit=50&includeContent=true&cursor=page2": {
      bookmarks: [{ title: "banana", content: { type: "text", text: "another fruit" } }],
      nextCursor: null,
    },
    "https://karakeep.example.com/api/v1/highlights?limit=50": {
      highlights: [{ text: "apple", note: "seen in a recipe" }],
      nextCursor: null,
    },
  };

  const fetchMock = vi.fn(async (url: string) => {
    const body = responses[url];
    if (!body) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  const progressStages: string[] = [];
  const entries = await collectAnkiEntries("https://karakeep.example.com", "api-key", "vocab", (p) =>
    progressStages.push(`${p.stage}:${p.page}`),
  );

  expect(entries).toEqual([
    { front: "apple", back: "a fruit<hr>seen in a recipe" },
    { front: "banana", back: "another fruit" },
  ]);
  expect(progressStages).toEqual(["notes:1", "notes:2", "highlights:1"]);
});
