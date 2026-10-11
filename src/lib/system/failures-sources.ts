import { prisma } from "@/lib/db/prisma";
import { MAX_LEAD_ATTEMPTS } from "@/lib/leads/retry";

import { DESTINATION_LABEL, type DestinationKey } from "@/lib/closedloop/types";

import { failureGroupRows, latestPerJob } from "./control-plane-db";
import { closedLoopFailureItem, jobFailureItem, type FailureItem } from "./failures";

const DAY = 86_400_000;
const BAD = new Set(["FAILED", "TIMEOUT"]);

/**
 * Every failure source folded into FailureItem rows. Reads counts, times, classes and ids only: no lead payload, no message body, no
 * customer name, no error text from a table that holds free text (LeadIntake.error, CleverTapSync.lastError and WhatsAppAccount.lastError
 * are NOT selected; their presence is the signal).
 */
export async function loadFailureItems(now: Date): Promise<FailureItem[]> {
  const since7d = new Date(now.getTime() - 7 * DAY);
  const [jobGroups, latest, leads, leadSample, waFailed, clevertap, waAccounts, stuck, closedLoop] = await Promise.all([
    failureGroupRows(now),
    latestPerJob(now),
    prisma.leadIntake.groupBy({ by: ["source"], where: { status: "ERROR", receivedAt: { gte: since7d } }, _count: { _all: true }, _min: { receivedAt: true }, _max: { receivedAt: true, attempts: true } }),
    prisma.leadIntake.findMany({ where: { status: "ERROR", attempts: { lt: MAX_LEAD_ATTEMPTS }, receivedAt: { gte: since7d } }, orderBy: { receivedAt: "asc" }, take: 25, select: { id: true, source: true } }),
    prisma.message.aggregate({ where: { status: "FAILED", accountId: { not: null }, createdAt: { gte: since7d } }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.cleverTapSync.aggregate({ where: { lastError: { not: null } }, _count: { _all: true }, _min: { lastCheckedAt: true }, _max: { lastCheckedAt: true } }),
    prisma.whatsAppAccount.aggregate({ where: { lastError: { not: null }, isActive: true }, _count: { _all: true }, _min: { updatedAt: true }, _max: { updatedAt: true } }),
    prisma.agentProposal.aggregate({ where: { OR: [{ status: "APPROVED" }, { status: "DRAFT", expiresAt: { gt: now } }], createdAt: { lt: new Date(now.getTime() - DAY) } }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.conversionOutbox.groupBy({ by: ["destination", "status"], where: { status: { in: ["DEAD", "FAILED"] }, updatedAt: { gte: since7d } }, _count: { _all: true }, _min: { createdAt: true }, _max: { updatedAt: true, attempts: true } }),
  ]);

  const items: FailureItem[] = [];

  for (const g of jobGroups) {
    items.push(jobFailureItem({ job: g.job, errorClass: g.errorClass, count: g.n, firstSeen: g.firstSeen, lastSeen: g.lastSeen, latestId: g.latestId, latestAttempt: g.latestAttempt, stillFailing: BAD.has(latest.get(g.job)?.status ?? "") }));
  }

  const idsBySource = new Map<string, string[]>();
  for (const s of leadSample) (idsBySource.get(s.source) ?? idsBySource.set(s.source, []).get(s.source)!).push(s.id);
  for (const g of leads) {
    const attempts = g._max.attempts ?? 1;
    const ids = idsBySource.get(g.source) ?? [];
    const dead = ids.length === 0;
    items.push({
      id: `lead:${g.source}`, source: "lead-intake", group: g.source, label: `Lead intake: ${g.source}`, errorClass: "LeadIntakeError", reason: "A lead could not be recorded",
      firstSeen: g._min.receivedAt ?? now, lastSeen: g._max.receivedAt ?? now, count: g._count._all, attempts, stillFailing: true, dead,
      retry: ids.length ? { kind: "lead-intake", targetIds: ids } : null, dataRisk: "none",
      dataNote: dead ? "The lead is stored but needs a person: automatic retries are used up." : "The lead is stored and retried every tick; nothing is lost.",
      link: { href: "/settings/go-live", label: "Go-Live checklist" },
    });
  }

  if (waFailed._count._all > 0) {
    items.push({
      id: "wa-outbox", source: "whatsapp-outbox", group: "whatsapp-outbox", label: "WhatsApp messages that failed to send", errorClass: "SendFailed", reason: "The worker reported a failed send",
      firstSeen: waFailed._min.createdAt ?? now, lastSeen: waFailed._max.createdAt ?? now, count: waFailed._count._all, attempts: 1, stillFailing: true, dead: true, retry: null,
      dataRisk: "at-risk", dataNote: "These messages were not delivered and are not retried automatically. Open the conversation to resend.", link: { href: "/inbox", label: "Open Inbox" },
    });
  }
  if (clevertap._count._all > 0) {
    items.push({
      id: "clevertap", source: "clevertap", group: "clevertap", label: "CleverTap pushes with an error", errorClass: "PushError", reason: "The last push for these customers failed",
      firstSeen: clevertap._min.lastCheckedAt ?? now, lastSeen: clevertap._max.lastCheckedAt ?? now, count: clevertap._count._all, attempts: 1, stillFailing: true, dead: false, retry: null,
      dataRisk: "none", dataNote: "The customer records are unchanged; only the signal push failed and is attempted again.", link: { href: "/settings/integrations", label: "CleverTap settings" },
    });
  }
  if (waAccounts._count._all > 0) {
    items.push({
      id: "wa-accounts", source: "whatsapp-account", group: "whatsapp-account", label: "WhatsApp accounts reporting an error", errorClass: "AccountError", reason: "The worker reported an error for the account",
      firstSeen: waAccounts._min.updatedAt ?? now, lastSeen: waAccounts._max.updatedAt ?? now, count: waAccounts._count._all, attempts: 1, stillFailing: true, dead: false, retry: null,
      dataRisk: "unknown", dataNote: "Cannot be determined here: check the account and its queued messages.", link: { href: "/settings/whatsapp", label: "WhatsApp accounts" },
    });
  }
  if (stuck._count._all > 0) {
    items.push({
      id: "agent-proposals", source: "agent-proposal", group: "agent-proposals", label: "Agent drafts waiting over 24 hours", errorClass: "WaitingForPerson", reason: "A draft needs a person",
      firstSeen: stuck._min.createdAt ?? now, lastSeen: stuck._max.createdAt ?? now, count: stuck._count._all, attempts: 1, stillFailing: true, dead: false, retry: null,
      dataRisk: "none", dataNote: "Nothing is sent without a person. Approvals stay a human decision.", link: { href: "/agents", label: "Agent drafts" },
    });
  }
  const byDestination = new Map<string, { dead: number; retrying: number; first: Date; last: Date; attempts: number }>();
  for (const g of closedLoop) {
    const cur = byDestination.get(g.destination) ?? { dead: 0, retrying: 0, first: g._min.createdAt ?? now, last: g._max.updatedAt ?? now, attempts: 0 };
    if (g.status === "DEAD") cur.dead += g._count._all;
    else cur.retrying += g._count._all;
    if (g._min.createdAt && g._min.createdAt < cur.first) cur.first = g._min.createdAt;
    if (g._max.updatedAt && g._max.updatedAt > cur.last) cur.last = g._max.updatedAt;
    cur.attempts = Math.max(cur.attempts, g._max.attempts ?? 0);
    byDestination.set(g.destination, cur);
  }
  for (const [destination, c] of byDestination) items.push(closedLoopFailureItem({ destination, label: DESTINATION_LABEL[destination as DestinationKey] ?? destination, dead: c.dead, retrying: c.retrying, firstSeen: c.first, lastSeen: c.last, maxAttempts: c.attempts }));
  return items;
}
