import { slaOf, type HandoffTicketView } from "@/lib/integrations/freshdesk/ticket-view";
import type { SlaState } from "@/lib/integrations/freshdesk/sla";

/**
 * The co-pilot's facts about one open Freshdesk ticket. Pure: no database, no model. Everything the panel shows about the ticket
 * and the customer's history is built here from facts (dates, counts, SLA states, the stored hand-off fields), so the summary can be
 * tested on its own. Contact details never reach this file: the history is reduced to kinds, sources and dates before it arrives.
 */

export const HISTORY_WINDOW_DAYS = 90;

export const ISSUE_CATEGORIES = ["complaint", "compliance", "billing", "account_access", "transaction_status", "documents", "general"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  complaint: "Complaint",
  compliance: "Compliance or KYC concern",
  billing: "Billing or charge",
  account_access: "Account access",
  transaction_status: "Order or transaction status",
  documents: "Statement or document request",
  general: "General query",
};

/** Keyword rules, first match wins. Complaint and compliance come first: they always escalate. Matched on the ticket's own words only. */
const RULES: readonly [IssueCategory, RegExp][] = [
  ["complaint", /\b(complain\w*|unhappy|angry|frustrat\w*|terrible|worst|cheat\w*|fraud\w*|mis-?sold|mis-?selling|escalat\w*|legal|consumer forum|ombudsman|disappoint\w*)\b/i],
  ["compliance", /\b(sebi|compliance|regulat\w*|kyc|nominee|aadhaar|aadhar|pan card|mismatch)\b/i],
  ["billing", /\b(charg\w*|debit\w*|invoice|bill|fees?|payments?|refunds?|double)\b/i],
  ["account_access", /\b(log ?in|password|otp|locked|access|sign ?in|blocked)\b/i],
  ["transaction_status", /\b(orders?|trades?|withdraw\w*|transfers?|credits?|not received|status|pending)\b/i],
  ["documents", /\b(statements?|documents?|certificates?|contracts?|forms?|tax)\b/i],
];

/** The likely issue category, from the ticket's subject, the AI intent and the stored summary. Deterministic. */
export function classifyIssue(text: string): IssueCategory {
  for (const [category, re] of RULES) if (re.test(text)) return category;
  return "general";
}

/** One timeline item, reduced to what the facts need. No free text, no names, no contact details. */
export type HistoryItem = { kind: string; at: Date };

const CONTACT_KINDS = new Set(["call", "message", "meeting", "contact"]);

export type TicketFacts = {
  ticketId: string;
  status: string;
  priority: string;
  channel: string;
  handoffAt: string;
  subject: string;
  intent: string;
  summary: string;
  sla: { firstResponse: SlaState; resolution: SlaState; firstResponseDueAt: string; resolutionDueAt: string; responded: boolean };
  category: IssueCategory;
  negativeSentiment: boolean;
  history: {
    windowDays: number;
    supportTickets: number;
    complaints: number;
    contacts: number;
    lastContactAt: string | null;
    lastContactKind: string | null;
    /** Open complaints, incorrect-information and compliance concerns on the customer's record. */
    openComplaints: number;
    openCommitments: number;
  };
  escalate: boolean;
  escalateReasons: string[];
};

export type BuildFactsInput = {
  view: HandoffTicketView;
  now: Date;
  /** When the first response was made (the follow-up task was completed), or null while it is still waiting. */
  respondedAt: Date | null;
  history: readonly HistoryItem[];
  openComplaints: number;
  openCommitments: number;
  /** The customer's sentiment or an escalation flag was already set on the ticket at hand-off. */
  escalatedAtHandoff: boolean;
  /** The channel the ticket came in on, as stored at hand-off (a readable label). */
  channel: string;
};

export function buildTicketFacts(input: BuildFactsInput): TicketFacts {
  const { view, now } = input;
  const sla = slaOf(view, now, input.respondedAt);
  const cutoff = now.getTime() - HISTORY_WINDOW_DAYS * 86_400_000;
  const recent = input.history.filter((h) => h.at.getTime() >= cutoff && h.at.getTime() <= now.getTime());
  const contacts = [...input.history].filter((h) => CONTACT_KINDS.has(h.kind)).sort((a, b) => b.at.getTime() - a.at.getTime());
  const last = contacts[0] ?? null;

  const text = `${view.subject} ${view.intent} ${view.summary}`;
  const category = classifyIssue(text);
  const negativeSentiment = view.sentiment === "negative";

  const escalateReasons: string[] = [];
  if (category === "complaint") escalateReasons.push("the ticket reads as a complaint");
  if (category === "compliance") escalateReasons.push("the ticket raises a compliance or KYC concern");
  if (negativeSentiment) escalateReasons.push("the customer sounded unhappy");
  if (input.openComplaints > 0) escalateReasons.push("an open complaint is on record");
  if (input.escalatedAtHandoff && escalateReasons.length === 0) escalateReasons.push("the hand-off was escalated");

  return {
    ticketId: view.ticketId,
    status: view.status,
    priority: view.priority,
    channel: input.channel,
    handoffAt: view.handoffAt.toISOString(),
    subject: view.subject,
    intent: view.intent,
    summary: view.summary,
    sla: {
      firstResponse: sla.response.state,
      resolution: sla.resolution.state,
      firstResponseDueAt: view.firstResponseDueAt.toISOString(),
      resolutionDueAt: view.resolutionDueAt.toISOString(),
      responded: input.respondedAt !== null,
    },
    category,
    negativeSentiment,
    history: {
      windowDays: HISTORY_WINDOW_DAYS,
      supportTickets: recent.filter((h) => h.kind === "ticket").length,
      complaints: recent.filter((h) => h.kind === "complaint").length,
      contacts: recent.filter((h) => CONTACT_KINDS.has(h.kind)).length,
      lastContactAt: last ? last.at.toISOString() : null,
      lastContactKind: last ? last.kind : null,
      openComplaints: input.openComplaints,
      openCommitments: input.openCommitments,
    },
    escalate: escalateReasons.length > 0,
    escalateReasons,
  };
}

const SLA_WORDS: Record<SlaState, string> = { ok: "on track", at_risk: "at risk", breached: "breached", met: "met" };
const day = (iso: string) => iso.slice(0, 10);

/**
 * The plain summary shown above the draft. Every line is a fixed sentence filled from a fact: the panel never shows free text it
 * was not given as a fact. The ticket's stored summary is shown separately, as the ticket's own words.
 */
export function summaryLines(f: TicketFacts): string[] {
  const lines = [
    `Ticket ${f.ticketId} is ${f.status || "open"}, ${f.priority} priority, handed off ${day(f.handoffAt)}.`,
    `Likely issue: ${CATEGORY_LABEL[f.category]}${f.intent ? ` (${f.intent})` : ""}.`,
    `First response ${SLA_WORDS[f.sla.firstResponse]}${f.sla.responded ? " (answered)" : ""}. Resolution ${SLA_WORDS[f.sla.resolution]}.`,
    `Last ${f.history.windowDays} days: ${f.history.supportTickets} support ticket${f.history.supportTickets === 1 ? "" : "s"}, ${f.history.complaints} complaint${f.history.complaints === 1 ? "" : "s"}, ${f.history.contacts} contact${f.history.contacts === 1 ? "" : "s"}.`,
    f.history.lastContactAt && f.history.lastContactKind
      ? `Last contact: ${f.history.lastContactKind} on ${day(f.history.lastContactAt)}.`
      : "No contact on record.",
  ];
  if (f.history.openComplaints > 0) lines.push(`${f.history.openComplaints} open complaint, incorrect-information or compliance concern${f.history.openComplaints === 1 ? "" : "s"} on record.`);
  if (f.history.openCommitments > 0) lines.push(`${f.history.openCommitments} open commitment${f.history.openCommitments === 1 ? "" : "s"} owed to the customer.`);
  if (f.escalate) lines.push(`Escalation suggested: ${f.escalateReasons.join("; ")}.`);
  return lines;
}
