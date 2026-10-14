import type { ApprovalActionType } from "../registry";
import type { ApprovalKind } from "./contract";

/**
 * The canonical kinds whose record IS an ApprovalRequest row, and the generic registry key each one is stored under.
 * The generic service (../service.ts) stays the only code that decides and applies these.
 */
export const NATIVE_KINDS = {
  "payout-run": "PAYOUT_ADJUSTMENT",
  "commission-adjustment": "COMMISSION_ADJUSTMENT",
  "erasure-request": "ERASURE_REQUEST",
  "partner-tax-rule": "PARTNER_TAX_RULE_CHANGE",
  "partner-override-rule": "PARTNER_OVERRIDE_RULE_CHANGE",
  "stage-override": "STAGE_OVERRIDE",
  "client-mobile-change": "CLIENT_MOBILE_CHANGE",
  "closed-loop-destination": "CLOSED_LOOP_DESTINATION",
  "consent-policy-change": "CONSENT_POLICY_CHANGE",
} as const satisfies Partial<Record<ApprovalKind, ApprovalActionType>>;

export type NativeKind = keyof typeof NATIVE_KINDS;
export const nativeKindOf = (actionType: string): NativeKind | null => (Object.entries(NATIVE_KINDS).find(([, v]) => v === actionType)?.[0] as NativeKind | undefined) ?? null;
