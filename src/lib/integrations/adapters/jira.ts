import type { IntegrationAdapter } from "@/lib/integrations/types";
import { mapExternalStatus } from "@/lib/integrations/task-sync";
import { verifyHmacSha256 } from "@/lib/security/webhook-auth";

interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  webhookSecret?: string; // the secret set on the Jira admin webhook
}

let creds: JiraCredentials | null = null;

function authHeader(): string {
  if (!creds) throw new Error("Jira adapter not configured");
  return "Basic " + Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
}

const CLIENT_LABEL_RE = /^client:(.+)$/;

export const jiraAdapter: IntegrationAdapter = {
  provider: "jira",

  async configure(credentials) {
    creds = {
      baseUrl: String(credentials.baseUrl ?? ""),
      email: String(credentials.email ?? ""),
      apiToken: String(credentials.apiToken ?? ""),
      projectKey: String(credentials.projectKey ?? ""),
      webhookSecret: credentials.webhookSecret ? String(credentials.webhookSecret) : undefined,
    };
  },

  async testConnection() {
    if (!creds) return { ok: false, message: "Jira adapter not configured" };
    try {
      const res = await fetch(`${creds.baseUrl}/rest/api/3/myself`, {
        headers: { Authorization: authHeader() },
      });
      if (!res.ok) return { ok: false, message: `Jira responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  // Jira admin webhooks with a secret send X-Hub-Signature: sha256=<hex HMAC of the raw body>.
  verifySignature(headers, rawBody) {
    return verifyHmacSha256(creds?.webhookSecret, rawBody, headers["x-hub-signature"]);
  },

  async handleWebhook(payload) {
    const body = payload as {
      issue?: { key?: string; fields?: { status?: { name?: string }; summary?: string; labels?: string[] } };
    };
    const issue = body.issue;
    if (!issue?.key || !issue.fields?.status?.name) return [];

    const clientLabel = issue.fields.labels?.map((l) => CLIENT_LABEL_RE.exec(l)).find(Boolean);
    const rawStatus = issue.fields.status.name;

    return [
      {
        type: "jira_status_changed",
        externalTaskId: issue.key,
        clientCode: clientLabel?.[1],
        payload: { status: mapExternalStatus(rawStatus), rawStatus, title: issue.fields.summary },
      },
    ];
  },

  // Inbound only — Jira tickets are created directly in Jira, not from Supportify.
  actions: {},
};
