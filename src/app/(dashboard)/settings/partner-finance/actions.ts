"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { generateOverrideAccruals, type GenerateResult } from "@/lib/partners/overrides/generate";
import { proposeOverrideRuleChange, type OverrideStoreDb } from "@/lib/partners/overrides/store";
import type { RuleChange } from "@/lib/partners/rule-plan";
import { saveWorkspaceSetting, type SettingsDb } from "@/lib/partners/settings";
import { proposeTaxRuleChange, type TaxStoreDb } from "@/lib/partners/tax/store";
import { ApprovalBlockedError, decideApproval, requestApproval } from "@/lib/policy/approvals/service";

/**
 * Settings for the partner programme's money: tax rules, override rules, statement letterhead, the referral link and the
 * query assignee. Admin and Finance only, behind the Partner workspace flag. A rule change is a proposal that a different
 * person approves; nothing here edits a rule in place.
 */
async function gate() {
  if (!isPartnerWorkspaceEnabled()) notFound();
  return requireRole(["ADMIN", "FINANCE"]);
}

const OPS = ["create", "replace", "retire"];

/** The shape only: the planner validates every value and refuses what is wrong. */
function asChange(c: unknown): RuleChange | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.op !== "string" || !OPS.includes(o.op)) return null;
  if (o.op === "create") return typeof o.rule === "object" && o.rule !== null ? { op: "create", rule: o.rule as Record<string, unknown> } : null;
  if (typeof o.ruleId !== "string" || o.ruleId.length > 64) return null;
  if (o.op === "replace") return typeof o.rule === "object" && o.rule !== null ? { op: "replace", ruleId: o.ruleId, rule: o.rule as Record<string, unknown> } : null;
  return typeof o.effectiveTo === "string" ? { op: "retire", ruleId: o.ruleId, effectiveTo: o.effectiveTo } : null;
}

export type ProposeActionResult = { ok: true; requestId: string; summary: string } | { ok: false; errors: string[] };

export async function proposeTaxRuleAction(change: unknown): Promise<ProposeActionResult> {
  const session = await gate();
  const c = asChange(change);
  if (!c) return { ok: false, errors: ["That change could not be read."] };
  const r = await proposeTaxRuleChange({ db: prisma as unknown as TaxStoreDb, request: requestApproval }, { id: session.user.id, role: session.user.role }, c, new Date());
  revalidatePath("/settings/partner-finance");
  return r;
}

export async function proposeOverrideRuleAction(change: unknown): Promise<ProposeActionResult> {
  const session = await gate();
  const c = asChange(change);
  if (!c) return { ok: false, errors: ["That change could not be read."] };
  const r = await proposeOverrideRuleChange({ db: prisma as unknown as OverrideStoreDb, request: requestApproval }, { id: session.user.id, role: session.user.role }, c, new Date());
  revalidatePath("/settings/partner-finance");
  return r;
}

const RULE_ACTIONS = ["PARTNER_TAX_RULE_CHANGE", "PARTNER_OVERRIDE_RULE_CHANGE"];

/** Approve or reject a pending tax or override rule change. Only those two kinds: this is not a way into any other approval. The approval service refuses the person who proposed it. */
export async function decideRuleChangeAction(requestId: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await gate();
  if (typeof requestId !== "string" || requestId.length > 64 || (decision !== "APPROVED" && decision !== "REJECTED")) return { ok: false, error: "That decision could not be read." };
  const req = await prisma.approvalRequest.findUnique({ where: { id: requestId }, select: { actionType: true } });
  if (!req || !RULE_ACTIONS.includes(req.actionType)) return { ok: false, error: "That request was not found." };
  try {
    await decideApproval(requestId, decision, typeof note === "string" ? note.slice(0, 500) : undefined, { id: session.user.id, role: session.user.role });
  } catch (e) {
    if (e instanceof ApprovalBlockedError) return { ok: false, error: [e.message, ...e.reasons].join(" ") };
    return { ok: false, error: e instanceof Error ? e.message : "That could not be decided." };
  }
  revalidatePath("/settings/partner-finance");
  return { ok: true };
}

export async function saveSettingAction(key: string, input: Record<string, unknown>): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const session = await gate();
  if (typeof key !== "string" || !input || typeof input !== "object") return { ok: false, errors: ["That setting could not be read."] };
  const r = await saveWorkspaceSetting(prisma as unknown as SettingsDb, { id: session.user.id }, key, input);
  revalidatePath("/settings/partner-finance");
  return r;
}

/** Writes override accruals from the approved override rules now (it also runs after every accrual recompute). Idempotent. */
export async function generateOverridesAction(): Promise<GenerateResult> {
  const session = await gate();
  const r = await generateOverrideAccruals(prisma as never);
  await prisma.auditLog.create({ data: { userId: session.user.id, entity: "CommissionAccrual", entityId: "override-run", action: "partner_override_accruals_generated", newValue: { ...r } } });
  revalidatePath("/settings/partner-finance");
  revalidatePath("/partners");
  return r;
}
