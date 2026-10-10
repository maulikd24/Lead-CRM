import { prisma } from "@/lib/db/prisma";
import type { LeadInput } from "@/lib/leads/ingest";

import { loadAttributionContext, pushDeps } from "./db";
import { pushNewLead } from "./lead-push";
import { attribute } from "./model";

/** Called by lead intake for a NEW lead when the attribution flag is on. Finds the lead's first touch with the same model the Journey uses, then pushes. */
export async function pushLeadToRm(args: { client: { id: string; name: string; assignedToId: string | null }; input: LeadInput; attribution: Record<string, unknown>; intakeKey: string }): Promise<void> {
  const now = new Date();
  const ctx = await loadAttributionContext(now);
  const result = attribute({ clientId: args.client.id, createdAt: now, leadSource: args.input.leadSource, leadAttribution: args.attribution, intakes: [], partner: null, referral: null, fundedAt: null }, ctx);
  const rm = args.client.assignedToId ? await prisma.user.findUnique({ where: { id: args.client.assignedToId }, select: { name: true } }) : null;
  const firstName = (args.client.name || "there").trim().split(/\s+/)[0] || "there";
  await pushNewLead(
    {
      clientId: args.client.id,
      clientName: args.client.name,
      firstName,
      assignedToId: args.client.assignedToId,
      rmFirstName: rm?.name?.trim().split(/\s+/)[0] ?? null,
      intakeKey: args.intakeKey,
      touch: result.status === "attributed" ? result.first : null,
      answers: args.input.answers ?? {},
      productInterest: args.input.productInterest ?? null,
    },
    pushDeps(),
  );
}
