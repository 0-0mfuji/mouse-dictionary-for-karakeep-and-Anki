import { expect, test } from "vitest";
import config from "../../../src/main/core/config";

test("new settings defaults merge without overwriting saved Karakeep credentials", () => {
  const saved = {
    karakeepUrl: "https://my-karakeep.example",
    karakeepApiKey: "saved-token",
    karakeepTag: "medical-vocab",
    oldCustomField: "keep-me",
  };
  const merged = config.mergeStoredSettings(saved);
  expect(merged).toMatchObject({
    karakeepUrl: saved.karakeepUrl,
    karakeepApiKey: saved.karakeepApiKey,
    karakeepTag: saved.karakeepTag,
    oldCustomField: saved.oldCustomField,
  });
  expect(merged).toHaveProperty("karakeepHighlightColor", "yellow");
});
