import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The canonical CustomerEvent envelope (the event taxonomy). Prisma-free and framework-free: everything here is a pure
 * function or a schema, so it is unit-tested without a database.
 *
 * CustomerEvent is a FACT layer for integration and read models. It never replaces a domain table (Message, Task, ConsentRecord,
 * Position, SupportTicket, Activity ... stay authoritative); a fact says "this happened, here is the id of the domain row".
 */

/** Domains are closed. Adding one needs an ADR (the event taxonomy). */
export const EVENT_DOMAINS = ["lead", "customer", "account", "transaction", "portfolio", "whatsapp", "call", "ticket", "complaint", "campaign", "referral", "nba", "agent"] as const;
export type EventDomain = (typeof EVENT_DOMAINS)[number];

export const DATA_CLASSES = ["PUBLIC_AGGREGATE", "INTERNAL", "PERSONAL", "SENSITIVE_PERSONAL"] as const;
export type EventDataClass = (typeof DATA_CLASSES)[number];

export const ACTOR_TYPES = ["user", "system", "agent", "customer", "partner", "integration"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Verdict names that the decision-engine spec fixes and that are not past-tense verbs. */
const FIXED_VERDICTS = new Set(["not_now", "do_not_recommend"]);
const IRREGULAR_PAST = new Set(["sent", "lost", "read", "held", "paid", "set", "withdrawn", "available"]);
const SEGMENT = /^[a-z][a-z0-9_]*$/;

/**
 * `domain.entity.action`, lower snake case, 2 to 4 segments, closed domain, action in the past tense (a fact, never a command:
 * `nba.decision.created`, not `send.nudge`).
 */
export function isValidEventTypeName(name: string): boolean {
  const parts = name.split(".");
  if (parts.length < 2 || parts.length > 4) return false;
  if (!parts.every((p) => SEGMENT.test(p))) return false;
  if (!(EVENT_DOMAINS as readonly string[]).includes(parts[0])) return false;
  const action = parts[parts.length - 1];
  if (FIXED_VERDICTS.has(action)) return true;
  const first = action.split("_")[0];
  return IRREGULAR_PAST.has(first) || /ed$/.test(first);
}

export const ActorSchema = z.object({
  type: z.enum(ACTOR_TYPES),
  /** user id, agent key, partner id ... Never a name. Null for the system. */
  id: z.string().min(1).max(120).nullable().optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const ConsentContextSchema = z.object({
  purpose: z.string().min(1).max(60),
  status: z.string().min(1).max(30),
  ledgerId: z.string().max(64).nullable().optional(),
  noticeVersion: z.string().max(40).nullable().optional(),
});
export type ConsentContext = z.infer<typeof ConsentContextSchema>;

/** A pointer back to the authoritative domain row. The fact carries the id, not a copy of the data. */
export const RefSchema = z.object({ table: z.string().min(1).max(60), id: z.string().min(1).max(120) });
export type Ref = z.infer<typeof RefSchema>;

const uuid = z.string().uuid();

/** What a producer supplies. event_id, received_at, schema_version and the classification come from the registry and the clock. */
export const EmitInputSchema = z.object({
  type: z.string(),
  occurredAt: z.date().optional(),
  actor: ActorSchema,
  clientId: z.string().min(1).max(64).nullable().optional(),
  source: z.string().regex(/^[a-z][a-z0-9_.-]{1,40}$/),
  correlationId: uuid.optional(),
  causationId: uuid.nullable().optional(),
  consentContext: ConsentContextSchema.nullable().optional(),
  metadata: z.unknown().optional(),
  /** Stable, derived from the domain row (never random): the same fact emitted twice stores once. */
  dedupeKey: z.string().min(1).max(200),
});
export type EmitInput = z.input<typeof EmitInputSchema>;

/** One row of CustomerEvent as stored (and as the readers see it). */
export type StoredEvent = {
  id: string;
  seq: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  receivedAt: Date;
  actorType: string;
  actorId: string | null;
  clientId: string | null;
  source: string;
  correlationId: string;
  causationId: string | null;
  schemaVersion: number;
  consentContext: unknown;
  metadata: unknown;
  dataClass: string;
  dedupeKey: string;
  late: boolean;
  clockSkew: boolean;
};

/** A deterministic UUID (version 5 layout) from a string: the same input always gives the same id. */
export function uuidFrom(input: string): string {
  const h = createHash("sha256").update(input).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** `source:externalId:type`, the taxonomy's dedupe key. */
export const dedupeKeyOf = (source: string, externalId: string, type: string): string => `${source}:${externalId}:${type}`;

/**
 * The event id is derived from (source, dedupe key), so it is stable across retries and a cause can be referenced without a lookup:
 * `causationId: eventIdFor("crm.web", dedupeKeyOf("crm.web", leadId, "lead.created"))`.
 */
export const eventIdFor = (source: string, dedupeKey: string): string => uuidFrom(`event:${source}:${dedupeKey}`);

/** One correlation id for a whole customer flow (a lead from intake to funded): derived from the customer, so every producer agrees without coordination. */
export const flowCorrelationId = (clientId: string): string => uuidFrom(`flow:${clientId}`);

/** Events older than this at receipt are stored but flagged `late` and trigger nothing (the event taxonomy). */
export const DEFAULT_LATE_HORIZON_MS = 30 * 24 * 3_600_000;
/** A source clock this far ahead of ours is flagged as skew. */
export const CLOCK_SKEW_MS = 5 * 60_000;

export function classifyTiming(occurredAt: Date, receivedAt: Date, horizonMs = DEFAULT_LATE_HORIZON_MS): { late: boolean; clockSkew: boolean } {
  return { late: receivedAt.getTime() - occurredAt.getTime() > horizonMs, clockSkew: occurredAt.getTime() - receivedAt.getTime() > CLOCK_SKEW_MS };
}
