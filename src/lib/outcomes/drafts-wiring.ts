import { agentEnabled } from "@/lib/agents/enabled";
import { consentGate } from "@/lib/consent/enforce";
import { prisma } from "@/lib/db/prisma";

import { OUTCOMES_AGENT_KEY, type DraftDeps } from "./drafts";

/** Production dependencies for outcome drafts: the same agent switch, consent gate and proposal table as the other draft-only agents. */
export function outcomesDraftDeps(): DraftDeps {
  // Undefined unless CONSENT_ENFORCEMENT=1: with enforcement off the draft is still only a draft a person must approve.
  const gate = consentGate("MARKETING_COMMS", "whatsapp");
  return {
    isEnabled: () => agentEnabled(OUTCOMES_AGENT_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })),
    consent: gate ?? (async () => ({ allowed: true })),
    hasOpenDraft: async (clientId) => (await prisma.agentProposal.count({ where: { clientId, agentKey: OUTCOMES_AGENT_KEY, OR: [{ status: "DRAFT", expiresAt: { gt: new Date() } }, { status: "APPROVED" }] } })) > 0,
    save: async (p) => ({ id: (await prisma.agentProposal.create({ data: p, select: { id: true } })).id }),
    now: () => new Date(),
  };
}
