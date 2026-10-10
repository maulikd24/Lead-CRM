"use server";

import { revalidatePath } from "next/cache";

import type { Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/require-role";
import { checkConsent } from "@/lib/consent/enforce";
import { enrollReferrer, issueCode, revokeCode, saveRule, saveSetting, setReferrerStatus, setRuleActive, SETTING_KEYS, type SettingKey } from "@/lib/referrals/admin";
import { referralEnabled } from "@/lib/referrals/flag";
import { buildInviteDraft } from "@/lib/referrals/invite";
import { runReferralJob } from "@/lib/referrals/job";
import { approveStatement, clearReview, markStatementPaid, prepareStatement, reverseEntry } from "@/lib/referrals/statements";
import { can, type ReferralAction } from "@/lib/referrals/permissions";
import { prismaAdminStore } from "@/lib/referrals/prisma-admin";
import { prismaReferralStore } from "@/lib/referrals/prisma-store";

/**
 * Server actions for the referral programme. Every one: signed in as Admin or Finance (anyone else is redirected), the flag
 * is on, and the specific permission holds, checked again here on the server. Nothing here sends a message or moves money:
 * "paid" is a marker with a bank reference, and an invitation is only ever returned as text.
 */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const OFF = { ok: false as const, error: "The referral programme is switched off on this server." };
const DENIED = { ok: false as const, error: "You do not have permission to do that." };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

async function gate(action: ReferralAction) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (!referralEnabled()) return { error: OFF } as const;
  if (!can(session.user.role as Role, action)) return { error: DENIED } as const;
  return { actor: { id: session.user.id, role: session.user.role as string } } as const;
}

const done = <T extends { ok: boolean }>(r: T): T => {
  revalidatePath("/referrals");
  return r;
};

export async function enrollReferrerAction(clientCode: unknown): Promise<ActionResult<{ referrerId: string }>> {
  const g = await gate("manage_referrers");
  if ("error" in g) return g.error;
  return done(await enrollReferrer({ db: prismaAdminStore, actor: g.actor, clientCode: text(clientCode, 40) }));
}

export async function issueCodeAction(referrerId: unknown): Promise<ActionResult> {
  const g = await gate("manage_referrers");
  if ("error" in g) return g.error;
  return done(await issueCode({ db: prismaAdminStore, actor: g.actor, referrerId: text(referrerId, 64) }));
}

export async function revokeCodeAction(codeId: unknown, reason: unknown): Promise<ActionResult> {
  const g = await gate("manage_referrers");
  if ("error" in g) return g.error;
  return done(await revokeCode({ db: prismaAdminStore, actor: g.actor, codeId: text(codeId, 64), reason: text(reason, 200) }));
}

export async function setReferrerStatusAction(referrerId: unknown, status: unknown): Promise<ActionResult> {
  const g = await gate("manage_referrers");
  if ("error" in g) return g.error;
  return done(await setReferrerStatus({ db: prismaAdminStore, actor: g.actor, referrerId: text(referrerId, 64), status: status === "SUSPENDED" ? "SUSPENDED" : status === "ACTIVE" ? "ACTIVE" : ("" as never) }));
}

export async function saveRuleAction(input: Record<string, unknown>, ruleId?: unknown, activate?: unknown): Promise<ActionResult<{ ruleId: string }>> {
  const g = await gate("manage_rules");
  if ("error" in g) return g.error;
  const f = (k: string) => text(input?.[k], 40);
  return done(
    await saveRule({
      db: prismaAdminStore,
      actor: g.actor,
      input: { name: text(input?.name, 100), event: f("event"), kind: f("kind"), amountRupees: f("amountRupees"), maxRewardRupees: f("maxRewardRupees"), capPerMonthRupees: f("capPerMonthRupees"), validFrom: f("validFrom"), validTo: f("validTo") },
      ruleId: typeof ruleId === "string" && ruleId ? ruleId : undefined,
      activate: typeof activate === "boolean" ? activate : undefined,
      now: new Date(),
    }),
  );
}

export async function setRuleActiveAction(ruleId: unknown, active: unknown): Promise<ActionResult> {
  const g = await gate("manage_rules");
  if ("error" in g) return g.error;
  return done(await setRuleActive({ db: prismaAdminStore, actor: g.actor, ruleId: text(ruleId, 64), active: active === true, now: new Date() }));
}

export async function saveSettingAction(key: unknown, value: unknown): Promise<ActionResult> {
  const g = await gate("manage_settings");
  if ("error" in g) return g.error;
  if (!(SETTING_KEYS as readonly string[]).includes(text(key, 40))) return { ok: false, error: "Unknown setting." };
  return done(await saveSetting({ db: prismaAdminStore, actor: g.actor, key: key as SettingKey, value: text(value, 1000) }));
}

export async function refreshAction(): Promise<ActionResult<{ message: string }>> {
  const g = await gate("refresh");
  if ("error" in g) return g.error;
  const r = await runReferralJob();
  revalidatePath("/referrals");
  if ("skipped" in r) return { ok: false, error: "The referral programme is switched off." };
  return { ok: true, message: `Checked ${r.referralsChecked} referrals: ${r.eventsRecorded} new events, ${r.entriesAccrued} rewards accrued, ${r.needingReview} waiting for review.` };
}

export async function prepareStatementAction(referrerId: unknown, period: unknown): Promise<ActionResult<{ statementId: string }>> {
  const g = await gate("prepare_statement");
  if ("error" in g) return g.error;
  return done(await prepareStatement({ store: prismaReferralStore, actor: g.actor, referrerId: text(referrerId, 64), period: text(period, 7) }));
}

export async function approveStatementAction(statementId: unknown): Promise<ActionResult> {
  const g = await gate("approve_statement");
  if ("error" in g) return g.error;
  return done(await approveStatement({ store: prismaReferralStore, actor: g.actor, statementId: text(statementId, 64) }));
}

export async function markPaidAction(statementId: unknown, bankReference: unknown): Promise<ActionResult> {
  const g = await gate("mark_paid");
  if ("error" in g) return g.error;
  return done(await markStatementPaid({ store: prismaReferralStore, actor: g.actor, statementId: text(statementId, 64), bankReference: text(bankReference, 60) }));
}

export async function reverseEntryAction(referrerId: unknown, entryId: unknown, reason: unknown): Promise<ActionResult> {
  const g = await gate("reverse_entry");
  if ("error" in g) return g.error;
  return done(await reverseEntry({ store: prismaReferralStore, actor: g.actor, referrerId: text(referrerId, 64), entryId: text(entryId, 64), reason: text(reason, 300) }));
}

export async function clearReviewAction(referrerId: unknown, entryId: unknown, note: unknown): Promise<ActionResult> {
  const g = await gate("clear_review");
  if ("error" in g) return g.error;
  return done(await clearReview({ store: prismaReferralStore, actor: g.actor, referrerId: text(referrerId, 64), entryId: text(entryId, 64), note: text(note, 300) }));
}

/** Returns an invitation text for a person to review and send themselves. Never sends. */
export async function draftInviteAction(referrerId: unknown): Promise<ActionResult<{ text: string; code: string; consentEnforced: boolean }>> {
  const g = await gate("manage_referrers");
  if ("error" in g) return g.error;
  const { prisma } = await import("@/lib/db/prisma");
  const id = text(referrerId, 64);
  return buildInviteDraft({
    referrerId: id,
    deps: {
      loadReferrer: async (rid) => {
        const r = await prisma.referrer.findUnique({ where: { id: rid }, select: { status: true, client: { select: { id: true, name: true } }, codes: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } } } });
        return r ? { clientId: r.client.id, firstName: r.client.name.trim().split(/\s+/)[0] ?? "", activeCode: r.codes[0]?.code ?? null, status: r.status as "ACTIVE" | "SUSPENDED" } : null;
      },
      getSetting: (k) => prismaReferralStore.getSetting(k),
      linkBase: process.env.REFERRAL_LINK_BASE,
      consent: async (clientId) => {
        const d = await checkConsent(clientId, "MARKETING_COMMS", "whatsapp");
        return { allowed: d.allowed, enforced: d.reason !== "ENFORCEMENT_OFF", reason: d.reason };
      },
    },
  });
}
