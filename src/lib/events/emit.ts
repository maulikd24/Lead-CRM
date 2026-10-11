import { EmitInputSchema, classifyTiming, eventIdFor, type EmitInput, type EventDataClass } from "./envelope";
import { eventDef, type EventDef } from "./registry";

/**
 * emit(): validates, stamps and stores one CustomerEvent. Prisma-free (the store is injected; emit-db.ts wires the real one).
 *
 * Contract that cannot be bent:
 * - It NEVER throws into the caller. A domain write must not fail, or roll back, because an event could not be stored: every
 *   problem (invalid, unregistered, a store error) becomes a status and, where possible, an EventEmitFailure record.
 * - Idempotent by (source, dedupe key): the same fact emitted twice stores once and reports the same event id.
 * - Off by default: with the events flag off it does nothing and touches nothing.
 * - Late events are stored (flagged), never dropped; an event that needs consent but carries none is stored and counted.
 */

export type NewEventRow = {
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
  dataClass: EventDataClass;
  dedupeKey: string;
  late: boolean;
  clockSkew: boolean;
};

export type EmitFailureRow = {
  eventType: string;
  source: string;
  dedupeKey: string;
  clientId: string | null;
  reason: "INVALID" | "UNREGISTERED" | "DB_ERROR";
  detail: string | null;
  /** The envelope minus personal metadata (kept only for INTERNAL and PUBLIC_AGGREGATE classes so the emit can be retried). */
  envelope: { type: string; source: string; actor: unknown; occurredAt: string | null; correlationId?: string; causationId?: string | null; metadata?: unknown } | null;
};

export interface EventStore {
  insert(row: NewEventRow): Promise<"inserted" | "duplicate">;
  recordFailure(failure: EmitFailureRow): Promise<void>;
}

export type EmitDeps = {
  store: EventStore;
  enabled: () => boolean;
  now?: () => Date;
  lateHorizonMs?: number;
};

export type EmitResult =
  | { status: "stored"; eventId: string; late: boolean; missingConsent: boolean }
  | { status: "duplicate"; eventId: string }
  | { status: "disabled" }
  | { status: "rejected"; reason: "INVALID" | "UNREGISTERED" }
  | { status: "failed" };

const MESSAGE_MAX = 300;
/** Same idea as the job recorder's scrub: no URL, address, long number or key-like string ever reaches a stored error. */
function scrub(raw: string): string {
  const out = raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[redacted]")
    .replace(/\d{10,}/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_-]{32,}/g, "[redacted]");
  return out.length > MESSAGE_MAX ? out.slice(0, MESSAGE_MAX - 1) + "…" : out;
}

const personal = (c: EventDataClass | undefined) => c === "PERSONAL" || c === "SENSITIVE_PERSONAL" || c === undefined;

function envelopeFor(input: EmitInput, def: EventDef | undefined): EmitFailureRow["envelope"] {
  return {
    type: input.type,
    source: input.source,
    actor: input.actor,
    occurredAt: input.occurredAt ? input.occurredAt.toISOString() : null,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    ...(personal(def?.dataClass) ? {} : { metadata: input.metadata }),
  };
}

async function fail(deps: EmitDeps, row: EmitFailureRow): Promise<void> {
  try {
    await deps.store.recordFailure(row);
  } catch {
    // The failure table is down too. The caller must still be unaffected.
  }
}

export async function emitWith(deps: EmitDeps, raw: EmitInput): Promise<EmitResult> {
  if (!deps.enabled()) return { status: "disabled" };
  const typeOf = typeof raw?.type === "string" ? raw.type : "unknown";
  const sourceOf = typeof raw?.source === "string" ? raw.source : "unknown";
  const keyOf = typeof raw?.dedupeKey === "string" ? raw.dedupeKey : "";
  const clientOf = typeof raw?.clientId === "string" ? raw.clientId : null;
  const def = eventDef(typeOf);
  const record = (reason: EmitFailureRow["reason"], detail: string | null) =>
    fail(deps, { eventType: typeOf, source: sourceOf, dedupeKey: keyOf, clientId: clientOf, reason, detail: detail ? scrub(detail) : null, envelope: raw && typeof raw === "object" ? envelopeFor(raw, def) : null });

  try {
    if (!def) {
      await record("UNREGISTERED", `Event type "${typeOf}" is not in the registry`);
      return { status: "rejected", reason: "UNREGISTERED" };
    }
    const parsed = EmitInputSchema.safeParse(raw);
    if (!parsed.success) {
      await record("INVALID", `Envelope: ${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
      return { status: "rejected", reason: "INVALID" };
    }
    const input = parsed.data;
    if (def.customerRequired && !input.clientId) {
      await record("INVALID", "This event type needs a customer id");
      return { status: "rejected", reason: "INVALID" };
    }
    const meta = def.schemas[def.currentVersion].safeParse(input.metadata ?? {});
    if (!meta.success) {
      await record("INVALID", `Metadata: ${meta.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
      return { status: "rejected", reason: "INVALID" };
    }

    const receivedAt = (deps.now ?? (() => new Date()))();
    const occurredAt = input.occurredAt ?? receivedAt;
    const { late, clockSkew } = classifyTiming(occurredAt, receivedAt, deps.lateHorizonMs);
    const eventId = eventIdFor(input.source, input.dedupeKey);
    const missingConsent = def.consentRequired && !input.consentContext;
    const row: NewEventRow = {
      eventId,
      eventType: input.type,
      occurredAt,
      receivedAt,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      clientId: input.clientId ?? null,
      source: input.source,
      // A flow root correlates to itself; a producer that is part of a flow passes the flow's correlation id.
      correlationId: input.correlationId ?? eventId,
      causationId: input.causationId ?? null,
      schemaVersion: def.currentVersion,
      consentContext: input.consentContext ?? null,
      metadata: meta.data,
      dataClass: def.dataClass,
      dedupeKey: input.dedupeKey,
      late,
      clockSkew,
    };
    try {
      const result = await deps.store.insert(row);
      return result === "duplicate" ? { status: "duplicate", eventId } : { status: "stored", eventId, late, missingConsent };
    } catch (error) {
      await record("DB_ERROR", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
      return { status: "failed" };
    }
  } catch (error) {
    // Anything unexpected (a bug in a schema, a poisoned input). Still never the caller's problem.
    await record("INVALID", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
    return { status: "failed" };
  }
}

// ---- reading (schema versioning) ------------------------------------------------------------------------------------------------------

export type ReadResult = { ok: true; version: number; data: Record<string, unknown> } | { ok: false; reason: "unregistered" | "unknown_version" | "invalid" };

/**
 * Reads the metadata of a stored event at the version it was written with. Readers handle the current version and the previous one
 * (through the registry's upcaster). Metadata nulled by erasure reads as an empty payload, not as an error.
 */
export function readEvent(row: { eventType: string; schemaVersion: number; metadata: unknown }, lookup: (type: string) => EventDef | undefined = eventDef): ReadResult {
  const def = lookup(row.eventType);
  if (!def) return { ok: false, reason: "unregistered" };
  const schema = def.schemas[row.schemaVersion];
  if (!schema) return { ok: false, reason: "unknown_version" };
  if (row.metadata === null || row.metadata === undefined) return { ok: true, version: row.schemaVersion, data: {} };
  const parsed = schema.safeParse(row.metadata);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const upcast = def.upcast?.[row.schemaVersion];
  return { ok: true, version: row.schemaVersion, data: upcast ? upcast(parsed.data) : parsed.data };
}
