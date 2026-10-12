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

// Stored Jira credentials (Basic auth) must only ever be sent to Atlassian Cloud.
// An operator can name one other exact host with JIRA_ALLOW_BASE_HOST (for example a
// self-hosted gateway); no other override exists.
const ATLASSIAN_CLOUD_HOST_RE = /^([a-z0-9-]+\.)+atlassian\.net$/;

export function assertJiraBaseUrl(raw: string, env: Record<string, string | undefined> = process.env): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Jira baseUrl is not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("Jira baseUrl must use https");
  if (url.username || url.password) throw new Error("Jira baseUrl must not contain credentials");
  if (url.port !== "") throw new Error("Jira baseUrl must not set a port");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Jira baseUrl must be a bare host");

  const host = url.hostname.toLowerCase();
  const allowed = env.JIRA_ALLOW_BASE_HOST?.trim().toLowerCase();
  if (allowed && host === allowed) return url.origin;
  if (ATLASSIAN_CLOUD_HOST_RE.test(host)) return url.origin;
  throw new Error("Jira baseUrl host is not an Atlassian Cloud host");
}

export const jiraAdapter: IntegrationAdapter = {
  provider: "jira",

  async configure(credentials) {
    creds = {
      baseUrl: assertJiraBaseUrl(String(credentials.baseUrl ?? "")),
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
