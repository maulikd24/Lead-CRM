import type { IntegrationAdapter } from "@/lib/integrations/types";
import { mapExternalStatus } from "@/lib/integrations/task-sync";

export const jiraMockAdapter: IntegrationAdapter = {
  provider: "jira",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Jira connection OK (no real account required)" };
  },

  async handleWebhook(payload) {
    const body = payload as { issueKey?: string; status?: string; clientCode?: string; summary?: string };
    if (!body.issueKey || !body.status) return [];
    return [
      {
        type: "jira_status_changed",
        externalTaskId: body.issueKey,
        clientCode: body.clientCode,
        payload: { status: mapExternalStatus(body.status), rawStatus: body.status, title: body.summary },
      },
    ];
  },

  actions: {},
};
