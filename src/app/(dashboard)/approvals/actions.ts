"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import type { FailureCode } from "@/lib/policy/approvals/canonical/contract";
import { approvalsInboxEnabled } from "@/lib/policy/approvals/canonical/flag";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";

export type InboxResult = { ok: true; state: string; message: string } | { ok: false; code: FailureCode; error: string; reasons?: string[] };

const fail = (code: FailureCode, error: string): InboxResult => ({ ok: false, code, error });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Only these inputs reach the service, and only with these shapes: the browser cannot name an actor, a role or free-form parameters. */
function cleanParams(raw: unknown): Record<string, unknown> {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  if (typeof p.confirmed === "boolean") out.confirmed = p.confirmed;
  if (typeof p.acknowledged === "boolean") out.acknowledged = p.acknowledged;
  if (typeof p.survivorId === "string" && p.survivorId.length <= 64) out.survivorId = p.survivorId;
  if (typeof p.holdOverrideReason === "string") out.holdOverrideReason = text(p.holdOverrideReason, 500);
  return out;
}

/**
 * Approve or reject one item from the Approvals inbox. The registry decides whether this person may use the inbox at all; the canonical
 * service decides everything else (kind, four-eyes, reason, evidence, consent, expiry) and then calls the legacy path unchanged.
 */
export async function decideInboxAction(ref: unknown, decision: unknown, input: { reason?: unknown; params?: unknown }): Promise<InboxResult> {
  const session = await requireAccess("approvals", "manage");
  if (!approvalsInboxEnabled()) return fail("FORBIDDEN", "The approvals inbox is not switched on.");
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200 || (decision !== "approve" && decision !== "reject")) return fail("INVALID", "That request could not be read. Reload the page and try again.");
  try {
    const res = await approvalService().decide({ id: session.user.id, role: session.user.role, name: session.user.name ?? null }, ref, decision, { reason: text(input?.reason, 500), params: cleanParams(input?.params) });
    if (!res.ok) return res;
    for (const path of ["/approvals", "/agents", "/referrals", "/marketing", "/clients/duplicates", "/settings/approval-workflows", "/finance-console", "/settings/partner-finance", "/earnings", "/settings/ai-pilot"]) revalidatePath(path);
    return { ok: true, state: res.state, message: decision === "reject" ? "Rejected." : res.state === "executed" ? "Approved and done." : "Approved." };
  } catch (error) {
    console.error("approvals inbox: decision failed", error instanceof Error ? error.name : "unknown");
    return fail("ERROR", "That could not be completed. Nothing was changed, or the screen will show where it stopped.");
  }
}
