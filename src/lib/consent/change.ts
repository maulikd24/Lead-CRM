import { ConsentInputError, recordConsent, type ConsentStore, type StoredConsent } from "./ledger";

export type Actor = { id: string; role: string };
export type ChangeResult = { ok: true } | { ok: false; error: string };

/** What the browser may send. The actor, the source and the time are never taken from it. */
export type ChangeInput = {
  clientId: string;
  purpose: string;
  /** "" means every channel. */
  channel: string;
  status: string;
  reason: string;
  noticeVersion?: string;
};

export type ChangeDeps = {
  flagOn: () => boolean;
  user: Actor | null;
  loadClient: (clientId: string) => Promise<{ id: string; assignedToId: string | null } | null>;
  /** The ids the actor may see (themselves and their reports), or null for everyone. */
  visibleUserIds: (user: Actor) => Promise<string[] | null>;
  store: ConsentStore;
  now: () => Date;
  afterWrite?: (row: StoredConsent, client: { id: string }) => Promise<void>;
};

/** Admins: any customer. Managers: their hierarchy and unassigned leads. RMs: only their own customers. Nobody else. */
export function canChangeConsent(user: Actor, client: { assignedToId: string | null }, visibleUserIds: string[] | null): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "MANAGER") return !client.assignedToId || visibleUserIds === null || visibleUserIds.includes(client.assignedToId);
  if (user.role === "RM") return client.assignedToId === user.id;
  return false;
}

/** Records or withdraws consent on behalf of a signed-in person. Never throws for expected failures. */
export async function changeConsent(deps: ChangeDeps, input: ChangeInput): Promise<ChangeResult> {
  if (!deps.flagOn()) return { ok: false, error: "Not available" };
  const user = deps.user;
  if (!user) return { ok: false, error: "Not authorized" };

  // Same answer for "no such customer" and "not yours": no existence leak.
  const client = await deps.loadClient(String(input.clientId));
  if (!client || !canChangeConsent(user, client, await deps.visibleUserIds(user))) return { ok: false, error: "Not authorized" };

  try {
    const row = await recordConsent(deps.store, {
      clientId: client.id,
      purpose: String(input.purpose),
      channel: input.channel ? String(input.channel) : null,
      status: String(input.status),
      source: "RM_RECORDED",
      noticeVersion: input.noticeVersion ? String(input.noticeVersion) : null,
      capturedById: user.id,
      reason: String(input.reason ?? ""),
    }, deps.now());
    await deps.afterWrite?.(row, client);
    return { ok: true };
  } catch (error) {
    if (error instanceof ConsentInputError) return { ok: false, error: error.message };
    throw error;
  }
}
