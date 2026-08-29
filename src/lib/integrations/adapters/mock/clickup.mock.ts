import type { IntegrationAdapter } from "@/lib/integrations/types";
import { mapExternalStatus } from "@/lib/integrations/task-sync";

let mockTaskCounter = 5000;

export const clickupMockAdapter: IntegrationAdapter = {
  provider: "clickup",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock ClickUp connection OK (no real account required)" };
  },

  async handleWebhook(payload) {
    const body = payload as { task_id?: string; status?: string };
    if (!body.task_id) return [];
    const rawStatus = body.status ?? "open";
    return [
      {
        type: "clickup_status_changed",
        externalTaskId: body.task_id,
        payload: { status: mapExternalStatus(rawStatus), rawStatus },
      },
    ];
  },

  actions: {
    async createTask(client, params) {
      mockTaskCounter += 1;
      return {
        success: true,
        data: {
          id: String(mockTaskCounter),
          url: `https://app.clickup.com/t/mock-${mockTaskCounter}`,
          name: params.title ?? `Task for ${client.name}`,
          status: "open",
          mock: true,
        },
      };
    },
  },
};
