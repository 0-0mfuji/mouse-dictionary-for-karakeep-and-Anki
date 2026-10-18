import type { Mark } from "./marks";
import type { MethodResult } from "./methods";

export type WriterDoc = {
  id: string;
  title: string;
  frontmatter: string;
  body: string;
  marks: Mark[];
  /** Keys of rule-based marks the writer chose to ignore. */
  localDismissed?: string[];
  updatedAt: number;
  source?: string;
};
export type Revision = {
  id: string;
  docId: string;
  createdAt: number;
  body: string;
  label: string;
  major: boolean;
};

export type ComparisonRecord = {
  id: string;
  docId: string;
  docTitle: string;
  createdAt: number;
  model: string;
  result: MethodResult;
};

const DB_NAME = "karakeep-writer";
let opened: Promise<IDBDatabase> | undefined;
const open = (): Promise<IDBDatabase> => {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("revisions")) {
        db.createObjectStore("revisions", { keyPath: "id" }).createIndex("docId", "docId");
      }
      if (!db.objectStoreNames.contains("comparisons")) {
        db.createObjectStore("comparisons", { keyPath: "id" }).createIndex("docId", "docId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
};

const run = async <T>(
  store: "docs" | "revisions" | "comparisons",
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const listDocs = async (): Promise<WriterDoc[]> =>
  (await run<WriterDoc[]>("docs", "readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getDoc = (id: string) => run<WriterDoc | undefined>("docs", "readonly", (s) => s.get(id));
export const putDoc = (doc: WriterDoc) => run("docs", "readwrite", (s) => s.put(doc));

export const listRevisions = async (docId: string): Promise<Revision[]> =>
  (await run<Revision[]>("revisions", "readonly", (s) => s.index("docId").getAll(docId))).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
export const putRevision = (revision: Revision) => run("revisions", "readwrite", (s) => s.put(revision));

export const deleteDoc = async (id: string): Promise<void> => {
  await run("docs", "readwrite", (s) => s.delete(id));
  for (const revision of await listRevisions(id)) await run("revisions", "readwrite", (s) => s.delete(revision.id));
  for (const record of await listComparisons(id)) await run("comparisons", "readwrite", (s) => s.delete(record.id));
};

export const putComparison = (record: ComparisonRecord) => run("comparisons", "readwrite", (s) => s.put(record));
export const listComparisons = async (docId: string): Promise<ComparisonRecord[]> =>
  (await run<ComparisonRecord[]>("comparisons", "readonly", (s) => s.index("docId").getAll(docId))).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
