/**
 * Mouse Dictionary (https://github.com/wtetsu/mouse-dictionary/)
 * Copyright 2018-present wtetsu
 * Licensed under MIT
 */

import JSZip from "jszip";
// sql.js's package.json "exports" map resolves the bare "sql.js" specifier to its "browser" build
// (dist/sql-wasm-browser.js) under esbuild's default browser platform conditions - the plain
// dist/sql-wasm.js build isn't bundler-safe here (it still has Node-only `require("node:fs")`
// paths that fail to resolve). The browser build's own wasm filename is sql-wasm-browser.wasm
// (copied alongside it by tools/build.js), not sql-wasm.wasm.
import initSqlJs from "sql.js";

export type AnkiNote = {
  front: string;
  back: string;
  type?: "basic" | "cloze";
  extra?: string;
};

// Anki's legacy (pre-"anki21b") collection schema version, as written by genanki and widely
// understood to import cleanly into current Anki versions.
const SCHEMA_VERSION = 11;
const DEFAULT_DECK_ID = 1;

const defaultLocateFile = (file: string) => chrome.runtime.getURL(`options/${file}`);

export const buildApkg = async (
  notes: AnkiNote[],
  deckName = "Karakeep Vocabulary",
  locateFile: (file: string) => string = defaultLocateFile,
): Promise<Blob> => {
  const SQL = await initSqlJs({ locateFile });
  const db = new SQL.Database();

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const modelId = now;
  const clozeModelId = now + 2;
  const deckId = now + 1;

  db.run(SCHEMA_SQL);
  db.run(
    "INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, '{}')",
    [
      nowSec,
      now,
      now,
      SCHEMA_VERSION,
      JSON.stringify(buildConf(deckId, modelId)),
      JSON.stringify(buildModels(modelId, deckId, nowSec, deckName, clozeModelId)),
      JSON.stringify(buildDecks(deckId, nowSec, deckName)),
      JSON.stringify(buildDeckConf(nowSec)),
    ],
  );

  let idCounter = now;
  for (const note of notes) {
    idCounter += 1;
    const noteId = idCounter;
    idCounter += 1;
    const cardId = idCounter;

    const guid = generateGuid();
    const isCloze = note.type === "cloze";
    const noteModelId = isCloze ? clozeModelId : modelId;
    const flds = `${note.front}${isCloze ? (note.extra ?? note.back) : note.back}`;
    const sfld = note.front;
    const csum = await checksum(sfld);

    db.run(
      "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')",
      [noteId, guid, noteModelId, nowSec, flds, sfld, csum],
    );

    db.run(
      "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')",
      [cardId, noteId, deckId, nowSec, noteId - now],
    );
  }

  const data = db.export();
  db.close();

  const zip = new JSZip();
  zip.file("collection.anki2", data);
  zip.file("media", "{}");
  return zip.generateAsync({ type: "blob" });
};

const checksum = async (text: string): Promise<number> => {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-1", bytes);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return Number.parseInt(hex.substring(0, 8), 16);
};

const generateGuid = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

const buildModels = (modelId: number, deckId: number, nowSec: number, name: string, clozeModelId: number) => ({
  [modelId]: {
    id: modelId,
    name,
    type: 0,
    mod: nowSec,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
        did: null,
        bqfmt: "",
        bafmt: "",
      },
    ],
    flds: [
      { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
    ],
    css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
  },
  [clozeModelId]: {
    id: clozeModelId,
    name: `${name} Cloze`,
    type: 1,
    mod: nowSec,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: [
      {
        name: "Cloze",
        ord: 0,
        qfmt: "{{cloze:Text}}",
        afmt: "{{cloze:Text}}<hr id=answer>{{Extra}}",
        did: null,
        bqfmt: "",
        bafmt: "",
      },
    ],
    flds: [
      { name: "Text", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Extra", ord: 1, sticky: false, rtl: false, font: "Arial", size: 16, media: [] },
    ],
    css: ".card { font-family: arial; font-size: 20px; text-align: left; color: black; background-color: white; } .cloze { font-weight: bold; }",
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "all", [0]]],
    tags: [],
    vers: [],
  },
});

const buildDecks = (deckId: number, nowSec: number, name: string) => ({
  [DEFAULT_DECK_ID]: buildDeckEntry(DEFAULT_DECK_ID, "Default", nowSec),
  [deckId]: buildDeckEntry(deckId, name, nowSec),
});

const buildDeckEntry = (id: number, name: string, nowSec: number) => ({
  id,
  name,
  extendRev: 50,
  usn: -1,
  collapsed: false,
  newToday: [0, 0],
  timeToday: [0, 0],
  dyn: 0,
  extendNew: 10,
  conf: 1,
  revToday: [0, 0],
  lrnToday: [0, 0],
  browserCollapsed: false,
  desc: "",
  mod: nowSec,
});

const buildDeckConf = (nowSec: number) => ({
  [DEFAULT_DECK_ID]: {
    id: DEFAULT_DECK_ID,
    mod: nowSec,
    name: "Default",
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
    rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
    dyn: false,
  },
});

const buildConf = (deckId: number, modelId: number) => ({
  nextPos: 1,
  estTimes: true,
  activeDecks: [deckId],
  sortType: "noteFld",
  timeLim: 0,
  sortBackwards: false,
  addToCur: true,
  curDeck: deckId,
  newBury: true,
  newSpread: 0,
  dueCounts: true,
  curModel: String(modelId),
  collapseTime: 1200,
});

const SCHEMA_SQL = `
CREATE TABLE col (
  id integer primary key,
  crt integer not null,
  mod integer not null,
  scm integer not null,
  ver integer not null,
  dty integer not null,
  usn integer not null,
  ls integer not null,
  conf text not null,
  models text not null,
  decks text not null,
  dconf text not null,
  tags text not null
);
CREATE TABLE notes (
  id integer primary key,
  guid text not null,
  mid integer not null,
  mod integer not null,
  usn integer not null,
  tags text not null,
  flds text not null,
  sfld text not null,
  csum integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE cards (
  id integer primary key,
  nid integer not null,
  did integer not null,
  ord integer not null,
  mod integer not null,
  usn integer not null,
  type integer not null,
  queue integer not null,
  due integer not null,
  ivl integer not null,
  factor integer not null,
  reps integer not null,
  lapses integer not null,
  left integer not null,
  odue integer not null,
  odid integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);
CREATE TABLE graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;
