"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireMarketing } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { marketingPageEnabled } from "@/lib/marketing/flags";
import { estimateAudience, type AudienceEstimate } from "@/lib/marketing/broadcast/audience";
import { FIRST_NAME_TOKEN, audienceSchema, draftSchema } from "@/lib/marketing/broadcast/schema";
import { stepIssues } from "@/lib/marketing/broadcast/steps";
import { substitute, variablesOf } from "@/lib/messaging/template-vars";
import { BROADCAST_ENTITY } from "@/lib/policy/approvals/definitions/broadcast-draft";
import { requestApproval } from "@/lib/policy/approvals/service";
import "@/lib/policy/approvals/registry-init";

/**
 * Campaign Studio. Every action: ADMIN or MARKETING with manage on the marketing workspace, and the workspace is switched on. Nothing
 * here sends a message: submitting creates a BROADCAST_DRAFT approval request, and approving it records the decision only.
 */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const OFF = { ok: false as const, error: "The marketing workspace is switched off on this server." };

async function gate() {
  const session = await requireMarketing("marketing", "manage");
  if (!marketingPageEnabled()) return null;
  return { id: session.user.id, role: session.user.role };
}

export async function estimateAudienceAction(audience: unknown, channel: unknown): Promise<ActionResult<AudienceEstimate>> {
  if (!(await gate())) return OFF;
  const a = audienceSchema.safeParse(audience);
  if (!a.success || (channel !== "whatsapp" && channel !== "sms")) return { ok: false, error: "That audience is not valid." };
  try {
    return { ok: true, ...(await estimateAudience(a.data, channel)) };
  } catch {
    return { ok: false, error: "Couldn't count this audience right now." };
  }
}

export async function submitBroadcastDraftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await gate();
  if (!actor) return OFF;
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The broadcast is incomplete." };
  const d = parsed.data;

  const template = await prisma.messageTemplate.findFirst({ where: { id: d.templateId, channel: d.channel, approved: true }, select: { id: true, name: true, body: true } });
  if (!template) return { ok: false, error: "That template is not approved for this channel any more. Pick another." };
  const keys = variablesOf(template.body);
  const estimate = await estimateAudience(d.audience, d.channel);
  // The same rules the wizard shows, checked again here on the server against fresh numbers.
  const ctx = { consented: estimate.consented, templateVariables: keys, now: new Date() };
  const issue = ([1, 2, 3, 4] as const).flatMap((s) => stepIssues(s, d, ctx))[0];
  if (issue) return { ok: false, error: issue };

  const variables = Object.fromEntries(keys.map((k) => [k, d.variables[k]]));
  const preview = substitute(template.body, Object.fromEntries(keys.map((k) => [k, variables[k] === FIRST_NAME_TOKEN ? "Priya" : variables[k]])));
  const id = randomUUID();
  await requestApproval(
    "BROADCAST_DRAFT",
    {
      entity: BROADCAST_ENTITY,
      entityId: id,
      payload: {
        name: d.name, audience: d.audience, channel: d.channel, templateId: template.id, templateName: template.name, variables, preview,
        scheduledFor: d.scheduledFor ? new Date(d.scheduledFor).toISOString() : null,
        estimatedRecipients: estimate.matched, consentedRecipients: estimate.consented, approximate: estimate.approximate,
      },
      reason: d.note || `Broadcast: ${d.name}`,
      correlationId: `broadcast:${id}`,
    },
    actor,
  );
  revalidatePath("/marketing/studio");
  revalidatePath("/approvals");
  return { ok: true, id };
}
