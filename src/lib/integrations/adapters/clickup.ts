import type { IntegrationAdapter } from "@/lib/integrations/types";
import { mapExternalStatus } from "@/lib/integrations/task-sync";

interface ClickUpCredentials {
  apiToken: string;
  teamId: string;
  listId: string; // list tasks are created in
}

let creds: ClickUpCredentials | null = null;

function baseUrl(): string {
  return "https://api.clickup.com/api/v2";
}

function authHeader(): string {
  if (!creds) throw new Error("ClickUp adapter not configured");
  return creds.apiToken;
}

export const clickupAdapter: IntegrationAdapter = {
  provider: "clickup",

  async configure(credentials) {
    creds = {
      apiToken: String(credentials.apiToken ?? ""),
      teamId: String(credentials.teamId ?? ""),
      listId: String(credentials.listId ?? ""),
    };
  },

  async testConnection() {
    if (!creds) return { ok: false, message: "ClickUp adapter not configured" };
    try {
      const res = await fetch(`${baseUrl()}/list/${creds.listId}`, {
        headers: { Authorization: authHeader() },
      });
      if (!res.ok) return { ok: false, message: `ClickUp responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async handleWebhook(payload) {
    const body = payload as {
      event?: string;
      task_id?: string;
      history_items?: { field?: string; after?: { status?: string } }[];
    };

    const statusChange = body.history_items?.find((item) => item.field === "status");
    if (body.event !== "taskStatusUpdated" || !body.task_id || !statusChange?.after?.status) {
      return [];
    }

    const rawStatus = statusChange.after.status;
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
      if (!creds) return { success: false, error: "ClickUp adapter not configured" };
      try {
        const res = await fetch(`${baseUrl()}/list/${creds.listId}/task`, {
          method: "POST",
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: params.title ?? `Task for ${client.name}`,
            due_date: params.dueAt ? new Date(String(params.dueAt)).getTime() : undefined,
          }),
        });
        if (!res.ok) {
          return { success: false, error: `ClickUp responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data: { id: data.id, url: data.url, name: data.name, status: data.status?.status } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};
