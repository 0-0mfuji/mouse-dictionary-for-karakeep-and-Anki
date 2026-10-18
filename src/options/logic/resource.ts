/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { getLocale, setLocale, t } from "../../i18n";
import type { TextResourceKeys } from "../resource";

export const setLang = setLocale;
export const getLang = getLocale;
export const get = (key: TextResourceKeys, params?: Record<string, any>): string => {
  const value = t(`legacy.${key}`, params);
  return value === `legacy.${key}` ? key : value;
};
// Explicit preference takes priority; absence always defaults to Japanese.
export const decideInitialLanguage = (_languages?: string[], preference?: unknown): string => {
  return preference === "en" ? "en" : "ja";
};
