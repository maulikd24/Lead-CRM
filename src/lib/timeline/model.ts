import type { TimelineChannel, TimelineEvent, TimelineKind, TimelineTone } from "@/lib/c360/timeline";
import type { TimelineSource } from "@/lib/relationships/registry";
import type { Ref } from "@/lib/events/envelope";

/**
 * The pure half of the canonical customer timeline (getCustomerTimeline): adapters from each domain table and from CustomerEvent into ONE item shape,
 * the rules that keep a fact from appearing twice, and pagination. No Prisma, no React: everything here is unit-tested.
 *
 * Rules: the domain table is authoritative. A CustomerEvent is shown only when no domain item already stands for the same record; an item that
 * replaces an older presentation of the same fact (a ticket row replaces the activity written when the ticket was first seen) says so in `supersedes`,
 * so the equivalence test can prove nothing the old Customer 360 showed has gone missing.
 */

export type TimelineItem = TimelineEvent & {
  source: TimelineSource;
  /** The authoritative domain record this item stands for (the link back). Null when the source row is gone (an erased customer's event). */
  sourceRef: Ref | null;
  /** When the underlying record was last known to be current (its update time; for a fact, when we received it). Never "now" for stored facts. */
  asOf: string;
  /** Ids of older items this one replaces. */
  supersedes?: string[];
};

const DETAIL_MAX = 280;
const clip = (t: string | null | undefined): string | undefined => {
  const v = typeof t === "string" ? t.trim() : "";
  if (!v) return undefined;
  return v.length > DETAIL_MAX ? `${v.slice(0, DETAIL_MAX)}…` : v;
};
const iso = (d: Date) => d.toISOString();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const words = (v: string) => v.toLowerCase().replace(/_/g, " ");

function make(base: { id: string; kind: TimelineKind; channel: TimelineChannel; at: Date; title: string; detail?: string; actor?: string | null; tone?: TimelineTone; source: TimelineSource; ref: Ref | null; asOf?: Date; supersedes?: string[] }): TimelineItem {
  return { id: base.id, kind: base.kind, channel: base.channel, at: iso(base.at), title: base.title, ...(base.detail ? { detail: base.detail } : {}), ...(base.actor ? { actor: base.actor } : {}), ...(base.tone ? { tone: base.tone } : {}), source: base.source, sourceRef: base.ref, asOf: iso(base.asOf ?? base.at), ...(base.supersedes?.length ? { supersedes: base.supersedes } : {}) };
}

export function stageItem(s: { id: string; fromStage: string | null; toStage: string; changedAt: Date; byName: string | null; reason: string | null; slaMet: boolean | null }): TimelineItem {
  return make({ id: `stage:${s.id}`, kind: "stage", channel: "system", at: s.changedAt, title: `Stage: ${s.fromStage ?? "?"} to ${s.toStage}`, detail: clip(s.reason), actor: s.byName, tone: s.slaMet === false ? "warning" : undefined, source: "stage", ref: { table: "StageHistory", id: s.id } });
}

export function ticketItem(t: { id: string; status: string | null; subject: string | null; ticketCreatedAt: Date | null; createdAt: Date; updatedAt: Date; activityId: string | null; isComplaint: boolean }): TimelineItem {
  const status = (t.status ?? "").toLowerCase();
  return make({
    id: `ticket:${t.id}`, kind: "ticket", channel: "system", at: t.ticketCreatedAt ?? t.createdAt, asOf: t.updatedAt,
    title: `Support ticket ${status || "opened"}`, detail: clip(t.subject), tone: t.isComplaint ? "warning" : undefined, source: "ticket", ref: { table: "SupportTicket", id: t.id }, supersedes: t.activityId ? [`activity:${t.activityId}`] : [],
  });
}

const PURPOSE = (p: string) => words(p);
const CHANNEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "email", CALL: "call" };
export function consentItem(c: { id: string; purpose: string; channel: string | null; status: string; capturedAt: Date; source: string }): TimelineItem {
  const granted = c.status === "GRANTED";
  const verb = granted ? "granted" : c.status === "WITHDRAWN" ? "withdrawn" : words(c.status);
  const channel = c.channel ? ` (${CHANNEL[c.channel] ?? words(c.channel)})` : "";
  return make({ id: `consent:${c.id}`, kind: "consent", channel: "system", at: c.capturedAt, title: `Consent ${verb}: ${PURPOSE(c.purpose)}${channel}`, tone: granted ? "positive" : c.status === "WITHDRAWN" ? "warning" : undefined, source: "consent", ref: { table: "ConsentRecord", id: c.id } });
}

export function taskItems(t: { id: string; title: string; status: string; dueAt: Date; createdAt: Date; updatedAt: Date }, ctx: { completedActivities: { id: string; message: string; at: Date }[]; now: Date }): TimelineItem[] {
  const ref = { table: "Task", id: t.id };
  if (t.status === "DONE") {
    // Completing a task already writes a TASK_COMPLETED activity: that item stands for it. Only a completion without one is added.
    const mirrored = ctx.completedActivities.some((a) => a.message === `Completed task: ${t.title}` && Math.abs(a.at.getTime() - t.updatedAt.getTime()) <= 5 * 60_000);
    if (mirrored) return [];
    return [make({ id: `task:${t.id}`, kind: "task", channel: "system", at: t.updatedAt, title: `Task completed: ${t.title}`, tone: "positive", source: "task", ref })];
  }
  const overdue = t.status !== "CANCELLED" && t.dueAt.getTime() < ctx.now.getTime();
  return [make({ id: `task:${t.id}`, kind: "task", channel: "system", at: t.createdAt, asOf: t.updatedAt, title: `Task: ${t.title}`, detail: t.status === "CANCELLED" ? "Cancelled" : `Due ${shortDate(t.dueAt)}${overdue ? " (overdue)" : ""}`, tone: overdue ? "warning" : undefined, source: "task", ref })];
}

export function insightItem(i: { id: string; kind: string; status: string; text: string; severity: string | null; dueAt: Date | null; occurredAt: Date; resolvedAt: Date | null; createdAt: Date }): TimelineItem | null {
  if (i.kind !== "COMPLAINT" && i.kind !== "COMMITMENT") return null;
  const ref = { table: "ConversationInsight", id: i.id };
  const resolved = i.status === "RESOLVED" || i.resolvedAt !== null;
  if (i.kind === "COMPLAINT") {
    return make({ id: `insight:${i.id}`, kind: "complaint", channel: "system", at: i.occurredAt, asOf: i.resolvedAt ?? i.createdAt, title: `Complaint raised${i.severity ? ` (${i.severity})` : ""}`, detail: resolved ? "Resolved" : undefined, tone: resolved ? "positive" : "negative", source: "insight", ref });
  }
  return make({ id: `insight:${i.id}`, kind: "commitment", channel: "system", at: i.occurredAt, asOf: i.resolvedAt ?? i.createdAt, title: "Commitment made", detail: resolved ? "Done" : i.dueAt ? `Due ${shortDate(i.dueAt)}` : undefined, tone: resolved ? "positive" : undefined, source: "insight", ref });
}

export function milestoneItems(kyc: { id: string; status: string; submissionDate: Date | null; completionDate: Date | null; updatedAt: Date } | null, funding: { id: string; status: string; fundingDate: Date | null; updatedAt: Date } | null): TimelineItem[] {
  const out: TimelineItem[] = [];
  if (kyc) {
    const ref = { table: "KycRecord", id: kyc.id };
    if (kyc.submissionDate) out.push(make({ id: `milestone:kyc-submitted:${kyc.id}`, kind: "milestone", channel: "system", at: kyc.submissionDate, asOf: kyc.updatedAt, title: "KYC submitted", source: "milestone", ref }));
    if (kyc.status === "APPROVED" && kyc.completionDate) out.push(make({ id: `milestone:kyc-approved:${kyc.id}`, kind: "milestone", channel: "system", at: kyc.completionDate, asOf: kyc.updatedAt, title: "KYC approved", tone: "positive", source: "milestone", ref }));
    if (kyc.status === "REJECTED" && kyc.completionDate) out.push(make({ id: `milestone:kyc-rejected:${kyc.id}`, kind: "milestone", channel: "system", at: kyc.completionDate, asOf: kyc.updatedAt, title: "KYC rejected", tone: "warning", source: "milestone", ref }));
  }
  if (funding && (funding.status === "FULLY_FUNDED" || funding.status === "PARTIALLY_FUNDED") && funding.fundingDate) {
    out.push(make({ id: `milestone:funded:${funding.id}`, kind: "milestone", channel: "money", at: funding.fundingDate, asOf: funding.updatedAt, title: funding.status === "FULLY_FUNDED" ? "Account funded" : "Account partly funded", tone: "positive", source: "milestone", ref: { table: "FundingRecord", id: funding.id } }));
  }
  return out;
}

export function goalItem(g: { id: string; name: string; createdAt: Date; updatedAt: Date }): TimelineItem {
  return make({ id: `goal:${g.id}`, kind: "goal", channel: "note", at: g.createdAt, asOf: g.updatedAt, title: `Goal set: ${g.name}`, source: "goal", ref: { table: "CustomerGoal", id: g.id } });
}
export function reviewItem(r: { id: string; reviewedAt: Date; createdAt: Date }): TimelineItem {
  return make({ id: `review:${r.id}`, kind: "goal", channel: "meeting", at: r.reviewedAt, asOf: r.createdAt, title: "Customer review completed", source: "goal", ref: { table: "CustomerReview", id: r.id } });
}
export function referralItem(r: { id: string; outcome: string; attributedAt: Date }): TimelineItem {
  return make({ id: `referral:${r.id}`, kind: "referral", channel: "system", at: r.attributedAt, title: r.outcome === "ATTRIBUTED" ? "Referral attributed" : `Referral ${words(r.outcome)}`, source: "referral", ref: { table: "Referral", id: r.id } });
}

// ---- events ---------------------------------------------------------------------------------------------------------------------------
const NOISE = new Set(["whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.window.expired"]);
const WORD: Record<string, string> = { whatsapp: "WhatsApp", kyc: "KYC", sip: "SIP", nba: "Next action", sla: "SLA", ckyc: "CKYC" };
const humanTitle = (type: string): string => {
  const out = type.split(".").flatMap((p) => p.split("_")).map((w) => WORD[w] ?? w);
  return out.map((w, i) => (i === 0 && /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
};

export type EventRow = { id: string; eventType: string; occurredAt: Date; receivedAt: Date; actorType: string; metadata: unknown; late: boolean; schemaVersion: number };

export function eventItem(e: EventRow): TimelineItem | null {
  if (NOISE.has(e.eventType)) return null;
  const meta = typeof e.metadata === "object" && e.metadata !== null ? (e.metadata as Record<string, unknown>) : {};
  const r = meta.ref as { table?: unknown; id?: unknown } | undefined;
  const ref: Ref | null = r && typeof r.table === "string" && typeof r.id === "string" ? { table: r.table, id: r.id } : null;
  return make({ id: `event:${e.id}`, kind: "fact", channel: "system", at: e.occurredAt, asOf: e.receivedAt, title: humanTitle(e.eventType), detail: e.late ? "Reported late" : undefined, source: "event", ref });
}

/** An event whose domain record already stands on the timeline adds nothing: the domain table is authoritative. */
export function suppressCoveredEvents(events: TimelineItem[], domain: TimelineItem[]): TimelineItem[] {
  const covered = new Set(domain.filter((d) => d.sourceRef).map((d) => `${d.sourceRef!.table}:${d.sourceRef!.id}`));
  return events.filter((e) => !(e.sourceRef && covered.has(`${e.sourceRef.table}:${e.sourceRef.id}`)));
}

/** Removes the older presentations that an item replaces: explicit `supersedes`, and the STAGE_CHANGE activity written next to each StageHistory row. */
export function absorbSuperseded(items: TimelineItem[]): TimelineItem[] {
  const drop = new Set<string>();
  for (const i of items) for (const id of i.supersedes ?? []) drop.add(id);
  const stageActivities = items.filter((i) => i.id.startsWith("activity:") && i.kind === "stage");
  const used = new Set<string>();
  for (const s of items.filter((i) => i.source === "stage")) {
    const match = stageActivities.find((a) => !used.has(a.id) && a.title === s.title && Math.abs(Date.parse(a.at) - Date.parse(s.at)) <= 60_000);
    if (match) { used.add(match.id); drop.add(match.id); }
  }
  return items.filter((i) => !drop.has(i.id));
}

// ---- pagination -----------------------------------------------------------------------------------------------------------------------
export const encodeCursor = (at: string, id: string): string => `${at}|${id}`;
export function decodeCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf("|");
  if (i < 1) return null;
  const at = cursor.slice(0, i);
  return Number.isNaN(Date.parse(at)) ? null : { at, id: cursor.slice(i + 1) };
}

const MAX_LIMIT = 200;
export const compareNewestFirst = (a: TimelineItem, b: TimelineItem): number => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Newest first, ties by id (stable), cursor-based so a page never skips or repeats an item that shares a timestamp. */
export function pageItems(items: TimelineItem[], o: { limit?: number; before?: string | null }): { items: TimelineItem[]; nextCursor: string | null } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(o.limit ?? 50)));
  const sorted = [...items].sort(compareNewestFirst);
  const cur = decodeCursor(o.before);
  const after = cur ? sorted.filter((i) => compareNewestFirst({ ...i, at: cur.at, id: cur.id }, i) < 0) : sorted;
  const page = after.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: after.length > limit && last ? encodeCursor(last.at, last.id) : null };
}
