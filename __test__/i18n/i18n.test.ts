import { afterEach, expect, test, vi } from "vitest";
import { getLocale, initializeLocale, localeFromSettings, normalizeLocale, setLocale, t } from "../../src/i18n";
import en from "../../src/i18n/locales/en/translation.json";
import ja from "../../src/i18n/locales/ja/translation.json";
import { reviewComprehension } from "../../src/reader/comprehensionReview";
import { reviewCacheKey } from "../../src/reader/reviewHistory";
import { compareRevisions, requestCritique, requestPass } from "../../src/writer/critique";
import { PASSES } from "../../src/writer/passes";

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
});
const flatten = (value: object, prefix = ""): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "string" ? [[prefix + key, item]] : Object.entries(flatten(item, `${prefix}${key}.`)),
    ),
  );
test("catalogs have the same keys and interpolation variables", () => {
  const a = flatten(ja),
    b = flatten(en);
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const key of Object.keys(a)) {
    expect(b[key], key).not.toBe("");
    const parameters = (value: string) => [...value.matchAll(/\{\{\{?(\w+)\}?\}\}/g)].map((m) => m[1]).sort();
    expect(parameters(b[key]), key).toEqual(parameters(a[key]));
  }
});
test("defaults to Japanese, normalizes saved preferences, and interpolates without replacing missing variables", () => {
  expect(normalizeLocale(undefined)).toBe("ja");
  expect(normalizeLocale("ar")).toBe("ja");
  expect(normalizeLocale("en-US")).toBe("en");
  expect(localeFromSettings("{broken")).toBe("ja");
  expect(localeFromSettings(JSON.stringify({ language: "en" }))).toBe("en");
  setLocale("en");
  expect(t("legacy.finishRegister", { count: 123 })).toContain("123 words");
  expect(t("settings.language")).toBe("Language");
  setLocale("unsupported");
  expect(getLocale()).toBe("ja");
  expect(t("settings.language")).toBe("言語");
});
test("loads a saved language and follows sync storage changes", async () => {
  let onChanged: any;
  vi.stubGlobal("chrome", {
    storage: {
      sync: { get: vi.fn(async () => ({ "**** config ****": JSON.stringify({ language: "en" }) })) },
      onChanged: {
        addListener: (listener: any) => {
          onChanged = listener;
        },
      },
    },
  });
  await initializeLocale();
  expect(getLocale()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  onChanged({ "**** config ****": { newValue: JSON.stringify({ language: "ja" }) } }, "sync");
  expect(getLocale()).toBe("ja");
});
test("requests use the current locale for reading, writing, passes, and comparisons", async () => {
  const mock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({ findings: [], winner: "tie", reason: "equal", remaining: [] }),
    }),
  }));
  vi.stubGlobal("fetch", mock);
  for (const language of ["ja", "en"]) {
    setLocale(language);
    await requestCritique("Manuscript", "key", "model");
    await requestPass("Manuscript", PASSES[0], "key", "model");
    await compareRevisions("A", "B", "key", "model");
    await reviewComprehension("Source", "Answer", "text", false, "key", "model").catch(() => {});
    const bodies = mock.mock.calls.slice(-4).map((call: any) => JSON.parse(call[1].body));
    expect(bodies[0].instructions).toContain(language === "en" ? "strict editor" : "厳格な編集者");
    expect(bodies[1].instructions).toContain(language === "en" ? "Check only" : "1点だけ");
    expect(bodies[2].instructions).toContain(language === "en" ? "in English" : "日本語で");
    expect(bodies[3].instructions).toBe(t("prompts.REVIEW_INSTRUCTIONS"));
    for (const body of bodies) expect(body.instructions).not.toMatch(/\{\{\w+\}\}/);
  }
});
test("review cache is separated by language", () => {
  const key = () => reviewCacheKey("Source", "Answer", "text", false, "model", {});
  setLocale("ja");
  const japanese = key();
  setLocale("en");
  expect(key()).not.toBe(japanese);
});
