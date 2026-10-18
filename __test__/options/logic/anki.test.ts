// @vitest-environment node
//
// This suite exercises sql.js/JSZip's binary output directly. jsdom's Blob/Response
// implementation doesn't preserve binary content correctly, so this file runs under
// the plain Node environment instead of the project's default jsdom one.
import * as path from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { expect, test } from "vitest";
import { buildApkg } from "../../../src/options/logic/anki";

// In tests there's no chrome.runtime.getURL, so point sql.js directly at its own wasm file on disk.
const locateFile = (file: string) => path.join(require.resolve("sql.js/dist/sql-wasm.js"), "..", file);

test("buildApkg should produce a zip containing a valid Anki collection with the given notes", async () => {
  const blob = await buildApkg(
    [
      { front: "apple", back: "a fruit" },
      { front: "banana", back: "another fruit<hr>seen in a recipe" },
    ],
    "Test Deck",
    locateFile,
  );

  const zip = await JSZip.loadAsync(await new Response(blob).arrayBuffer());
  expect(zip.file("media")).not.toBeNull();
  expect(await zip.file("media")?.async("string")).toEqual("{}");

  const collectionFile = zip.file("collection.anki2");
  expect(collectionFile).not.toBeNull();
  const collectionBytes = await collectionFile?.async("uint8array");
  expect(collectionBytes).toBeDefined();

  const SQL = await initSqlJs({ locateFile });
  const db = new SQL.Database(collectionBytes);

  const noteRows = db.exec("SELECT sfld, flds FROM notes ORDER BY sfld");
  expect(noteRows[0].values).toEqual([
    ["apple", "applea fruit"],
    ["banana", "bananaanother fruit<hr>seen in a recipe"],
  ]);

  const cardCount = db.exec("SELECT COUNT(*) FROM cards")[0].values[0][0];
  expect(cardCount).toEqual(2);

  const colRows = db.exec("SELECT ver FROM col")[0].values;
  expect(colRows).toEqual([[11]]);

  db.close();
});

test("buildApkg should produce an empty but valid collection when there are no notes", async () => {
  const blob = await buildApkg([], "Test Deck", locateFile);
  const zip = await JSZip.loadAsync(await new Response(blob).arrayBuffer());
  const collectionBytes = await zip.file("collection.anki2")?.async("uint8array");

  const SQL = await initSqlJs({ locateFile });
  const db = new SQL.Database(collectionBytes);
  const noteCount = db.exec("SELECT COUNT(*) FROM notes")[0].values[0][0];
  expect(noteCount).toEqual(0);
  db.close();
});

test("buildApkg should create Anki Cloze notes for RSVP sentences", async () => {
  const blob = await buildApkg(
    [{ front: "Treatment {{c1::reduced}} mortality.", back: "", type: "cloze", extra: "reduce — 減らす" }],
    "Medical English RSVP",
    locateFile,
  );
  const zip = await JSZip.loadAsync(await new Response(blob).arrayBuffer());
  const collectionBytes = await zip.file("collection.anki2")?.async("uint8array");
  const SQL = await initSqlJs({ locateFile });
  const db = new SQL.Database(collectionBytes);
  const row = db.exec("SELECT n.mid, n.flds, m.models FROM notes n JOIN col m ON m.id = 1")[0].values[0];
  const models = JSON.parse(String(row[2]));
  const clozeModel = models[String(row[0])];
  expect(String(row[1])).toBe("Treatment {{c1::reduced}} mortality.\u001freduce — 減らす");
  expect(clozeModel.type).toBe(1);
  expect(clozeModel.tmpls[0].qfmt).toBe("{{cloze:Text}}");
  expect(db.exec("SELECT COUNT(*) FROM cards")[0].values[0][0]).toBe(1);
  db.close();
});
