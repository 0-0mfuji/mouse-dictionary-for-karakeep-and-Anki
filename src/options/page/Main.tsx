import { getLocale, locales, normalizeLocale, setLocale, t } from "../../i18n";
import { useLocale } from "../../i18n/react";
/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { produce } from "immer";
import { useEffect, useReducer, useRef, useState } from "react";
import { Button, DataUsage, EditableSpan, Overlay, Panel } from "../component/atom";
import {
  AdvancedSettings,
  BasicSettings,
  KarakeepSettings,
  LoadDictionary,
  OpenAISettings,
  WholeSettings,
} from "../component/organism";
import { config, defaultSettings, env } from "../extern";
import { data, dict, message, res } from "../logic";
import { detectFileEncoding } from "../logic/encoding";
import { usePreview } from "../logic/preview";

import type { TextResourceKeys } from "../resource";
import type { DictionaryFile, MouseDictionarySettings } from "../types";

declare const VERSION: string;

type MainState = {
  dictDataUsage?: number;
  busy: boolean;
  progress: string;
  settings: MouseDictionarySettings;
  previewText: string;
  panelLevel: 0 | 1 | 2 | 3;
  lang: string;
  initialized: boolean;
};

type Action =
  | {
      type: "patch";
      statePatch: Partial<MainState> | undefined;
      settingsPatch: Partial<MouseDictionarySettings> | undefined;
    }
  | {
      type: "replace";
      settings: MouseDictionarySettings;
    };

const reducer = (state: MainState, action: Action): MainState => {
  switch (action.type) {
    case "patch":
      return produce(state, (d) => {
        Object.assign(d, action.statePatch);
        Object.assign(d.settings, action.settingsPatch);
      });
    case "replace":
      return produce(state, (d) => {
        d.settings = action.settings;
      });
  }
};

const initialState: MainState = {
  dictDataUsage: undefined,
  busy: false,
  progress: "",
  settings: {} as MouseDictionarySettings,
  previewText: "rained cats and dogs",
  panelLevel: 0,
  lang: "",
  initialized: false,
};

type UpdateState = (state: Partial<MainState>) => void;

export const Main: React.FC = () => {
  const language = useLocale();
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    lang: res.getLang(),
  });

  const [section, setSection] = useState("home");
  const [saveStatus, setSaveStatus] = useState("ui.changes_are_saved_automatically");
  const loadedSettings = useRef<MouseDictionarySettings | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const [retry, setRetry] = useState(0);
  const { updatePreview, setPreviewVisible, previewHost } = usePreview();

  useEffect(() => {
    const init = async () => {
      const settings = data.preProcessSettings(await config.loadRawSettings());
      updatePreview(settings, state.previewText, true);
      loadedSettings.current = settings;
      setLocale(settings.language);
      updateState({ settings, lang: getLocale() });

      const isLoaded = await config.isDataReady();
      if (!isLoaded) {
        const ok = await confirmAndLoadInitialDict("confirmLoadInitialDict", updateState);
        updateState({ initialized: ok, dictDataUsage: -1 });
        return;
      }
      updateState({ initialized: true });
    };
    init();
  }, []);
  useEffect(() => {
    if (!state.initialized) return;
    updatePreview(state.settings, state.previewText, true);
  }, [state.settings, state.previewText]);

  useEffect(() => {
    if (!state.initialized) return;
    const visible = state.panelLevel >= 1 && state.panelLevel <= 2;
    setPreviewVisible(visible);
  }, [state.panelLevel, state.initialized]);

  useEffect(() => {
    if (!loadedSettings.current || state.settings === loadedSettings.current) return;
    pendingSaves.current += 1;
    setSaveStatus("ui.saving");
    let started = false;
    const timer = window.setTimeout(() => {
      started = true;
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          await config.saveSettings(data.postProcessSettings(state.settings));
          if (pendingSaves.current === 1) setSaveStatus("ui.saved");
        } catch {
          setSaveStatus("ui.could_not_save_please_retry");
        } finally {
          pendingSaves.current -= 1;
        }
      });
    }, 800);
    return () => {
      window.clearTimeout(timer);
      if (!started) pendingSaves.current -= 1;
    };
  }, [state.settings, retry]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingSaves.current > 0 || saveStatus === "ui.could_not_save_please_retry") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus]);

  const updateState = (
    statePatch: Record<string, any> | undefined,
    settingsPatch: Partial<MouseDictionarySettings> | undefined = undefined,
  ): void => {
    dispatch({ type: "patch", statePatch, settingsPatch });
  };

  const doFactoryReset = (): void => {
    dispatch({
      type: "replace",
      settings: data.preProcessSettings(defaultSettings.get()),
    });
  };

  useEffect(() => {
    if (loadedSettings.current) setLocale(state.settings.language);
  }, [state.settings.language]);

  const sections = [
    ["home", t("ui.home")],
    ["appearance", t("ui.dictionary_appearance")],
    ["connections", "Karakeep・Anki"],
    ["ai", t("ui.ai_voice_input")],
    ["advanced", t("ui.advanced_settings")],
  ];
  const navigate = (id: string) => {
    setSection(id);
    updateState({ panelLevel: id === "appearance" ? 1 : id === "advanced" ? 2 : 0 });
  };
  return (
    <div className="settings-shell">
      <header className="app-bar">
        <div className="app-brand">
          <img className="app-logo" src="../icons/brand-mark.svg" alt="" width="48" height="48" />
          <div className="app-brand-name">
            <strong>Mouse Dictionary</strong>
            <span className="app-subtitle">for Karakeep and Anki</span>
          </div>
        </div>
        <a className="filled-action" href={chrome.runtime.getURL("writer/index.html")} target="_blank" rel="noreferrer">
          {t("ui.start_writing")}
        </a>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("ui.settings_categories")}>
          {sections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
          <a href="pdf/web/viewer.html" target="_blank" rel="noreferrer">
            {t("ui.read_a_pdf")}
          </a>
          <a
            className="settings-version"
            href="https://github.com/0-0mfuji/mouse-dictionary-for-karakeep-and-Anki"
            target="_blank"
            rel="noopener noreferrer"
          >
            v{VERSION}
          </a>
        </nav>
        <main className="settings-content">
          <section className="language-setting settings-card" aria-labelledby="language-label">
            <div>
              <label id="language-label" htmlFor="interface-language">
                {t("settings.language")}
              </label>
              <p id="language-help">{t("settings.languageHelp")}</p>
            </div>
            <select
              id="interface-language"
              aria-describedby="language-help"
              value={language}
              disabled={!loadedSettings.current}
              onChange={(event) => {
                const next = normalizeLocale(event.target.value);
                setLocale(next);
                updateState({ lang: next }, { language: next });
              }}
            >
              {locales.map((item) => (
                <option key={item.code} value={item.code} lang={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </section>
          <div className="page-heading">
            <h1>{sections.find(([id]) => id === section)?.[1]}</h1>
            <div className="save-status" role="status">
              {t(saveStatus)}
              {saveStatus === "ui.could_not_save_please_retry" && (
                <button type="button" onClick={() => setRetry(retry + 1)}>
                  {t("ui.retry")}
                </button>
              )}
            </div>
          </div>
          {section === "home" && (
            <>
              <section className="welcome-card">
                <h2>{t("ui.make_todays_words_your_own")}</h2>
                <p>{t("ui.look_up_words_read_pdfs_write_and_refine")}</p>
                <div className="quick-actions">
                  <a
                    className="filled-action"
                    href={chrome.runtime.getURL("writer/index.html")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("ui.open_writing_mode")}
                  </a>
                  <a className="outlined-action" href="pdf/web/viewer.html" target="_blank" rel="noreferrer">
                    {t("ui.open_a_pdf")}
                  </a>
                </div>
                <p className="shortcut-hint">{t("ui.writing_shortcut_alt_shift_w_chrome")}</p>
              </section>
              <section className="settings-card">
                <h2>{t("ui.dictionary_data")}</h2>
                <p>{t("ui.import_dictionary_files_to_use_them_in_your")}</p>
                <LoadDictionary busy={state.busy} trigger={(e) => loadDictionaryData(e.payload, updateState)} />
                <Panel active={env.get().support.localGetBytesInUse && !state.busy}>
                  <DataUsage
                    byteSize={state.dictDataUsage}
                    onUpdate={(byteSize) => updateState({ dictDataUsage: byteSize })}
                  />
                </Panel>
              </section>
            </>
          )}
          <p role="status">{state.progress}</p>
          {!loadedSettings.current && section !== "home" && <p>{t("ui.loading_settings")}</p>}
          <Panel active={!state.busy && env.get().enableUserSettings && !!loadedSettings.current}>
            <section
              className="settings-card settings-preview"
              hidden={state.panelLevel < 1 || state.panelLevel > 2}
              aria-labelledby="dictionary-preview-heading"
            >
              <h2 id="dictionary-preview-heading">{t("settings.preview")}</h2>
              <label>{res.get("previewText")}</label>
              <EditableSpan
                value={state.previewText}
                style={{ width: 300 }}
                onChange={(e) => updateState({ previewText: e.target.value })}
              />
              <div className="settings-preview-viewport" ref={previewHost} />
            </section>
            {section === "appearance" && (
              <>
                <BasicSettings onUpdate={updateState} busy={state.busy} settings={state.settings}>
                  <label>{res.get("dictionaryData")}</label>
                  <Button
                    type="revert"
                    text={res.get("loadInitialDict")}
                    disabled={state.busy}
                    onClick={() => confirmAndLoadInitialDict("confirmReloadInitialDict", updateState)}
                  />
                </BasicSettings>
              </>
            )}
            {section === "connections" && <KarakeepSettings onUpdate={updateState} settings={state.settings} />}
            {section === "ai" && <OpenAISettings onUpdate={updateState} settings={state.settings} />}
            {section === "advanced" && (
              <>
                <AdvancedSettings onUpdate={updateState} settings={state.settings} />
                <section className="settings-card">
                  <h2>{t("ui.manage_settings")}</h2>
                  <Button
                    type="json"
                    text={res.get("openJsonEditor")}
                    disabled={state.busy}
                    onClick={() => updateState({ panelLevel: 3 })}
                  />
                  <button
                    type="button"
                    className="outlined-action"
                    onClick={() => {
                      if (window.confirm(t("ui.reset_settings_to_their_defaults_this_change_will"))) doFactoryReset();
                    }}
                  >
                    {res.get("defaultSettings")}
                  </button>
                </section>
              </>
            )}
          </Panel>
        </main>
      </div>
      <Overlay active={state.panelLevel >= 3}>
        <WholeSettings
          initialValue={state.settings}
          onChange={(newSettings) => updateState({ panelLevel: 2 }, newSettings)}
        />
      </Overlay>
    </div>
  );
};

const confirmAndLoadInitialDict = async (messageId: TextResourceKeys, updateState: UpdateState): Promise<boolean> => {
  const willLoad = await message.notice(res.get(messageId), "okCancel");
  if (!willLoad) {
    return false;
  }

  let finalWordCount: number;
  try {
    updateState({ busy: true, panelLevel: 0 });
    finalWordCount = await dict.registerDefaultDict((count, progress) => {
      const message = res.get("progressRegister", { count, progress });
      updateState({ progress: message });
    });
    updateState({ dictDataUsage: -1 });
  } finally {
    updateState({ busy: false, progress: "" });
  }
  await config.setDataReady(true);
  await message.success(res.get("finishRegister", { count: finalWordCount }));

  return true;
};

const loadDictionaryData = async (dictionaryFile: DictionaryFile, updateState: UpdateState): Promise<void> => {
  const { file, encoding, format } = dictionaryFile;
  if (!file) {
    message.warn(res.get("selectDictFile"));
    return;
  }
  if (encoding === "Shift_JIS" && (await detectFileEncoding(file)) !== "Shift_JIS") {
    const willContinue = await message.warn(res.get("fileMayNotBeShiftJis"), "okCancel");
    if (!willContinue) {
      return;
    }
  }
  try {
    updateState({ busy: true, panelLevel: 0 });
    const count = await dict.load({ file, encoding, format }, (ev) => {
      if (ev.name === "reading") {
        const progress = `${ev.loaded.toLocaleString()} / ${ev.total.toLocaleString()} Byte`;
        updateState({ progress });
      }
      if (ev.name === "loading") {
        const progress = res.get("progressRegister", {
          count: ev.count?.toLocaleString(),
          progress: ev.word.head,
        });
        updateState({ progress });
      }
    });
    message.success(res.get("finishRegister", { count: count?.toLocaleString() }));
    config.setDataReady(true);
  } catch (e) {
    if (e instanceof Error) {
      message.error(e.toString());
    } else {
      message.error(String(e));
    }
  } finally {
    updateState({ busy: false, progress: "", dictDataUsage: -1 });
  }
};
