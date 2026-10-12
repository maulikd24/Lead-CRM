import { createHash } from "node:crypto";
import {
  CONSENT_SOURCES, CONSENT_STATUSES, isConsentChannel, isLedgerPurpose,
  type ConsentSource, type ConsentStatus,
} from "./policy";

/** What a row looks like once stored. Matches the Prisma ConsentRecord model. */
export type StoredConsent = {
  id: string;
  clientId: string;
  purpose: string;
  channel: string | null;
  status: ConsentStatus;
  source: ConsentSource;
  noticeVersion: string | null;
  noticeTextHash: string | null;
  capturedAt: Date;
  capturedById: string | null;
  evidenceRef: string | null;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type AppendInput = Omit<StoredConsent, "id" | "createdAt">;

/**
 * The whole write surface of the ledger is `append`. There is deliberately no update or delete: a withdrawal is a new row
 * and the current state is derived (decision.ts). The database also rejects UPDATE on the table.
 */
export interface ConsentStore {
  append(row: AppendInput): Promise<StoredConsent>;
  listForClient(clientId: string): Promise<StoredConsent[]>;
  listForClients(clientIds: string[]): Promise<StoredConsent[]>;
}

export type ConsentInput = {
  clientId: string;
  purpose: string;
  channel?: string | null;
  status: string;
  source: string;
  noticeVersion?: string | null;
  /** The notice text shown to the customer. Only its SHA-256 hash is stored. */
  noticeText?: string | null;
  capturedAt?: Date;
  capturedById?: string | null;
  evidenceRef?: string | null;
  /** Why this row was written. Required when a person records it by hand. */
  reason?: string | null;
  expiresAt?: Date | null;
};

export class ConsentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsentInputError";
  }
}

export const hashNotice = (text: string) => createHash("sha256").update(text.normalize("NFC").trim()).digest("hex");

const MAX_REASON = 500;
const MAX_EVIDENCE = 200;
const MAX_VERSION = 60;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const clip = (v: string | null | undefined, max: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/** Validates and appends one row. Throws ConsentInputError on bad input; nothing is written in that case. */
export async function recordConsent(store: ConsentStore, input: ConsentInput, now: Date): Promise<StoredConsent> {
  if (!input.clientId) throw new ConsentInputError("A customer is required");
  if (!isLedgerPurpose(input.purpose)) throw new ConsentInputError("Unknown purpose");
  if (!(CONSENT_STATUSES as readonly string[]).includes(input.status)) throw new ConsentInputError("Unknown status");
  if (!(CONSENT_SOURCES as readonly string[]).includes(input.source)) throw new ConsentInputError("Unknown source");
  const channel = input.channel ?? null;
  if (channel !== null && !isConsentChannel(channel)) throw new ConsentInputError("Unknown channel");

  const reason = clip(input.reason, MAX_REASON);
  if (input.source === "RM_RECORDED" && (reason?.length ?? 0) < 3) throw new ConsentInputError("A reason is required");

  const capturedAt = input.capturedAt ?? now;
  if (Number.isNaN(capturedAt.getTime())) throw new ConsentInputError("Invalid date");
  if (capturedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) throw new ConsentInputError("The capture time cannot be in the future");

  const expiresAt = input.status === "WITHDRAWN" ? null : (input.expiresAt ?? null);
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new ConsentInputError("Invalid expiry");

  return store.append({
    clientId: input.clientId,
    purpose: input.purpose,
    channel,
    status: input.status as ConsentStatus,
    source: input.source as ConsentSource,
    noticeVersion: clip(input.noticeVersion, MAX_VERSION),
    noticeTextHash: input.noticeText ? hashNotice(input.noticeText) : null,
    capturedAt,
    capturedById: input.capturedById ?? null,
    evidenceRef: clip(input.evidenceRef, MAX_EVIDENCE),
    reason,
    expiresAt,
  });
}
