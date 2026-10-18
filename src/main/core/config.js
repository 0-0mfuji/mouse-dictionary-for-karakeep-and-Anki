/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import env from "../env";
import storage from "../lib/storage";
import defaultSettings from "../settings";

const KEY_USER_CONFIG = "**** config ****";
const KEY_LAST_POSITION = "**** last_position ****";
const KEY_LOADED = "**** loaded ****";

const JSON_FIELDS = new Set(["normalDialogStyles", "movingDialogStyles", "hiddenDialogStyles"]);

const mergeStoredSettings = (storedSettings = {}) => withFallbacks({ ...defaultSettings, ...storedSettings });

const loadAll = async () => {
  if (!env.enableUserSettings) {
    return { settings: parseSettings(defaultSettings), position: {} };
  }
  const data = await getStoredData([KEY_USER_CONFIG, KEY_LAST_POSITION]);
  const mergedSettings = mergeStoredSettings(data[KEY_USER_CONFIG]);
  const settings = parseSettings(mergedSettings);

  const position = data[KEY_LAST_POSITION];
  return { settings, position };
};

const loadSettings = async () => {
  const rawSettings = await loadRawSettings();
  return parseSettings(rawSettings);
};

const loadRawSettings = async () => {
  if (!env.enableUserSettings) {
    return { ...defaultSettings };
  }

  const data = await getStoredData([KEY_USER_CONFIG]);
  const userSettings = data[KEY_USER_CONFIG];
  return mergeStoredSettings(userSettings);
};

// A blank string for these fields would otherwise be sent to the Karakeep API as-is
// (e.g. an empty tag name), so fall back to the default rather than merging it in as-is.
const withFallbacks = (settings) => {
  if (!settings.karakeepTag) {
    settings.karakeepTag = defaultSettings.karakeepTag;
  }
  if (!settings.openaiModel) {
    settings.openaiModel = defaultSettings.openaiModel;
  }
  return settings;
};

const parseSettings = (settings) => {
  const result = {};
  const keys = Object.keys(settings);
  for (let i = 0; i < keys.length; i++) {
    const field = keys[i];
    const value = settings[field];
    if (value === null || value === undefined) {
      continue;
    }
    result[field] = JSON_FIELDS.has(field) ? parseJson(value) : value;
  }
  if (!env.enableWindowStatusSave && settings.initialPosition === "keep") {
    result.initialPosition = "right";
  }
  return result;
};

const parseJson = (json) => {
  if (!json) {
    return null;
  }
  let result;
  try {
    result = JSON.parse(json);
  } catch (e) {
    result = null;
    console.error("Failed to parse json:" + json);
    console.error(e);
  }
  return result;
};

const savePosition = async (e) => {
  if (!env.enableUserSettings || !env.enableWindowStatusSave) {
    return;
  }
  return storage.sync.set({
    [KEY_LAST_POSITION]: JSON.stringify(e),
  });
};

const getStoredData = async (keys) => {
  const result = {};
  const storedData = await storage.sync.get(keys);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const json = storedData[key] ?? "{}";
    result[key] = parseJson(json) ?? {};
  }

  return result;
};

const isDataReady = () => storage.local.pick(KEY_LOADED);

export default {
  loadAll,
  loadSettings,
  loadRawSettings,
  parseSettings,
  mergeStoredSettings,
  savePosition,
  isDataReady,
};
