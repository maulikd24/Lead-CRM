import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ingestLead, type IngestOutcome, type LeadInput } from "@/lib/leads/ingest";
import { metaConsentGiven } from "@/lib/leads/meta-consent";
import { SOURCE_LABEL, mapFormFields } from "@/lib/leads/sources";

const GRAPH_BASE = () => process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";
export const META_SOURCE = "meta_leads";

export type LeadgenChange = { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number };

type GraphLead = {
  id: string;
  created_time?: string;
  field_data?: { name: string; values?: string[] }[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
};

/** Facebook vs Instagram: Meta reports where the lead form was filled; anything that isn't clearly Instagram stays Meta Ads. */
export function metaLeadSource(platform: string | undefined): string {
  const p = (platform ?? "").toLowerCase();
  return p === "ig" || p.includes("insta") ? SOURCE_LABEL.instagram : SOURCE_LABEL.meta;
}

export async function fetchGraphLead(leadgenId: string, pageToken: string): Promise<GraphLead> {
  const fields = "created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic";
  // The page token goes in the Authorization header, not the query string, so it cannot leak into URLs in logs.
  const url = `${GRAPH_BASE()}/${encodeURIComponent(leadgenId)}?fields=${fields}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${pageToken}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Graph API responded ${res.status}`);
  return (await res.json()) as GraphLead;
}

/** The form's answers, first value per field name. */
export function formFields(lead: GraphLead): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of lead.field_data ?? []) if (item.name && item.values?.[0]) fields[item.name] = item.values[0];
  return fields;
}

export const NO_CONSENT_REASON = "No consent: the form's consent checkbox was not answered yes";

export function leadFromGraph(lead: GraphLead, change: Partial<LeadgenChange>): LeadInput {
  const fields = formFields(lead);
  const mapped = mapFormFields(fields);
  return {
    source: META_SOURCE,
    externalId: lead.id,
    leadSource: metaLeadSource(lead.platform),
    name: mapped.name,
    phone: mapped.phone,
    email: mapped.email,
    city: mapped.city,
    productInterest: mapped.productInterest,
    answers: mapped.answers,
    attribution: {
      platform: lead.platform,
      campaign: lead.campaign_name ?? lead.campaign_id,
      campaign_id: lead.campaign_id,
      adset: lead.adset_name ?? lead.adset_id,
      ad: lead.ad_name ?? lead.ad_id ?? change.ad_id,
      form: lead.form_id ?? change.form_id,
      page_id: change.page_id,
    },
  };
}

/**
 * The consent gate, then the lead. Without a consent answer of yes nothing is created: the drop is recorded in the ledger with no
 * personal data (a reason code only), so drops can be counted later. With consent, the lead goes through the same ingest path as
 * every other lead, which owns the duplicate check (the ledger key and the client match).
 */
export async function ingestFetchedLead(change: LeadgenChange, lead: GraphLead, now = new Date()): Promise<IngestOutcome> {
  if (!metaConsentGiven(formFields(lead))) {
    await recordConsentDrop(change.leadgen_id, now);
    return { status: "rejected", reason: NO_CONSENT_REASON };
  }
  return ingestLead({ ...leadFromGraph(lead, change), consent: { at: now.toISOString() } }, { leadgen: change, graph: lead });
}

/** Writes the drop as a ledger row with no name, phone or email. A row that already holds a created or duplicate lead is never changed. */
async function recordConsentDrop(leadgenId: string, now: Date): Promise<void> {
  const existing = await prisma.leadIntake.findUnique({ where: { source_externalId: { source: META_SOURCE, externalId: leadgenId } }, select: { status: true } });
  if (existing && existing.status !== "ERROR") return;
  const data = { status: "REJECTED" as const, error: NO_CONSENT_REASON, processedAt: now, rawPayload: { reason: "no_consent" } as unknown as Prisma.InputJsonValue };
  await prisma.leadIntake.upsert({
    where: { source_externalId: { source: META_SOURCE, externalId: leadgenId } },
    update: data,
    create: { source: META_SOURCE, externalId: leadgenId, ...data },
  });
}

/** Meta only tells us a lead exists; we fetch its answers. If the fetch fails, park an ERROR row so the retry sweep gets it. */
export async function handleLeadgenChange(change: LeadgenChange, pageToken: string | undefined): Promise<IngestOutcome> {
  if (!pageToken) return parkLead(change, "No Meta page access token is configured");
  try {
    const lead = await fetchGraphLead(change.leadgen_id, pageToken);
    return await ingestFetchedLead(change, lead);
  } catch (error) {
    return parkLead(change, error instanceof Error ? error.message : "Fetch failed");
  }
}

async function parkLead(change: LeadgenChange, error: string): Promise<IngestOutcome> {
  try {
    await prisma.leadIntake.create({
      data: { source: META_SOURCE, externalId: change.leadgen_id, status: "ERROR", error: error.slice(0, 500), rawPayload: { pendingFetch: change } as unknown as Prisma.InputJsonValue },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    await prisma.leadIntake.update({ where: { source_externalId: { source: META_SOURCE, externalId: change.leadgen_id } }, data: { error: error.slice(0, 500), attempts: { increment: 1 } } });
  }
  return { status: "error", error };
}

/** Re-fetches a parked Meta lead (called by the retry sweep). */
export async function retryParkedMetaLead(change: LeadgenChange, pageToken: string | undefined): Promise<IngestOutcome> {
  if (!pageToken) return { status: "error", error: "No Meta page access token is configured" };
  try {
    const lead = await fetchGraphLead(change.leadgen_id, pageToken);
    return await ingestFetchedLead(change, lead);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    // attempts is counted once per sweep by retryFailedLeads(), not here.
    await prisma.leadIntake.update({ where: { source_externalId: { source: META_SOURCE, externalId: change.leadgen_id } }, data: { error: message.slice(0, 500) } });
    return { status: "error", error: message };
  }
}
