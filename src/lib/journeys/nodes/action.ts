import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { getAdapter } from "@/lib/integrations/registry";
import { sendMessage } from "@/lib/messaging/send";
import type { Lead, LeadStatus } from "@/generated/prisma/client";
import type { ActionNodeData } from "@/lib/journeys/types";

export async function executeAction(
  data: ActionNodeData,
  lead: Lead,
  journeyRunId: string,
): Promise<{ success: boolean; result?: unknown }> {
  const config = data.config;

  switch (data.actionType) {
    case "create_task": {
      const title = String(config.title ?? "Follow up");
      const dueInMinutes = typeof config.dueInMinutes === "number" ? config.dueInMinutes : 60 * 24;
      const assignedToId = typeof config.assignedToId === "string" ? config.assignedToId : lead.assignedToId;
      if (!assignedToId) {
        return { success: false, result: { error: "No assignee available for task" } };
      }
      const task = await prisma.task.create({
        data: {
          leadId: lead.id,
          assignedToId,
          title,
          dueAt: new Date(Date.now() + dueInMinutes * 60 * 1000),
          source: `journey:${journeyRunId}`,
        },
      });
      await logActivity({
        leadId: lead.id,
        type: "JOURNEY_EVENT",
        payload: { message: `Journey created task: ${title}`, taskId: task.id },
      });
      return { success: true, result: { taskId: task.id } };
    }

    case "update_lead_status": {
      const status = config.status as LeadStatus | undefined;
      if (!status) return { success: false, result: { error: "Missing status in config" } };
      await prisma.lead.update({ where: { id: lead.id }, data: { status } });
      await logActivity({
        leadId: lead.id,
        type: "STATUS_CHANGE",
        payload: { status, message: `Journey updated status to ${status}` },
      });
      return { success: true };
    }

    case "reassign_lead": {
      const assignedToId = config.assignedToId as string | undefined;
      if (!assignedToId) return { success: false, result: { error: "Missing assignedToId in config" } };
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedToId } });
      await logActivity({
        leadId: lead.id,
        type: "NOTE",
        payload: { message: `Journey reassigned lead to user ${assignedToId}` },
      });
      return { success: true };
    }

    case "add_note": {
      const note = String(config.note ?? "");
      await logActivity({ leadId: lead.id, type: "NOTE", payload: { message: note } });
      return { success: true };
    }

    case "notify_manager": {
      const owner = lead.assignedToId
        ? await prisma.user.findUnique({ where: { id: lead.assignedToId } })
        : null;
      if (!owner?.managerId) {
        return { success: false, result: { error: "No manager found for lead owner" } };
      }
      await prisma.notification.create({
        data: {
          userId: owner.managerId,
          type: "journey_notify_manager",
          payload: {
            leadId: lead.id,
            leadName: lead.name,
            message: config.message ?? `Journey flagged lead ${lead.name} for review`,
          },
        },
      });
      return { success: true };
    }

    case "send_message": {
      const channel = config.channel === "sms" ? "sms" : "whatsapp";
      const templateId = typeof config.templateId === "string" ? config.templateId : undefined;
      try {
        const message = await sendMessage({
          leadId: lead.id,
          channel,
          templateId,
          variables: (config.variables as Record<string, string>) ?? {},
        });
        return { success: true, result: { messageId: message.id, status: message.status } };
      } catch (error) {
        return { success: false, result: { error: error instanceof Error ? error.message : "Send failed" } };
      }
    }

    case "call_integration_action": {
      const provider = String(config.provider ?? "");
      const actionName = String(config.action ?? "");
      const actionParams = (config.params as Record<string, unknown>) ?? {};

      const adapter = await getAdapter(provider);
      const handler = adapter.actions[actionName];
      if (!handler) {
        return { success: false, result: { error: `${provider} has no action "${actionName}"` } };
      }

      const result = await handler(lead, actionParams);
      await logActivity({
        leadId: lead.id,
        type: "JOURNEY_EVENT",
        payload: { message: `Journey called ${provider}.${actionName}`, result: result.data ?? result.error },
      });
      return { success: result.success, result: result.data ?? { error: result.error } };
    }

    default:
      return { success: false, result: { error: `Unknown action type` } };
  }
}
