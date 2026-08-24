import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { getMessagingAdapter, messagingProviderKeyFor } from "@/lib/messaging/registry";

function substitute(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

/** Unified send used by both the manual "send message" UI action and journey send_message action nodes. */
export async function sendMessage(params: {
  leadId: string;
  channel: "whatsapp" | "sms";
  templateId?: string | null;
  variables?: Record<string, string>;
}) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: params.leadId } });
  if (!lead.phone) throw new Error("Lead has no phone number");

  const variables = params.variables ?? {};
  const template = params.templateId
    ? await prisma.messageTemplate.findUnique({ where: { id: params.templateId } })
    : null;

  if (params.templateId && template?.approved === false) {
    throw new Error("Cannot send an unapproved template");
  }

  const body = template ? substitute(template.body, variables) : (variables.body ?? "");
  const provider = messagingProviderKeyFor(params.channel);

  const message = await prisma.message.create({
    data: {
      leadId: lead.id,
      channel: params.channel,
      provider,
      direction: "OUTBOUND",
      templateId: template?.id,
      body,
      status: "QUEUED",
    },
  });

  try {
    const adapter = await getMessagingAdapter(params.channel);
    const result = await adapter.sendMessage({
      to: lead.phone,
      body,
      templateExternalId: template?.externalId,
      variables,
    });

    await prisma.message.update({
      where: { id: message.id },
      data: { status: result.status, externalId: result.externalId },
    });

    await logActivity({
      leadId: lead.id,
      type: "MESSAGE",
      payload: { direction: "OUTBOUND", channel: params.channel, body, status: result.status },
    });

    return { ...message, status: result.status, externalId: result.externalId };
  } catch (error) {
    await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED" } });
    throw error;
  }
}
