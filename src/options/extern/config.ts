/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */
/* istanbul ignore file */

import orgConfig from "../../main/core/config";
import storage from "../../main/lib/storage";
import type { MouseDictionarySettings } from "../types";

const KEY_USER_CONFIG = "**** config ****";
const KEY_LOADED = "**** loaded ****";
const KEY_BYTES_IN_USE = "**** bytes_in_use ****";

const { isDataReady } = orgConfig;

export { isDataReady };

const KEY_OPENAI_API_KEY = "reader_openai_api_key";

export const loadRawSettings = async (): Promise<MouseDictionarySettings> => {
  const [settings, local] = await Promise.all([
    orgConfig.loadRawSettings() as Promise<MouseDictionarySettings>,
    storage.local.get([KEY_OPENAI_API_KEY]),
  ]);
  return { ...settings, openaiApiKey: local[KEY_OPENAI_API_KEY] ?? "" };
};

export const saveSettings = async (settings: MouseDictionarySettings): Promise<void> => {
  const { openaiApiKey, ...syncedSettings } = settings;
  await Promise.all([
    storage.sync.set({ [KEY_USER_CONFIG]: JSON.stringify(syncedSettings) }),
    storage.local.set({ [KEY_OPENAI_API_KEY]: openaiApiKey ?? "" }),
  ]);
};

export const setDataReady = (ready: boolean): Promise<void> => storage.local.set({ [KEY_LOADED]: ready });

export const getBytesInUse = (): Promise<number> => storage.local.pick(KEY_BYTES_IN_USE);

export const setBytesInUse = (bytes: number): Promise<void> => storage.local.set({ [KEY_BYTES_IN_USE]: bytes });
