import { Prisma } from "@/generated/prisma/client";
import type { LeadIntakeStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { resolveInboundClient } from "@/lib/clients/inbound-contact";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { normalizePhone } from "@/lib/utils/normalize-contact";
import { CUSTOMER_CATEGORIES } from "@/lib/intelligence/constants";

/**
 * One entry point for every paid/web lead (Meta, Instagram, Google, website and contact forms). Each submission is
 * written to the LeadIntake ledger first — (source, externalId) makes a provider retry or a double-click a no-op, and
 * a failure leaves an ERROR row that retryFailedLeads() picks up — then resolved into a client through the same
 * duplicate rules, routing and "New Lead" setup as a lead typed in by hand.
 */

export type LeadInput = {
  /** Ledger namespace, e.g. "meta_leads", "google_ads", "web". */
  source: string;
  /** The provider's own lead/submission id — the idempotency key within `source`. */
  externalId: string;
  /** Value written to Client.leadSource: "Meta Ads", "Instagram Ads", "Google Ads", "Contact Form", … */
  leadSource: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  productInterest?: string;
  /** Broking | Wealth | Mutual Funds | HNI | Existing Customer | Support | Other — blank lets the system infer it. */
  customerCategory?: string;
  /** Form answers that don't map to a CRM field — kept on the client's notes. */
  answers?: Record<string, string>;
  message?: string;
  /** campaign / adset / ad / form / platform / utm_* / gclid / fbclid / landing page … */
  attribution?: Record<string, string | undefined>;
  consent?: { at: string; text?: string };
};

export type IngestOutcome =
  | { status: "created"; clientId: string }
  | { status: "duplicate"; clientId: string }
  | { status: "replay"; clientId?: string; previous: LeadIntakeStatus }
  | { status: "rejected"; reason: string }
  | { status: "error"; error: string };

const MAX_TEXT = 500;
const URGENT_TASK_MINUTES = 15;

export function normalizeLeadPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let digits = normalizePhone(raw);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 15) return undefined;
  return digits;
}

function cleanEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

function cut(value: string | undefined, max = MAX_TEXT): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function buildNotes(input: LeadInput): string | undefined {
  const parts: string[] = [];
  if (input.message) parts.push(`Message: ${cut(input.message, 1000)}`);
  for (const [key, value] of Object.entries(input.answers ?? {}).slice(0, 15)) parts.push(`${cut(key, 60)}: ${cut(value, 300)}`);
  return parts.length ? `Enquiry via ${input.leadSource}\n${parts.join("\n")}` : undefined;
}

function cleanAttribution(attribution: LeadInput["attribution"], input: LeadInput): Prisma.InputJsonValue {
  const out: Record<string, string> = { source: input.source, externalId: input.externalId };
  for (const [key, value] of Object.entries(attribution ?? {})) {
    const text = cut(value, 300);
    if (text) out[key] = text;
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function finish(id: string, status: LeadIntakeStatus, extra: { clientId?: string; error?: string | null } = {}) {
  await prisma.leadIntake.update({
    where: { id },
    data: { status, clientId: extra.clientId, error: extra.error ?? null, processedAt: new Date() },
  });
}

/** Claims the ledger row, then processes it. Safe to call twice with the same (source, externalId). */
export async function ingestLead(input: LeadInput, rawPayload: unknown): Promise<IngestOutcome> {
  let ledgerId: string;
  try {
    const row = await prisma.leadIntake.create({
      data: {
        source: input.source,
        externalId: input.externalId,
        status: "ERROR",
        error: "processing",
        rawPayload: { raw: rawPayload ?? null, normalized: input } as unknown as Prisma.InputJsonValue,
      },
    });
    ledgerId = row.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.leadIntake.findUnique({ where: { source_externalId: { source: input.source, externalId: input.externalId } } });
    if (!existing) throw error;
    // A previous attempt failed part-way: let this retry take it over.
    if (existing.status === "ERROR") return processLead(existing.id, input);
    return { status: "replay", clientId: existing.clientId ?? undefined, previous: existing.status };
  }
  return processLead(ledgerId, input);
}

export async function processLead(ledgerId: string, input: LeadInput): Promise<IngestOutcome> {
  const phone = normalizeLeadPhone(input.phone);
  const email = cleanEmail(input.email);
  if (!phone && !email) {
    await finish(ledgerId, "REJECTED", { error: "No valid phone number or email in the submission" });
    return { status: "rejected", reason: "A valid phone number or email is required" };
  }

  try {
    const consentAt = input.consent?.at ? new Date(input.consent.at) : undefined;
    const attribution = cleanAttribution(input.attribution, input);
    const { client, isNew, returnedLead } = await resolveInboundClient({
      phone,
      email,
      name: cut(input.name, 120),
      leadSource: input.leadSource,
      extras: {
        // Paid leads go cold in minutes — they jump the queue.
        priority: "HIGH",
        notes: buildNotes(input),
        city: cut(input.city, 80),
        productInterest: cut(input.productInterest, 120),
        customerCategory: CUSTOMER_CATEGORIES.find((c) => c.toLowerCase() === input.customerCategory?.trim().toLowerCase()),
        leadAttribution: attribution,
        ...(consentAt && !Number.isNaN(consentAt.getTime()) ? { marketingConsentAt: consentAt, marketingConsentText: cut(input.consent?.text, 1000) } : {}),
      },
    });

    if (isNew) {
      if (client.assignedToId) {
        await createTaskIfNotExists({
          clientId: client.id,
          assignedToId: client.assignedToId,
          title: `Call new ${input.leadSource} lead within ${URGENT_TASK_MINUTES} minutes`,
          dueAt: new Date(Date.now() + URGENT_TASK_MINUTES * 60 * 1000),
          source: `lead-intake:${client.id}`,
        });
      }
      await logActivity({
        clientId: client.id,
        type: "NOTE",
        payload: { message: `New lead from ${input.leadSource}${attribution && (attribution as Record<string, string>).campaign ? ` — campaign ${(attribution as Record<string, string>).campaign}` : ""}`, source: input.source },
      });
      await finish(ledgerId, "CREATED", { clientId: client.id });
      return { status: "created", clientId: client.id };
    }

    // An existing client enquiring again: record the touch and tell their RM, don't create a second lead.
    await logActivity({
      clientId: client.id,
      type: "NOTE",
      payload: { message: `Enquired again via ${input.leadSource}`, source: input.source, attribution },
    });
    // A returning Not-proceeding lead already got the more specific lead_returned alert from resolveInboundClient.
    if (client.assignedToId && !returnedLead) {
      await prisma.notification.create({
        data: { userId: client.assignedToId, type: "lead_reenquiry", payload: { clientId: client.id, clientName: client.name, source: input.leadSource } },
      });
    }
    await finish(ledgerId, "DUPLICATE", { clientId: client.id });
    return { status: "duplicate", clientId: client.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead intake failed", input.source, input.externalId, message);
    await finish(ledgerId, "ERROR", { error: message.slice(0, 500) }).catch(() => {});
    return { status: "error", error: message };
  }
}
