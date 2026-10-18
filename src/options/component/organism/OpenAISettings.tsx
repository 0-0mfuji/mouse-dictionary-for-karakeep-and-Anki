import { useState } from "react";
import { t } from "../../../i18n";
import type { MouseDictionaryAdvancedSettings, UpdateEventHandler } from "../../types";

type Props = { settings: MouseDictionaryAdvancedSettings; onUpdate: UpdateEventHandler };

export const OpenAISettings: React.FC<Props> = ({ settings, onUpdate }) => {
  const MODELS = [
    ["gpt-6-luna", t("ui.gpt6_luna_default")],
    ["gpt-6.1-sol", "GPT-6.1 Sol"],
    ["gpt-6-astra", "GPT-6 Astra"],
  ] as const;

  const [permissionStatus, setPermissionStatus] = useState("");
  const [modelPermissionStatus, setModelPermissionStatus] = useState("");
  const model = settings.openaiModel || "gpt-6-luna";
  const grantAccess = async () => {
    try {
      const granted = await chrome.permissions.request({ origins: ["https://api.openai.com/*"] });
      setPermissionStatus(granted ? t("ui.api_access_granted") : t("ui.connection_permission_is_required"));
    } catch (error) {
      setPermissionStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const grantModelAccess = async () => {
    try {
      const granted = await chrome.permissions.request({ origins: ["https://huggingface.co/*", "https://*.hf.co/*"] });
      setModelPermissionStatus(
        granted
          ? t("ui.whisper_model_download_allowed")
          : t("ui.connection_permission_is_required_to_download_the_whisper"),
      );
    } catch (error) {
      setModelPermissionStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <form className="settingsForm ai-settings" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <h2>{t("ui.ai_reading_review")}</h2>
        <p className="ai-settings-description">{t("ui.the_english_text_and_your_answer_are_sent")}</p>
        <div className="ai-settings-field">
          <label htmlFor="openai-api-key">{t("ui.openai_api_key")}</label>
          <input
            id="openai-api-key"
            type="password"
            autoComplete="off"
            value={settings.openaiApiKey ?? ""}
            onChange={(event) => onUpdate(undefined, { openaiApiKey: event.target.value })}
          />
          <small>{t("ui.the_key_is_stored_in_this_browsers_extension")}</small>
        </div>
        <div className="ai-settings-field">
          <label htmlFor="openai-model">{t("ui.review_model")}</label>
          <select
            id="openai-model"
            value={model}
            onChange={(event) => onUpdate(undefined, { openaiModel: event.target.value })}
          >
            {!MODELS.some(([id]) => id === model) && <option value={model}>{model}</option>}
            {MODELS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={grantAccess}>
          {t("ui.allow_openai_api_access")}
        </button>
        {permissionStatus && <p role="status">{permissionStatus}</p>}
        <p className="ai-settings-description">
          <a href={chrome.runtime.getURL("writer/index.html")} target="_blank" rel="noreferrer">
            {t("ui.open_writing_mode_35")}
          </a>
          {t("ui.ai_reviews_your_own_writing_you_can_also")}
        </p>
        <p className="ai-settings-description">{t("ui.voice_input_downloads_a_multilingual_whisper_model_to")}</p>
        <button type="button" onClick={grantModelAccess}>
          {t("ui.allow_whisper_model_download")}
        </button>
        {modelPermissionStatus && <p role="status">{modelPermissionStatus}</p>}
      </fieldset>
    </form>
  );
};
