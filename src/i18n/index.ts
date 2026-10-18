import en from "./locales/en/translation.json";
import ja from "./locales/ja/translation.json";

// Register a catalog here when adding a locale. Use native language names in the selector.
export const locales = [
  { code: "ja", name: "日本語", dir: "ltr", speech: "japanese" },
  { code: "en", name: "English", dir: "ltr", speech: "english" },
] as const;
export type Locale = (typeof locales)[number]["code"];
export const DEFAULT_LOCALE: Locale = "ja";
const catalogs = { ja, en };
let locale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
export const normalizeLocale = (value: unknown): Locale => {
  const code = typeof value === "string" ? value.toLowerCase().split(/[-_]/)[0] : "";
  return locales.some((item) => item.code === code) ? (code as Locale) : DEFAULT_LOCALE;
};
export const getLocale = (): Locale => locale;
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const setLocale = (value: unknown, updateDocument = true): void => {
  const next = normalizeLocale(value);
  const changed = locale !== next;
  locale = next;
  if (updateDocument && typeof document !== "undefined") {
    document.documentElement.lang = next;
    document.documentElement.dir = locales.find((item) => item.code === next)?.dir ?? "ltr";
  }
  if (changed) for (const listener of listeners) listener();
};
const lookup = (catalog: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined),
      catalog,
    );
export const t = (key: string, params: Record<string, string | number> = {}): string => {
  const value = lookup(catalogs[locale], key) ?? lookup(catalogs.ja, key);
  if (typeof value !== "string") return key;
  return value.replace(/\{\{\{?(\w+)\}?\}\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
};
const CONFIG_KEY = "**** config ****";
export const localeFromSettings = (raw: unknown): Locale => {
  try {
    const settings = typeof raw === "string" ? JSON.parse(raw) : raw;
    return normalizeLocale(settings?.language);
  } catch {
    return DEFAULT_LOCALE;
  }
};
let initialization: Promise<void> | undefined;
export const initializeLocale = (): Promise<void> => {
  initialization ??= (async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.sync) {
      setLocale(DEFAULT_LOCALE);
      return;
    }
    // Register first so updates during the initial read are observed too.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[CONFIG_KEY]) setLocale(localeFromSettings(changes[CONFIG_KEY].newValue));
    });
    try {
      const stored = await chrome.storage.sync.get(CONFIG_KEY);
      setLocale(localeFromSettings(stored[CONFIG_KEY]));
    } catch {
      setLocale(DEFAULT_LOCALE);
    }
  })();
  return initialization;
};
