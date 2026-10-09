// Pure view-model for the Customer 360 timeline: adapters from each source into one event shape, merge, filter and
// group by day. No Prisma, no React: everything here is unit-tested.

export type TimelineKind = "note" | "call" | "message" | "meeting" | "contact" | "ticket" | "outcome" | "agent" | "journey" | "stage" | "status" | "task" | "transaction";
export type TimelineChannel = "call" | "whatsapp" | "sms" | "email" | "message" | "meeting" | "note" | "system" | "ai" | "money";
export type TimelineTone = "default" | "positive" | "warning" | "negative";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  channel: TimelineChannel;
  /** ISO timestamp. */
  at: string;
  title: string;
  detail?: string;
  actor?: string | null;
  tone?: TimelineTone;
};

const DETAIL_MAX = 280;
const clip = (text: string | null | undefined): string | undefined => {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return undefined;
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t;
};
const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export type ActivityInput = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  userName: string | null;
  call?: { direction: string; durationSeconds: number } | null;
};

export function fromActivity(a: ActivityInput): TimelineEvent {
  const p = asRecord(a.payload);
  const base = { id: `activity:${a.id}`, at: a.createdAt.toISOString(), actor: a.userName };
  const message = clip(str(p.message));
  switch (a.type) {
    case "CALL": {
      const direction = a.call?.direction ?? "OTHER";
      const label = direction === "MISSED" ? "Missed call" : direction === "REJECTED" ? "Rejected call" : direction === "INCOMING" ? "Incoming call" : direction === "OUTGOING" ? "Outgoing call" : "Call";
      const seconds = a.call?.durationSeconds ?? (typeof p.durationSeconds === "number" ? p.durationSeconds : 0);
      return { ...base, kind: "call", channel: "call", title: label, detail: seconds > 0 ? duration(seconds) : message, tone: direction === "MISSED" || direction === "REJECTED" ? "warning" : "default" };
    }
    case "MESSAGE": {
      const channel = str(p.channel)?.toLowerCase();
      return { ...base, kind: "message", channel: channel === "whatsapp" || channel === "sms" || channel === "email" ? channel : "message", title: p.direction === "INBOUND" ? "Message received" : "Message sent", detail: clip(str(p.body)) ?? message };
    }
    case "STAGE_CHANGE":
      return { ...base, kind: "stage", channel: "system", title: `Stage: ${str(p.fromStage) ?? "?"} to ${str(p.toStage) ?? "?"}` };
    case "STATUS_CHANGE":
      return { ...base, kind: "status", channel: "system", title: `Status: ${str(p.status) ?? "updated"}` };
    case "TICKET":
      return { ...base, kind: "ticket", channel: "system", title: `Support ticket ${str(p.status) ?? "updated"}`, detail: message };
    case "TASK_COMPLETED":
      return { ...base, kind: "task", channel: "system", title: "Task completed", detail: message, tone: "positive" };
    case "JOURNEY_EVENT":
      return { ...base, kind: "journey", channel: "system", title: "Journey event", detail: message };
    case "MEETING":
      return { ...base, kind: "meeting", channel: "meeting", title: "Meeting", detail: message };
    case "CONTACT":
      return { ...base, kind: "contact", channel: "call", title: "Contacted client", detail: message };
    default:
      return { ...base, kind: "note", channel: "note", title: "Note", detail: message };
  }
}

export type MessageInput = { id: string; channel: string; direction: string; body: string; status: string; createdAt: Date };

export function fromMessage(m: MessageInput): TimelineEvent {
  const channel = m.channel.toLowerCase();
  const known = channel === "whatsapp" || channel === "sms" || channel === "email";
  const name = channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : channel === "email" ? "Email" : "Message";
  return {
    id: `message:${m.id}`,
    kind: "message",
    channel: known ? (channel as TimelineChannel) : "message",
    at: m.createdAt.toISOString(),
    title: `${name} ${m.direction === "INBOUND" ? "received" : "sent"}`,
    detail: clip(m.body),
    tone: m.status === "FAILED" ? "warning" : "default",
  };
}

const OUTCOME_LABEL: Record<string, string> = { INTERESTED: "Interested", NOT_INTERESTED: "Not interested", FOLLOW_UP: "Follow up", CONVERTED: "Converted", NOT_RELEVANT: "Not relevant", RM_HANDOVER: "Needs RM", SERVICE_ISSUE: "Service issue" };
const OUTCOME_TONE: Record<string, TimelineTone> = { INTERESTED: "positive", CONVERTED: "positive", NOT_INTERESTED: "negative", SERVICE_ISSUE: "warning" };
const OUTCOME_CHANNEL: Record<string, TimelineChannel> = { CALL: "call", WHATSAPP: "whatsapp", MEETING: "meeting", EMAIL: "email", AI_BOT: "ai" };

export type OutcomeInput = { id: string; outcome: string; channel: string; assetClass: string | null; note: string | null; summary: string | null; createdAt: Date };

export function fromOutcome(o: OutcomeInput): TimelineEvent {
  const label = OUTCOME_LABEL[o.outcome] ?? o.outcome;
  return {
    id: `outcome:${o.id}`,
    kind: "outcome",
    channel: OUTCOME_CHANNEL[o.channel] ?? "system",
    at: o.createdAt.toISOString(),
    title: `Outcome: ${label}${o.assetClass ? ` (${o.assetClass})` : ""}`,
    detail: clip(o.summary ?? o.note),
    tone: OUTCOME_TONE[o.outcome] ?? "default",
  };
}

const PROPOSAL_TITLE: Record<string, string> = { DRAFT: "AI draft awaiting approval", APPROVED: "AI draft approved", SENT: "AI draft sent after approval", REJECTED: "AI draft rejected", BLOCKED: "AI draft blocked by guardrails", EXPIRED: "AI draft expired" };

export type ProposalInput = { id: string; status: string; channel: string; body: string; reason: string; createdAt: Date };

export function fromProposal(p: ProposalInput): TimelineEvent {
  return {
    id: `agent:${p.id}`,
    kind: "agent",
    channel: "ai",
    at: p.createdAt.toISOString(),
    title: PROPOSAL_TITLE[p.status] ?? `AI draft ${p.status.toLowerCase()}`,
    detail: clip(p.body),
    tone: p.status === "BLOCKED" || p.status === "REJECTED" ? "warning" : "default",
  };
}

export type JourneyRunInput = { id: string; journeyName: string; status: string; startedAt: Date };

export function fromJourneyRun(r: JourneyRunInput): TimelineEvent {
  const status = r.status.toLowerCase();
  return { id: `journey:${r.id}`, kind: "journey", channel: "system", at: r.startedAt.toISOString(), title: `Journey ${r.journeyName} ${status === "running" ? "running" : status}`, tone: r.status === "FAILED" ? "warning" : "default" };
}

export type TransactionInput = { id: string; type: string; productName: string | null; amount: number; date: Date };

export function fromTransaction(t: TransactionInput): TimelineEvent {
  return {
    id: `transaction:${t.id}`,
    kind: "transaction",
    channel: "money",
    at: t.date.toISOString(),
    title: `${t.type}${t.productName ? `: ${t.productName}` : ""}`,
    detail: `INR ${Math.round(t.amount).toLocaleString("en-IN")}`,
  };
}

/** Newest first, de-duplicated by id (first wins), invalid dates dropped, capped. */
export function mergeTimeline(sources: TimelineEvent[][], cap = 200): TimelineEvent[] {
  const seen = new Set<string>();
  const all: { e: TimelineEvent; t: number; order: number }[] = [];
  let order = 0;
  for (const list of sources) {
    for (const e of list) {
      const t = Date.parse(e.at);
      if (Number.isNaN(t) || seen.has(e.id)) continue;
      seen.add(e.id);
      all.push({ e, t, order: order++ });
    }
  }
  all.sort((a, b) => b.t - a.t || a.order - b.order);
  return all.slice(0, cap).map((x) => x.e);
}

export type FilterKey = "all" | "conversations" | "notes" | "service" | "outcomes" | "ai" | "money";

export const FILTERS: { key: FilterKey; label: string; kinds: TimelineKind[] | null }[] = [
  { key: "all", label: "All", kinds: null },
  { key: "conversations", label: "Conversations", kinds: ["call", "message", "meeting", "contact"] },
  { key: "notes", label: "Notes", kinds: ["note"] },
  { key: "service", label: "Service", kinds: ["ticket"] },
  { key: "outcomes", label: "Outcomes", kinds: ["outcome"] },
  { key: "ai", label: "AI and journeys", kinds: ["agent", "journey"] },
  { key: "money", label: "Transactions", kinds: ["transaction"] },
];

export function filterTimeline(events: TimelineEvent[], key: FilterKey): TimelineEvent[] {
  const kinds = FILTERS.find((f) => f.key === key)?.kinds;
  return kinds ? events.filter((e) => kinds.includes(e.kind)) : events;
}

const IST_OFFSET_MIN = 330;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayParts(ms: number, offsetMin: number) {
  const d = new Date(ms + offsetMin * 60_000);
  return { key: `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`, label: `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, dayNumber: Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000) };
}

export type DayGroup = { key: string; label: string; events: TimelineEvent[] };

/** Groups newest-first events by calendar day in India time (the firm's operating timezone). */
export function groupByDay(events: TimelineEvent[], now: Date, offsetMin: number = IST_OFFSET_MIN): DayGroup[] {
  const today = dayParts(now.getTime(), offsetMin).dayNumber;
  const groups: DayGroup[] = [];
  for (const e of events) {
    const p = dayParts(Date.parse(e.at), offsetMin);
    const last = groups[groups.length - 1];
    if (last && last.key === p.key) {
      last.events.push(e);
      continue;
    }
    const label = p.dayNumber === today ? "Today" : p.dayNumber === today - 1 ? "Yesterday" : p.label;
    groups.push({ key: p.key, label, events: [e] });
  }
  return groups;
}

/** New enough to deserve the live pulse. */
export function isFresh(at: string, now: Date, windowMs = 30 * 60_000): boolean {
  const t = Date.parse(at);
  return !Number.isNaN(t) && now.getTime() - t < windowMs;
}

export function formatClock(iso: string, offsetMin: number = IST_OFFSET_MIN): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + offsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
