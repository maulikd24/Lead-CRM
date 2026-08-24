import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { getAdapter } from "@/lib/integrations/registry";
import { sendMessage } from "@/lib/messaging/send";
import { putOnHold, markNotProceeding } from "@/lib/stage-engine/transitions";
import type { Client } from "@/generated/prisma/client";
import type { ActionNodeData } from "@/lib/journeys/types";

export async function executeAction(
  data: ActionNodeData,
  client: Client,
  journeyRunId: string,
): Promise<{ success: boolean; result?: unknown }> {
  const config = data.config;

  switch (data.actionType) {
    case "create_task": {
      const title = String(config.title ?? "Follow up");
      const dueInMinutes = typeof config.dueInMinutes === "number" ? config.dueInMinutes : 60 * 24;
      const assignedToId = typeof config.assignedToId === "string" ? config.assignedToId : client.assignedToId;
      if (!assignedToId) {
        return { success: false, result: { error: "No assignee available for task" } };
      }
      const task = await prisma.task.create({
        data: {
          clientId: client.id,
          assignedToId,
          title,
          dueAt: new Date(Date.now() + dueInMinutes * 60 * 1000),
          source: `journey:${journeyRunId}`,
        },
      });
      await logActivity({
        clientId: client.id,
        type: "JOURNEY_EVENT",
        payload: { message: `Journey created task: ${title}`, taskId: task.id },
      });
      return { success: true, result: { taskId: task.id } };
    }

    case "update_client_status": {
      const targetStatus = config.status as "ON_HOLD" | "NOT_PROCEEDING" | "ACTIVE" | undefined;
      const reason = typeof config.reason === "string" ? config.reason : "Automated by journey";
      if (!targetStatus) return { success: false, result: { error: "Missing status in config" } };

      if (targetStatus === "ON_HOLD") {
        await putOnHold(client.id, { reason }, client.assignedToId ?? client.id);
      } else if (targetStatus === "NOT_PROCEEDING") {
        await markNotProceeding(client.id, { reason }, client.assignedToId ?? client.id);
      } else {
        return { success: false, result: { error: "Journeys may only set ON_HOLD or NOT_PROCEEDING (not stage/COMPLETED)" } };
      }
      return { success: true };
    }

    case "reassign_client": {
      const assignedToId = config.assignedToId as string | undefined;
      if (!assignedToId) return { success: false, result: { error: "Missing assignedToId in config" } };
      await prisma.client.update({ where: { id: client.id }, data: { assignedToId } });
      await logActivity({
        clientId: client.id,
        type: "NOTE",
        payload: { message: `Journey reassigned client to user ${assignedToId}` },
      });
      return { success: true };
    }

    case "add_note": {
      const note = String(config.note ?? "");
      await logActivity({ clientId: client.id, type: "NOTE", payload: { message: note } });
      return { success: true };
    }

    case "notify_manager": {
      const owner = client.assignedToId
        ? await prisma.user.findUnique({ where: { id: client.assignedToId } })
        : null;
      if (!owner?.managerId) {
        return { success: false, result: { error: "No manager found for client owner" } };
      }
      await prisma.notification.create({
        data: {
          userId: owner.managerId,
          type: "journey_notify_manager",
          payload: {
            clientId: client.id,
            clientName: client.name,
            message: config.message ?? `Journey flagged client ${client.name} for review`,
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
          clientId: client.id,
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

      const result = await handler(client, actionParams);
      await logActivity({
        clientId: client.id,
        type: "JOURNEY_EVENT",
        payload: { message: `Journey called ${provider}.${actionName}`, result: result.data ?? result.error },
      });
      return { success: result.success, result: result.data ?? { error: result.error } };
    }

    default:
      return { success: false, result: { error: `Unknown action type` } };
  }
}
