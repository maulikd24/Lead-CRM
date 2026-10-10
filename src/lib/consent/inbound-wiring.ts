import { prisma } from "@/lib/db/prisma";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { consentEnforced } from "./enforce";
import { applyInboundOptOut, type InboundResult } from "./inbound";
import { prismaConsentStore } from "./store-prisma";

/** Production wiring for the WhatsApp inbound path. Records a withdrawal and creates an RM task; never sends anything. */
export function applyInboundOptOutWired(input: { clientId: string; text: string; messageRef: string }): Promise<InboundResult> {
  return applyInboundOptOut(input, {
    enforced: () => consentEnforced(),
    store: prismaConsentStore,
    loadClient: async (clientId) => {
      const c = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true, marketingConsentAt: true } });
      return c && { assignedToId: c.assignedToId, legacyMarketingConsentAt: c.marketingConsentAt };
    },
    createTask: async (t) => { await createTaskIfNotExists(t); },
    now: () => new Date(),
  });
}
