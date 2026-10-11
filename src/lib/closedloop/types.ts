import type { ConsentRow } from "@/lib/consent/decision";

import type { EventType } from "./events";
import type { DestinationSettings } from "./gate";
import type { MatchData } from "./hashing";

export type DestinationKey = "meta_capi" | "google_ads" | "fake";
export const DESTINATION_KEYS: DestinationKey[] = ["meta_capi", "google_ads", "fake"];
export const DESTINATION_LABEL: Record<DestinationKey, string> = { meta_capi: "Meta Conversions API", google_ads: "Google Ads offline conversions", fake: "Demo destination (no network)" };

export type OutboxStatus = "PENDING" | "SENDING" | "FAILED" | "SENT" | "DEAD" | "SKIPPED";

export type SkipReason = "TOO_OLD" | import("./gate").BlockReason;

export type OutboxRow = {
  id: string;
  clientId: string;
  destination: DestinationKey;
  eventType: EventType;
  qualifier: string;
  dedupId: string;
  occurredAt: Date;
  status: OutboxStatus;
  reason: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  matched: boolean | null;
  identity: MatchData;
  value: number | null;
  createdAt: Date;
};

export type NewOutboxRow = Pick<OutboxRow, "clientId" | "destination" | "eventType" | "qualifier" | "dedupId" | "occurredAt" | "identity" | "value"> & { status?: "PENDING" | "SKIPPED"; reason?: string | null };

/** All the engine needs from storage. Prisma-backed in production, in memory in tests. */
export interface OutboxStore {
  /** Inserts unless (destination, dedupId) exists. This is what makes producing idempotent. */
  insertIfAbsent(row: NewOutboxRow, now: Date): Promise<{ created: boolean }>;
  /** Rows ready to send: PENDING, FAILED whose time has come, and SENDING rows whose claim went stale. Oldest first. */
  due(now: Date, staleBefore: Date, limit: number): Promise<OutboxRow[]>;
  /** Atomically moves one due row to SENDING and counts the attempt. Null when someone else got it first. */
  claim(id: string, now: Date, staleBefore: Date): Promise<OutboxRow | null>;
  markSent(id: string, now: Date, matched: boolean | null): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  /** Puts a DEAD or FAILED row back to PENDING for an Admin retry. */
  requeue(id: string, now: Date): Promise<boolean>;
  /** Withdrawal: skips every not-yet-sent row of a customer. Returns how many. */
  cancelUnsentForClient(clientId: string, reason: string): Promise<number>;
}

/** What a destination is told about one event. It never carries the customer id, a name, PAN, raw phone or raw email. */
export type OutboundEvent = {
  dedupId: string;
  eventType: EventType;
  qualifier: string;
  occurredAt: Date;
  identity: MatchData;
  value: number | null;
};

export type EventResult = {
  dedupId: string;
  outcome: "sent" | "retry" | "rejected";
  /** Only when the platform reports it. */
  matched?: boolean;
  /** A short code, never a response body. */
  errorCode?: string;
  retryAfterMs?: number;
};

/** The provider interface. Adapters are written against the platform's documented request shape and tested with an injected fetch. */
export interface ConversionDestination {
  key: DestinationKey;
  /** Which identifier rules to prepare for. */
  platform: "meta" | "google";
  maxBatch: number;
  /** The platform ignores older events; they are skipped rather than sent. */
  maxEventAgeDays: number;
  send(events: OutboundEvent[]): Promise<EventResult[]>;
}

export type DestinationContext = { destination: ConversionDestination; settings: DestinationSettings };

export type ConsentLoader = (clientIds: string[]) => Promise<Map<string, ConsentRow[]>>;
