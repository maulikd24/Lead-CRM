import { prisma } from "@/lib/db/prisma";

/**
 * One Google Chat message per new lead. Off unless LEAD_ALERTS_GCHAT_ENABLED is exactly "1" (flag registry: outbound).
 * The payload carries only a lead reference, the source and campaign label, the current stage, the assigned RM's first
 * name (or "unassigned") and a deep link. A lead's name, phone, email, PAN, address and free-text message never enter it.
 * Best effort: nothing here throws, retries or waits in a way that can fail or delay lead creation. Errors are logged as
 * the error class and HTTP status only, never the webhook URL or the payload.
 */

export const LEAD_ALERTS_GCHAT_FLAG = "LEAD_ALERTS_GCHAT_ENABLED";
const WEBHOOK_ENV = "GCHAT_LEAD_WEBHOOK_URL";
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2;

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function leadAlertsGchatEnabled(env: Env = process.env): boolean {
  return env[LEAD_ALERTS_GCHAT_FLAG] === "1";
}

/** The only inputs an alert takes. Deliberately no name, phone, email, PAN, address or message field. */
export type NewLeadFacts = {
  clientId: string;
  assignedToId: string | null;
  currentStageId: string;
  leadSource: string;
  campaign?: string;
};

/** A campaign label is shown only when it cannot be a person's details: no email, no long digit run, no PAN-shaped id. */
export function safeCampaignLabel(raw: string | null | undefined): string | undefined {
  const text = raw?.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text || text.includes("@") || /\d{6,}/.test(text) || /[A-Z]{5}\d{4}[A-Z]/i.test(text)) return undefined;
  return text;
}

/** Deep link to the lead in the platform, from CRM_BASE_URL. Null when the base address is missing or not http(s). */
export function leadDeepLink(clientId: string, base: string | undefined): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return `${base.replace(/\/+$/, "")}/clients/${encodeURIComponent(clientId)}`;
}

export type ChatPayload = { text: string };

/** Builds the privacy-safe message. Only the fields passed in reach the payload; the output has a single `text` key. */
export function buildLeadAlertPayload(f: { clientId: string; source: string; campaign?: string; stage: string | null; rmFirstName: string | null; link: string }): ChatPayload {
  const head = [`New lead ${f.clientId}`, `source: ${f.source}`];
  if (f.campaign) head.push(`campaign: ${f.campaign}`);
  head.push(`stage: ${f.stage ?? "unknown"}`, `RM: ${f.rmFirstName ?? "unassigned"}`);
  return { text: `${head.join(" | ")}\n${f.link}` };
}

/** One POST with a 5 second timeout, retried at most once. Resolves to "sent" or "failed"; never throws. */
export async function postToChat(payload: ChatPayload, url: string, fetchImpl: FetchLike = fetch): Promise<"sent" | "failed"> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return "sent";
      console.error("Lead alert to Google Chat failed", { errorClass: "HttpStatus", status: res.status, attempt });
    } catch (error) {
      console.error("Lead alert to Google Chat failed", { errorClass: error instanceof Error ? error.name : "unknown", attempt });
    }
  }
  return "failed";
}

/**
 * Sends the alert for one NEW lead. Call only after the lead is committed. Returns "skipped" when the flag is off or the
 * config is incomplete (no network call), "sent" or "failed". Never throws.
 */
export async function alertNewLead(facts: NewLeadFacts, env: Env = process.env, fetchImpl?: FetchLike): Promise<"sent" | "failed" | "skipped"> {
  if (!leadAlertsGchatEnabled(env)) return "skipped";
  const url = env[WEBHOOK_ENV];
  if (!url) {
    console.error("Lead alert skipped: the Chat webhook is not configured");
    return "skipped";
  }
  const link = leadDeepLink(facts.clientId, env.CRM_BASE_URL);
  if (!link) {
    console.error("Lead alert skipped: CRM_BASE_URL is not a valid http(s) address");
    return "skipped";
  }
  try {
    const [rm, stage] = await Promise.all([
      facts.assignedToId ? prisma.user.findUnique({ where: { id: facts.assignedToId }, select: { name: true } }) : null,
      prisma.stage.findUnique({ where: { id: facts.currentStageId }, select: { name: true } }),
    ]);
    const payload = buildLeadAlertPayload({
      clientId: facts.clientId,
      source: facts.leadSource,
      campaign: safeCampaignLabel(facts.campaign),
      stage: stage?.name ?? null,
      rmFirstName: rm?.name?.trim().split(/\s+/)[0] ?? null,
      link,
    });
    return (await postToChat(payload, url, fetchImpl)) === "sent" ? "sent" : "failed";
  } catch (error) {
    console.error("Lead alert skipped: lookup failed", { errorClass: error instanceof Error ? error.name : "unknown" });
    return "failed";
  }
}
