/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import { useRef, useState } from "react";
import { message, res } from "../../logic";
import { buildApkg } from "../../logic/anki";
import { collectAnkiEntries } from "../../logic/karakeepExport";
import type { MouseDictionaryAdvancedSettings, UpdateEventHandler } from "../../types";
import { Button } from "../atom";

type KarakeepSettingsProps = {
  settings: MouseDictionaryAdvancedSettings;
  onUpdate: UpdateEventHandler;
};

const toOriginPattern = (url: string): string | null => {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const HIGHLIGHT_COLORS = ["yellow", "red", "green", "blue"] as const;
const HIGHLIGHT_COLOR_LABEL_KEYS = {
  yellow: "karakeepColorYellow",
  red: "karakeepColorRed",
  green: "karakeepColorGreen",
  blue: "karakeepColorBlue",
} as const;

export const KarakeepSettings: React.FC<KarakeepSettingsProps> = (props) => {
  const karakeepUrl = props.settings?.karakeepUrl ?? "";
  const karakeepApiKey = props.settings?.karakeepApiKey ?? "";
  const karakeepTag = props.settings?.karakeepTag ?? "";
  const karakeepHighlightColor = props.settings?.karakeepHighlightColor ?? "yellow";

  // Remembers which origin permission was granted last, so a later change to
  // karakeepUrl can revoke the now-unused one instead of leaving it behind.
  const grantedOriginRef = useRef<string | null>(toOriginPattern(karakeepUrl));

  const [exportProgress, setExportProgress] = useState<string | null>(null);

  const update = (patch: Partial<MouseDictionaryAdvancedSettings>) => {
    props.onUpdate(undefined, patch);
  };

  const grantAccess = async () => {
    const newOrigin = toOriginPattern(karakeepUrl);
    if (!newOrigin) {
      message.warn(res.get("karakeepPermissionError"));
      return;
    }
    try {
      const granted = await chrome.permissions.request({ origins: [newOrigin] });
      if (!granted) {
        message.warn(res.get("karakeepAccessDenied"));
        return;
      }
      const previousOrigin = grantedOriginRef.current;
      if (previousOrigin && previousOrigin !== newOrigin) {
        await chrome.permissions.remove({ origins: [previousOrigin] });
      }
      grantedOriginRef.current = newOrigin;
      message.success(res.get("karakeepAccessGranted"));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const exportToAnki = async () => {
    if (exportProgress !== null) {
      return;
    }
    if (!karakeepUrl || !karakeepApiKey) {
      message.warn(res.get("karakeepPermissionError"));
      return;
    }
    try {
      const entries = await collectAnkiEntries(karakeepUrl, karakeepApiKey, karakeepTag, (progress) => {
        const stageLabel = res.get(
          progress.stage === "notes" ? "karakeepExportStageNotes" : "karakeepExportStageHighlights",
        );
        setExportProgress(res.get("karakeepExporting", { stage: stageLabel, page: progress.page }));
      });

      if (entries.length === 0) {
        message.warn(res.get("karakeepExportNoEntries"));
        return;
      }

      setExportProgress(res.get("karakeepExportBuilding"));
      const blob = await buildApkg(entries);
      downloadBlob(blob, "karakeep-vocab.apkg");

      message.success(res.get("karakeepExportSuccess", { count: entries.length }));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExportProgress(null);
    }
  };

  return (
    <form className="settingsForm">
      <fieldset>
        <h2>{res.get("karakeepSettings")}</h2>
        <label>{res.get("karakeepUrlLabel")}</label>
        &nbsp;
        <input
          type="text"
          value={karakeepUrl}
          onChange={(e) => update({ karakeepUrl: e.target.value })}
          style={{ width: 400 }}
          placeholder="https://karakeep.example.com"
        />
        <br />
        <label>{res.get("karakeepApiKeyLabel")}</label>
        &nbsp;
        <input
          type="password"
          value={karakeepApiKey}
          onChange={(e) => update({ karakeepApiKey: e.target.value })}
          style={{ width: 400 }}
        />
        <br />
        <label>{res.get("karakeepTagLabel")}</label>
        &nbsp;
        <input
          type="text"
          value={karakeepTag}
          onChange={(e) => update({ karakeepTag: e.target.value })}
          style={{ width: 200 }}
          placeholder="vocab"
        />
        <br />
        <label>{res.get("karakeepHighlightColorLabel")}</label>
        <div style={{ marginLeft: 10, marginBottom: 10 }}>
          {HIGHLIGHT_COLORS.map((color) => (
            <label key={color} style={{ marginRight: 20 }}>
              <input
                type="radio"
                name="karakeepHighlightColor"
                value={color}
                checked={karakeepHighlightColor === color}
                onChange={() => update({ karakeepHighlightColor: color })}
              />
              {res.get(HIGHLIGHT_COLOR_LABEL_KEYS[color])}
            </label>
          ))}
        </div>
        <Button type="revert" text={res.get("karakeepGrantAccess")} onClick={grantAccess} />
        <Button
          type="revert"
          text={exportProgress ?? res.get("karakeepExportToAnki")}
          disabled={exportProgress !== null}
          onClick={exportToAnki}
        />
      </fieldset>
    </form>
  );
};
