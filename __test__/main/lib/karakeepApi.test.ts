import { expect, test } from "vitest";
import { buildKarakeepApiUrl } from "../../../src/main/lib/karakeepApi";

test("Karakeep API URL construction keeps user base URL independent of API version", () => {
  expect(buildKarakeepApiUrl("https://karakeep.example.com/", "/bookmarks")).toBe(
    "https://karakeep.example.com/api/v1/bookmarks",
  );
  expect(buildKarakeepApiUrl("https://karakeep.example.com/prefix", "highlights")).toBe(
    "https://karakeep.example.com/prefix/api/v1/highlights",
  );
});
