import { consentDecision } from "./decision";
import { matchStopKeyword } from "./keywords";
import { recordConsent, type ConsentStore } from "./ledger";

export type InboundDeps = {
  enforced: () => boolean;
  store: ConsentStore;
  loadClient: (clientId: string) => Promise<{ assignedToId: string | null; legacyMarketingConsentAt: Date | null } | null>;
  /** Creates a follow-up for the owning RM. There is deliberately no way to send anything from here. */
  createTask: (t: { clientId: string; assignedToId: string; title: string; dueAt: Date; source: string }) => Promise<void>;
  now: () => Date;
};

export type InboundResult = { applied: false; reason: string } | { applied: true; taskCreated: boolean };

const TASK_DUE_MS = 4 * 60 * 60 * 1000;

/**
 * Called for an inbound WhatsApp text. When it is an opt-out keyword (keywords.ts) and enforcement is on, it appends a
 * WITHDRAWN row for marketing messages on WhatsApp and asks the owning RM to review. It never replies. Service messages
 * are not affected; the RM decides whether the customer also needs a do-not-contact flag.
 */
export async function applyInboundOptOut(input: { clientId: string; text: string; messageRef: string }, deps: InboundDeps): Promise<InboundResult> {
  if (!deps.enforced()) return { applied: false, reason: "flag off" };
  if (!matchStopKeyword(input.text)) return { applied: false, reason: "no keyword" };
  const client = await deps.loadClient(input.clientId);
  if (!client) return { applied: false, reason: "customer not found" };

  const now = deps.now();
  const existing = await deps.store.listForClient(input.clientId);
  const current = consentDecision(existing, "MARKETING_COMMS", "whatsapp", now, { legacyMarketingConsentAt: client.legacyMarketingConsentAt });
  if (current.state === "WITHDRAWN" || current.state === "DO_NOT_CONTACT") return { applied: false, reason: "already withdrawn" };

  await recordConsent(deps.store, {
    clientId: input.clientId,
    purpose: "MARKETING_COMMS",
    channel: "whatsapp",
    status: "WITHDRAWN",
    source: "WHATSAPP_KEYWORD",
    evidenceRef: `message:${input.messageRef}`,
    reason: "Customer sent an opt-out keyword on WhatsApp",
    capturedAt: now,
  }, now);

  if (!client.assignedToId) return { applied: true, taskCreated: false };
  await deps.createTask({
    clientId: input.clientId,
    assignedToId: client.assignedToId,
    title: "Customer asked us to stop messaging on WhatsApp. Check the thread and confirm whether to set do-not-contact.",
    dueAt: new Date(now.getTime() + TASK_DUE_MS),
    source: "consent:optout",
  });
  return { applied: true, taskCreated: true };
}
