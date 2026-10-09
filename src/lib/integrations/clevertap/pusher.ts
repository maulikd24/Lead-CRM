import { buildProfileUpload, signalsHash, type CleverTapUpload, type CustomerSignals } from "./signals";
import { isIndiaRegion } from "./region";

export type PusherDeps = {
  region: string | undefined;
  mode: "mock" | "dry_run" | "live";
  load: (clientId: string) => Promise<{ identity: string | null; signals: CustomerSignals } | null>;
  lastHash: (clientId: string) => Promise<string | null>;
  send: (payload: CleverTapUpload) => Promise<{ ok: boolean; status: number }>;
  record: (clientId: string, hash: string) => Promise<void>;
  recordError: (clientId: string, message: string) => Promise<void>;
};

export type PushResult = { status: "pushed" | "unchanged" | "skipped" | "retry" | "failed"; reason?: string };

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

async function safeRecordError(deps: PusherDeps, clientId: string, message: string) {
  try {
    await deps.recordError(clientId, message);
  } catch (error) {
    console.error("CleverTap ledger: could not record the push error", error);
  }
}

/** Never throws: every dependency failure becomes a PushResult so one bad customer cannot stop a batch. */
export async function pushCustomerSignals(clientId: string, deps: PusherDeps): Promise<PushResult> {
  if (deps.mode !== "live") return { status: "skipped", reason: `mode is ${deps.mode}; nothing is sent` };
  if (!isIndiaRegion(deps.region)) return { status: "skipped", reason: "CleverTap writes are allowed only in the India region" };

  let loaded: Awaited<ReturnType<PusherDeps["load"]>>;
  let hash: string;
  try {
    loaded = await deps.load(clientId);
    if (!loaded) return { status: "skipped", reason: "customer not found" };
    if (!loaded.identity) return { status: "skipped", reason: "customer has no email or phone to use as CleverTap identity" };
    hash = signalsHash(loaded.signals);
    if ((await deps.lastHash(clientId)) === hash) return { status: "unchanged" };
  } catch (error) {
    return { status: "failed", reason: messageOf(error, "could not prepare the push") };
  }

  let res: { ok: boolean; status: number };
  try {
    res = await deps.send(buildProfileUpload(loaded.identity, loaded.signals));
  } catch (error) {
    const message = messageOf(error, "network error");
    await safeRecordError(deps, clientId, message);
    return { status: "failed", reason: message };
  }
  if (res.status === 429) return { status: "retry", reason: "CleverTap concurrent request limit; will retry next run" };
  if (!res.ok) {
    const message = `CleverTap responded ${res.status}`;
    await safeRecordError(deps, clientId, message);
    return { status: "failed", reason: message };
  }
  try {
    await deps.record(clientId, hash);
  } catch (error) {
    // The data DID reach CleverTap; the next run re-sends an idempotent profile update, which is harmless.
    console.error("CleverTap ledger write failed after a successful push", error);
  }
  return { status: "pushed" };
}
