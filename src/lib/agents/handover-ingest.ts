import { needsHandover } from "./guardrails";

export type IngestHandoverDeps = {
  /** Both flags (env + AgentSetting row). */
  enabled: () => Promise<boolean>;
  record: (input: { clientId: string; triggerMessageId: string; reason: string }) => Promise<unknown>;
};

/**
 * Model-free check run when a customer message is ingested: pure regex, no network, never throws (ingest must not fail or
 * slow down because of it). Returns true only when a handover was recorded.
 */
export async function flagHandoverAtIngest(deps: IngestHandoverDeps, input: { clientId: string; messageId: string; text: string }): Promise<boolean> {
  try {
    if (!(await deps.enabled())) return false;
    const h = needsHandover(input.text);
    if (!h.handover) return false;
    await deps.record({ clientId: input.clientId, triggerMessageId: input.messageId, reason: h.reason ?? "customer needs a person" });
    return true;
  } catch (error) {
    console.error("wa_reply: ingest handover check failed", error instanceof Error ? error.name : "error");
    return false;
  }
}
