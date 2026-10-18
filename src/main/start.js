/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { setLocale } from "../i18n";
import config from "./core/config";

import launch from "./core/launch";

const main = async () => {
  DEBUG && console.time("launch");
  const settings = await config.loadRawSettings();
  setLocale(settings.language, false);
  await launch();
  DEBUG && console.timeEnd("launch");
};

main();
