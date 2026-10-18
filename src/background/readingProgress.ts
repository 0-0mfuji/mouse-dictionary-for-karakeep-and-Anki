import { setLocale, t } from "../i18n";
import config from "../main/core/config";
import {
  fingerprintText,
  type LocalProgress,
  type RemoteProgress,
  sameRemoteProgress,
} from "../reader/readingProgress";

// v0.33.2 exposes progress through tRPC, not the public REST bookmark update route.
export async function requestReadingProgress(
  baseUrl: string,
  apiKey: string,
  bookmarkId: string,
  progress?: RemoteProgress,
): Promise<RemoteProgress | null> {
  const input = { json: { bookmarkId, ...progress } };
  const method = progress ? "updateReadingProgress" : "getReadingProgress";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/trpc/bookmarks.${method}`;
  const response = await fetch(progress ? url : `${url}?input=${encodeURIComponent(JSON.stringify(input))}`, {
    method: progress ? "POST" : "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    ...(progress ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? t("dictionary.progressAccess")
        : t("dictionary.progressSyncFailed", { status: response.status }),
    );
  const result = await response.json();
  if (result.error || !result.result || !("data" in result.result)) throw new Error(t("dictionary.progressResponse"));
  if (progress) return null;
  const data = result.result.data?.json;
  if (!validRemote(data)) throw new Error(t("dictionary.progressFormat"));
  return data;
}

const validRemote = (data: RemoteProgress | null): data is RemoteProgress =>
  !!data &&
  (data.readingProgressOffset === null ||
    (Number.isInteger(data.readingProgressOffset) && data.readingProgressOffset >= 0)) &&
  (data.readingProgressAnchor === null ||
    (typeof data.readingProgressAnchor === "string" && data.readingProgressAnchor.length <= 50)) &&
  (data.readingProgressPercent === null ||
    (Number.isInteger(data.readingProgressPercent) &&
      data.readingProgressPercent >= 0 &&
      data.readingProgressPercent <= 100));

export const progressScope = (baseUrl: string, apiKey: string): Promise<string> =>
  fingerprintText(`${baseUrl.replace(/\/+$/, "")}\n${apiKey}`);
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(key, next);
  void next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
    .catch(() => undefined);
  return next;
}

type Request = { bookmarkId: string; sourceUrl: string; scope?: string; local?: LocalProgress };
export async function handleReadingProgress(request: Request, save = false) {
  try {
    const { karakeepUrl, karakeepApiKey, language } = await config.loadSettings();
    setLocale(language, false);
    if (!karakeepUrl) throw new Error(t("dictionary.connectionRequired"));
    const scope = await progressScope(karakeepUrl, karakeepApiKey || "");
    const source = new URL(request.sourceUrl);
    const expected = new URL(
      `${karakeepUrl.replace(/\/+$/, "")}/dashboard/preview/${encodeURIComponent(request.bookmarkId)}`,
    );
    if (
      !request.bookmarkId ||
      source.origin !== expected.origin ||
      source.pathname !== expected.pathname ||
      (request.scope && request.scope !== scope) ||
      (save && request.scope !== scope)
    ) {
      throw new Error(t("dictionary.connectionChanged"));
    }
    const key = `rsvp_progress_v1_${scope}_${request.bookmarkId}`;
    return await serialize(key, async () => {
      const stored = await chrome.storage.local.get(key);
      const previous = (stored[key] as LocalProgress | undefined) ?? null;
      if (!save) {
        try {
          if (!karakeepApiKey) throw new Error(t("dictionary.progressKey"));
          const remote = await requestReadingProgress(karakeepUrl, karakeepApiKey, request.bookmarkId);
          return { ok: true, scope, local: previous, remote, remoteAvailable: true };
        } catch (error) {
          return {
            ok: true,
            scope,
            local: previous,
            remote: null,
            remoteAvailable: false,
            message: String(error instanceof Error ? error.message : error),
          };
        }
      }
      const local = request.local;
      if (
        !local ||
        !/^[a-f0-9]{64}$/.test(local.fingerprint) ||
        !Number.isInteger(local.offset) ||
        local.offset < 0 ||
        typeof local.completed !== "boolean" ||
        (local.remote !== null && !validRemote(local.remote)) ||
        (local.baseline !== null && !validRemote(local.baseline))
      )
        throw new Error(t("dictionary.progressInvalid"));
      // Persist before contacting the server; a failed request must never discard the resume point.
      const saved: LocalProgress = { ...local, pending: true };
      await chrome.storage.local.set({ [key]: saved });
      try {
        if (!karakeepApiKey) throw new Error(t("dictionary.syncKey"));
        if (!local.remote) throw new Error(t("dictionary.progressLocal"));
        if (
          !previous?.pending &&
          sameRemoteProgress(local.baseline, local.remote) &&
          sameRemoteProgress(previous?.remote ?? null, local.remote)
        ) {
          saved.pending = false;
        } else {
          await requestReadingProgress(karakeepUrl, karakeepApiKey, request.bookmarkId, local.remote);
          saved.pending = false;
        }
        saved.baseline = local.remote;
        await chrome.storage.local.set({ [key]: saved });
        return { ok: true, synced: true };
      } catch (error) {
        return { ok: true, synced: false, message: error instanceof Error ? error.message : String(error) };
      }
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
