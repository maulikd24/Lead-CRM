import { slaProgress, type SlaState, type TicketPriority } from "./sla";

/** Plain-data view of one stored hand-off (a TICKET activity with payload.handoff = true). */
export type HandoffTicketView = {
  activityId: string;
  ticketId: string;
  subject: string;
  status: string;
  priority: TicketPriority;
  intent: string;
  sentiment: string;
  summary: string;
  handoffAt: Date;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  resolvedAt: Date | null;
  link: string | null;
};

const CLOSED = new Set(["resolved", "closed"]);
export const isOpenStatus = (status: string): boolean => !CLOSED.has(status.trim().toLowerCase());

/** A link out to Freshdesk: the ticket's own https link, else the configured base URL. Never a non-https URL. */
export function resolveTicketLink(ticketUrl: string | undefined | null, baseUrl: string | null | undefined, ticketId: string): string | null {
  const https = (raw: string) => {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" ? u : null;
    } catch {
      return null;
    }
  };
  if (ticketUrl && https(ticketUrl)) return ticketUrl;
  const base = baseUrl ? https(baseUrl) : null;
  return base ? `${base.origin}/a/tickets/${encodeURIComponent(ticketId)}` : null;
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const PRIORITIES: TicketPriority[] = ["urgent", "high", "medium", "low"];

export function toTicketView(raw: unknown, activityId: string, baseUrl: string | null): HandoffTicketView | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.handoff !== true) return null;
  const handoffAt = date(p.handoffAt);
  const firstResponseDueAt = date(p.firstResponseDueAt);
  const resolutionDueAt = date(p.resolutionDueAt);
  const ticketId = str(p.ticketId);
  if (!handoffAt || !firstResponseDueAt || !resolutionDueAt || !ticketId) return null;
  const priority = PRIORITIES.includes(p.priority as TicketPriority) ? (p.priority as TicketPriority) : "medium";
  return {
    activityId,
    ticketId,
    subject: str(p.subject),
    status: str(p.ticketStatus, "open"),
    priority,
    intent: str(p.intent),
    sentiment: str(p.sentiment, "neutral"),
    summary: str(p.summary),
    handoffAt,
    firstResponseDueAt,
    resolutionDueAt,
    resolvedAt: date(p.resolvedAt),
    link: resolveTicketLink(str(p.ticketUrl) || null, baseUrl, ticketId),
  };
}

export type SupportRow = {
  view: HandoffTicketView;
  clientName: string;
  rmId: string | null;
  rmName: string | null;
  /** The RM's follow-up task is completed. Used as the "first response" signal. */
  taskDone: boolean;
  taskDoneAt: Date | null;
};

export type SupportStats = {
  total: number;
  open: number;
  byStatus: Record<string, number>;
  byPriority: Record<TicketPriority, number>;
  waitingForRm: number;
  firstResponseBreaches: number;
  resolutionBreaches: number;
  /** Share of hand-offs with no SLA breach, 0-100. Null when there are none (no honest number to show). */
  compliancePct: number | null;
  perRm: { rmId: string | null; rmName: string; open: number; waiting: number; breached: number }[];
};

export const slaOf = (v: HandoffTicketView, now: Date, responseAt: Date | null) => ({
  response: slaProgress(v.handoffAt, v.firstResponseDueAt, now, responseAt),
  resolution: slaProgress(v.handoffAt, v.resolutionDueAt, now, v.resolvedAt),
});

export function computeSupportStats(rows: SupportRow[], now: Date): SupportStats {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<TicketPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  const rms = new Map<string, { rmId: string | null; rmName: string; open: number; waiting: number; breached: number }>();
  let open = 0, waiting = 0, frBreaches = 0, resBreaches = 0, clean = 0;

  for (const r of rows) {
    const isOpen = isOpenStatus(r.view.status);
    const responseAt = r.taskDone ? (r.taskDoneAt ?? now) : null;
    const sla = slaOf(r.view, now, responseAt);
    const frBreach = sla.response.state === "breached";
    const resBreach = sla.resolution.state === "breached";
    if (frBreach) frBreaches++;
    if (resBreach) resBreaches++;
    if (!frBreach && !resBreach) clean++;
    const isWaiting = isOpen && !r.taskDone;

    const key = r.rmId ?? "_none";
    const entry = rms.get(key) ?? { rmId: r.rmId, rmName: r.rmName ?? "Unassigned", open: 0, waiting: 0, breached: 0 };
    if (isOpen) {
      open++;
      byStatus[r.view.status.toLowerCase()] = (byStatus[r.view.status.toLowerCase()] ?? 0) + 1;
      byPriority[r.view.priority]++;
      entry.open++;
      if (isWaiting) { waiting++; entry.waiting++; }
      if (frBreach || resBreach) entry.breached++;
    }
    rms.set(key, entry);
  }

  return {
    total: rows.length,
    open,
    byStatus,
    byPriority,
    waitingForRm: waiting,
    firstResponseBreaches: frBreaches,
    resolutionBreaches: resBreaches,
    compliancePct: rows.length === 0 ? null : Math.round((clean / rows.length) * 100),
    perRm: [...rms.values()].filter((e) => e.open > 0).sort((a, b) => b.open - a.open || a.rmName.localeCompare(b.rmName)),
  };
}

export type { SlaState };
