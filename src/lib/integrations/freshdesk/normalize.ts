import { z } from "zod";

import { needsHandover } from "@/lib/agents/guardrails";
import type { TicketPriority } from "./sla";

/** Hard caps. Anything longer is truncated, never rejected: a webhook must not fail because a chat ran long. */
export const LIMITS = { summary: 600, subject: 200, intent: 80, excerpt: 800, tags: 20, tagLength: 40, name: 100, id: 40 } as const;

export type HandoffSentiment = "negative" | "neutral" | "positive";

export type Handoff = {
  ticketId: string;
  ticketUrl?: string;
  contact: { email?: string; phone?: string; name?: string };
  subject: string;
  priority: TicketPriority;
  /** Priority after escalation (negative sentiment or a compliance word means at least "high"). */
  effectivePriority: TicketPriority;
  status: string;
  channel: string;
  tags: string[];
  summary: string;
  intent: string;
  sentiment: HandoffSentiment;
  /** Capped, scrubbed excerpt only. The full transcript is never kept. */
  excerpt: string;
  createdAt?: Date;
  updatedAt?: Date;
  escalation: { negativeSentiment: boolean; handoverReason: string | null };
};

export type NormalizeResult = { ok: true; handoff: Handoff } | { ok: false; reason: "invalid" | "not_handoff" | "no_ticket_id" | "no_contact" };

const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const LONG_DIGITS_RE = /\d[\d\s-]{7,}\d/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠﻿]/g;

/** Strips markup and control characters. Used on everything we keep. */
function clean(text: string): string {
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(CONTROL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Control-character strip only (no markup handling, no redaction). */
export const scrubStored = (text: string): string => text.replace(CONTROL_RE, "");

/** Redacts identifiers an RM never needs to see on a timeline: PAN-shaped text and long digit runs. */
function redact(text: string): string {
  return text.replace(PAN_RE, "[redacted]").replace(LONG_DIGITS_RE, "[redacted]");
}

/** For log lines only: also masks emails, then truncates. Never log raw payload text. */
export function scrubForLog(text: string): string {
  return redact(clean(text)).replace(EMAIL_RE, "[email]").slice(0, 160);
}

const text = z.union([z.string(), z.number()]).transform(String).catch("");

function cap(raw: string, max: number): string {
  return redact(clean(raw)).slice(0, max);
}

function tagList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return parts
    .filter((t): t is string => typeof t === "string")
    .map((t) => clean(t).toLowerCase().slice(0, LIMITS.tagLength))
    .filter(Boolean)
    .slice(0, LIMITS.tags);
}

export function isHandoffPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return tagList(p.tags).includes("ai_handoff") || (typeof p.event === "string" && p.event.trim().toLowerCase() === "ai_handoff");
}

const PRIORITY: Record<string, TicketPriority> = { "1": "low", "2": "medium", "3": "high", "4": "urgent", low: "low", medium: "medium", normal: "medium", high: "high", urgent: "urgent", critical: "urgent" };
const STATUS: Record<string, string> = { "2": "open", "3": "pending", "4": "resolved", "5": "closed" };

function transcriptExcerpt(raw: unknown): string {
  const lines: string[] = [];
  const items = Array.isArray(raw) ? raw.slice(0, 40) : [raw];
  for (const item of items) {
    if (typeof item === "string") lines.push(item);
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const who = typeof o.role === "string" ? clean(o.role).slice(0, 20) : "";
      const body = typeof o.text === "string" ? o.text : typeof o.message === "string" ? o.message : "";
      if (body) lines.push(who ? `${who}: ${body}` : body);
    }
  }
  return cap(lines.join(" / "), LIMITS.excerpt);
}

function parseDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function sentimentOf(raw: string): HandoffSentiment {
  const s = raw.toLowerCase();
  if (/neg|angry|frustrat|upset|unhappy/.test(s)) return "negative";
  if (/pos|happy|satisf/.test(s)) return "positive";
  return "neutral";
}

const shape = z.object({
  ticket_id: text,
  ticket_url: text,
  requester_email: text,
  requester_phone: text,
  requester_name: text,
  subject: text,
  priority: text,
  status: text,
  channel: text,
  source: text,
  ai_summary: text,
  ai_intent: text,
  ai_sentiment: text,
});

/** Tolerant normaliser for an AI hand-off ticket event. Never throws; reports why it skipped. */
export function normalizeHandoff(payload: unknown): NormalizeResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "invalid" };
  const raw = payload as Record<string, unknown>;
  if (!isHandoffPayload(raw)) return { ok: false, reason: "not_handoff" };
  const f = shape.parse(raw);

  const ticketId = f.ticket_id.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(ticketId)) return { ok: false, reason: "no_ticket_id" };

  const email = f.requester_email.trim().toLowerCase();
  const digits = f.requester_phone.replace(/\D/g, "");
  const contact: Handoff["contact"] = {};
  if (/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,}$/.test(email)) contact.email = email.slice(0, 254);
  if (digits.length >= 7 && digits.length <= 15) contact.phone = f.requester_phone.trim().slice(0, 25);
  if (!contact.email && !contact.phone) return { ok: false, reason: "no_contact" };
  const name = cap(f.requester_name, LIMITS.name);
  if (name) contact.name = name;

  const priority = PRIORITY[f.priority.trim().toLowerCase()] ?? "medium";
  const status = STATUS[f.status.trim()] ?? (cap(f.status, 20).toLowerCase() || "open");
  const subject = cap(f.subject, LIMITS.subject);
  const summary = cap(f.ai_summary, LIMITS.summary);
  const excerpt = transcriptExcerpt(raw.transcript ?? raw.conversation);
  const sentiment = sentimentOf(f.ai_sentiment);

  const verdict = needsHandover(`${subject} ${summary} ${excerpt}`);
  const negativeSentiment = sentiment === "negative";
  const effectivePriority: TicketPriority = (negativeSentiment || verdict.handover) && priority !== "urgent" ? "high" : priority;

  let ticketUrl: string | undefined;
  try {
    const u = new URL(f.ticket_url.trim());
    if (u.protocol === "https:") ticketUrl = u.toString().slice(0, 300);
  } catch {
    /* ignore bad link */
  }

  return {
    ok: true,
    handoff: {
      ticketId,
      ...(ticketUrl ? { ticketUrl } : {}),
      contact,
      subject,
      priority,
      effectivePriority,
      status,
      channel: cap(f.channel || f.source, 30) || "Other",
      tags: tagList(raw.tags),
      summary,
      intent: cap(f.ai_intent, LIMITS.intent),
      sentiment,
      excerpt,
      createdAt: parseDate(raw.created_at),
      updatedAt: parseDate(raw.updated_at),
      escalation: { negativeSentiment, handoverReason: verdict.handover ? (verdict.reason ?? "compliance wording") : null },
    },
  };
}

/** The one line shown on the customer timeline. */
export function buildTimelineMessage(h: Pick<Handoff, "intent" | "summary">): string {
  const head = `Support hand-off: ${h.intent || "customer query"}`;
  return h.summary ? `${head} — ${h.summary.slice(0, 240)}` : head;
}
