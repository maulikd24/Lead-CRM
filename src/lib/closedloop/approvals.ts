import { decryptJson } from "@/lib/security/crypto";
import { ApprovalBlockedError } from "@/lib/policy/approvals/service";

import { buildDestination, demoDestinationAllowed, parseDestinationSettings } from "./config";
import type { DestinationSettings } from "./gate";
import { DESTINATION_KEYS, type DestinationKey } from "./types";

/**
 * The two decisions in this module that a second person signs off, through the canonical approval service (kinds `closed-loop-destination` and
 * `consent-policy-change`, stored as ApprovalRequest rows and decided in the Approvals inbox with the four-eyes rule):
 *  - switching a destination on, widening the regions it may use, or starting to send a value: data would start (or start to go further) to a third party;
 *  - the customer-facing wording and version of the ad measurement consent notice.
 * Everything that only makes the module do less (switching off, narrowing, dropping the value) is applied at once: a stop is never made to wait for a second person.
 * This file is Prisma-free: the database is passed in, so the rules are plain unit tests.
 */
export const DESTINATION_ENTITY = "ClosedLoopDestination";
export const CONSENT_ENTITY = "ClosedLoopConsentNotice";
export const CONSENT_POLICY_PROVIDER = "closedloop_consent_policy";

export type DestinationChange = { destination: DestinationKey; enabled: boolean; region: string; allowedRegions: string[]; sendValue: boolean };
export type ConsentNoticeChange = { purpose: "ADS_MEASUREMENT"; text: string; version: string };

export const MIN_NOTICE = 40;
export const MAX_NOTICE = 1000;

/** Anything in `next` that lets data go further than `current` already allows needs a second person. */
export function classifyDestinationChange(current: DestinationSettings, next: DestinationSettings): "needs_approval" | "direct" {
  if (next.enabled && !current.enabled) return "needs_approval";
  if (next.enabled) {
    const wider = next.allowedRegions.some((r) => !current.allowedRegions.includes(r)) || (next.region !== null && next.region !== current.region);
    if (wider) return "needs_approval";
    if (next.sendValue && !current.sendValue) return "needs_approval";
  }
  return "direct";
}

type Settings = Record<string, unknown>;
export type ApprovalDb = {
  integrationConfig: {
    findUnique: (a: { where: { provider: string } }) => Promise<{ credentials: unknown; settings: unknown } | null>;
    upsert: (a: { where: { provider: string }; update: Settings; create: Settings }) => Promise<unknown>;
  };
  auditLog: { create: (a: { data: { userId: string; entity: string; entityId: string; action: string; newValue: never } }) => Promise<unknown> };
};

const noFetch = async () => ({ status: 0, ok: false, json: async () => ({}) });
const providerOf = (key: DestinationKey) => `closedloop_${key}`;

const asChange = (v: unknown): DestinationChange | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || !DESTINATION_KEYS.includes(o.destination as DestinationKey)) return null;
  if (typeof o.enabled !== "boolean" || typeof o.region !== "string" || !Array.isArray(o.allowedRegions) || o.allowedRegions.some((r) => typeof r !== "string") || typeof o.sendValue !== "boolean") return null;
  return { destination: o.destination as DestinationKey, enabled: o.enabled, region: o.region, allowedRegions: o.allowedRegions as string[], sendValue: o.sendValue };
};

/** Before an approval is recorded: the change is well formed and the destination is really set up. Leaves the request pending otherwise. */
export async function checkDestinationChange(payload: unknown, db: ApprovalDb, env: Record<string, string | undefined> = process.env): Promise<void> {
  const change = asChange(payload);
  if (!change) throw new ApprovalBlockedError("The request is malformed", ["This request is malformed and cannot be applied."]);
  if (change.enabled) {
    const row = await db.integrationConfig.findUnique({ where: { provider: providerOf(change.destination) } });
    const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
    if (!buildDestination(change.destination, credentials, noFetch, { demo: demoDestinationAllowed(env) })) {
      throw new ApprovalBlockedError("The destination is not set up", ["The destination has no complete credentials saved (or is the demo destination while demo mode is off). Save them, then approve."]);
    }
  }
}

/** Applies an approved change: the settings only (credentials are never touched), idempotent, audited with the approver. */
export async function applyDestinationChange(payload: unknown, ctx: { approvalRequestId: string; decidedById: string }, db: ApprovalDb): Promise<void> {
  const change = asChange(payload);
  if (!change) throw new Error("Malformed destination change");
  const settings = parseDestinationSettings({ enabled: change.enabled, region: change.region, allowedRegions: change.allowedRegions, sendValue: change.sendValue });
  const provider = providerOf(change.destination);
  const mode = change.destination === "fake" ? "mock" : "live"; // the control plane reads "live" + enabled + credentials as connected
  await db.integrationConfig.upsert({ where: { provider }, update: { settings, isEnabled: settings.enabled, mode }, create: { provider, settings, isEnabled: settings.enabled, mode } });
  await db.auditLog.create({ data: { userId: ctx.decidedById, entity: "ClosedLoop", entityId: change.destination, action: "destination_change_approved", newValue: { ...settings, approvalRequestId: ctx.approvalRequestId } as never } });
}

const asNotice = (v: unknown): ConsentNoticeChange | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || o.purpose !== "ADS_MEASUREMENT" || typeof o.text !== "string" || typeof o.version !== "string") return null;
  return { purpose: "ADS_MEASUREMENT", text: o.text.trim(), version: o.version.trim() };
};

export async function checkConsentNotice(payload: unknown): Promise<void> {
  const n = asNotice(payload);
  if (!n) throw new ApprovalBlockedError("The request is malformed", ["Only the ad measurement notice can be changed here."]);
  if (n.text.length < MIN_NOTICE || n.text.length > MAX_NOTICE) throw new ApprovalBlockedError("The wording length is out of range", [`The wording must be between ${MIN_NOTICE} and ${MAX_NOTICE} characters.`]);
  if (!n.version || n.version.length > 60) throw new ApprovalBlockedError("A version is required", ["Give the wording a version label (at most 60 characters) so consent records can name it."]);
}

/** Stores the approved wording. New consent records quote it and its version from now on; consent already on file keeps the version it was given under. */
export async function applyConsentNotice(payload: unknown, ctx: { approvalRequestId: string; decidedById: string }, db: ApprovalDb): Promise<void> {
  const n = asNotice(payload);
  if (!n) throw new Error("Malformed consent notice change");
  const settings = { adsNoticeText: n.text, adsNoticeVersion: n.version, approvalRequestId: ctx.approvalRequestId, approvedById: ctx.decidedById };
  await db.integrationConfig.upsert({ where: { provider: CONSENT_POLICY_PROVIDER }, update: { settings }, create: { provider: CONSENT_POLICY_PROVIDER, settings } });
  await db.auditLog.create({ data: { userId: ctx.decidedById, entity: "ClosedLoop", entityId: CONSENT_POLICY_PROVIDER, action: "consent_notice_approved", newValue: { version: n.version, approvalRequestId: ctx.approvalRequestId } as never } });
}
