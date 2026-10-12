import { prisma } from "@/lib/db/prisma";

import { signoffState, type SignoffState } from "./disclosure";
import { CLAWBACK_FLAG_LABEL, DEFAULT_VELOCITY_LIMIT, FLAG_LABEL, type FraudFlag } from "./fraud";
import { accrualStates, clawbackStates, statementCandidates, type AccrualState, type LedgerEntry, type LedgerKind } from "./ledger";
import { assembleLedger, type LedgerRow, type RawEntry } from "./ledger-view";
import { monthKeyIST } from "./rewards";
import type { ReferralEventType } from "./state-machine";
import { summarizeLedger, weeklyBuckets, type LedgerSummary } from "./summary";

/** Read models for the /referrals screens. Plain data only; no personal data beyond a referrer's name and customer code (a referred person is shown by customer code only). */

const toEntry = (e: { id: string; kind: string; referrerId: string; amountPaise: number; refEntryId: string | null; flags: string[]; periodMonth: string; referralId?: string | null; eventType?: string | null; ruleId?: string | null; clawbackUntil?: Date | null }): LedgerEntry => ({ id: e.id, kind: e.kind as LedgerKind, referrerId: e.referrerId, amountPaise: e.amountPaise, refEntryId: e.refEntryId, flags: e.flags, periodMonth: e.periodMonth, referralId: e.referralId ?? null, eventType: e.eventType ?? null, ruleId: e.ruleId ?? null, clawbackUntil: e.clawbackUntil ?? null });

export type OverviewData = {
  referrers: number;
  funnel: { referrals: number; kyc: number; funded: number };
  rejected: { total: number; byReason: { reason: string; count: number }[] };
  ledger: LedgerSummary;
  weekly: number[];
  needsReview: number;
};

export async function loadOverview(now: Date): Promise<OverviewData> {
  const [referrers, referrals, kyc, funded, rejected, entries, recent] = await Promise.all([
    prisma.referrer.count(),
    prisma.referral.count({ where: { outcome: "ATTRIBUTED" } }),
    prisma.referralEvent.count({ where: { type: "KYC_COMPLETE" } }),
    prisma.referralEvent.count({ where: { type: "FIRST_FUNDING" } }),
    prisma.referral.groupBy({ by: ["reason"], where: { outcome: "REJECTED" }, _count: { _all: true } }),
    prisma.rewardLedgerEntry.findMany({ orderBy: { createdAt: "asc" }, take: 20000 }),
    prisma.referral.findMany({ where: { outcome: "ATTRIBUTED", attributedAt: { gte: new Date(now.getTime() - 8 * 7 * 86_400_000) } }, select: { attributedAt: true } }),
  ]);
  const ledger = summarizeLedger(entries.map(toEntry));
  return {
    referrers,
    funnel: { referrals, kyc, funded },
    rejected: { total: rejected.reduce((s, r) => s + r._count._all, 0), byReason: rejected.map((r) => ({ reason: r.reason ?? "UNKNOWN", count: r._count._all })).sort((a, b) => b.count - a.count) },
    ledger,
    weekly: weeklyBuckets(recent.map((r) => r.attributedAt), now, 8),
    needsReview: ledger.needsReview.count + ledger.clawbackReview.count,
  };
}

export type ReferrerRow = {
  id: string;
  clientCode: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  codes: { id: string; code: string; status: "ACTIVE" | "REVOKED"; revokeReason: string | null }[];
  referrals: number;
  kyc: number;
  funded: number;
  earnedPaise: number;
  toReview: number;
};

export async function loadReferrers(): Promise<ReferrerRow[]> {
  const rows = await prisma.referrer.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { client: { select: { clientCode: true, name: true } }, codes: { orderBy: { createdAt: "desc" }, select: { id: true, code: true, status: true, revokeReason: true } } } });
  const ids = rows.map((r) => r.id);
  const [referrals, entries] = await Promise.all([
    prisma.referral.findMany({ where: { referrerId: { in: ids }, outcome: "ATTRIBUTED" }, select: { referrerId: true, events: { select: { type: true } } } }),
    prisma.rewardLedgerEntry.findMany({ where: { referrerId: { in: ids } } }),
  ]);
  const mapped = entries.map(toEntry);
  const states = accrualStates(mapped);
  const claw = clawbackStates(mapped);
  return rows.map((r) => {
    const mine = referrals.filter((x) => x.referrerId === r.id);
    const has = (t: ReferralEventType) => mine.filter((x) => x.events.some((e) => e.type === t)).length;
    const earned = entries.filter((e) => e.referrerId === r.id && e.kind === "ACCRUED" && states.get(e.id) !== "REVERSED" && states.get(e.id) !== "CLAWED_BACK").reduce((s, e) => s + e.amountPaise, 0);
    const toReview = entries.filter((e) => e.referrerId === r.id && ((e.kind === "ACCRUED" && states.get(e.id) === "NEEDS_REVIEW") || (e.kind === "CLAWBACK" && claw.get(e.id) === "NEEDS_REVIEW"))).length;
    return { toReview, id: r.id, clientCode: r.client.clientCode, name: r.client.name, status: r.status as "ACTIVE" | "SUSPENDED", codes: r.codes.map((c) => ({ ...c, status: c.status as "ACTIVE" | "REVOKED" })), referrals: mine.length, kyc: has("KYC_COMPLETE"), funded: has("FIRST_FUNDING"), earnedPaise: earned };
  });
}

export type { LedgerRow };

const ALL_FLAG_LABELS: Record<string, string> = { ...FLAG_LABEL, ...CLAWBACK_FLAG_LABEL };
export const FLAG_TEXT = (f: string) => ALL_FLAG_LABELS[f as FraudFlag] ?? f;

const MAX_ROWS = 400;

export async function loadLedger(): Promise<{ rows: LedgerRow[]; total: number }> {
  const entries: RawEntry[] = (await prisma.rewardLedgerEntry.findMany({ orderBy: { createdAt: "asc" }, take: 20000 })).map((e) => ({ id: e.id, kind: e.kind as LedgerKind, referrerId: e.referrerId, referralId: e.referralId, eventType: e.eventType, ruleId: e.ruleId, refEntryId: e.refEntryId, amountPaise: e.amountPaise, periodMonth: e.periodMonth, flags: e.flags, note: e.note, actorId: e.actorId, clawbackUntil: e.clawbackUntil, createdAt: e.createdAt }));
  const referrerIds = [...new Set(entries.map((a) => a.referrerId))];
  const referralIds = [...new Set(entries.flatMap((a) => (a.referralId ? [a.referralId] : [])))];
  const ruleIds = [...new Set(entries.flatMap((a) => (a.ruleId ? [a.ruleId] : [])))];
  const actorIds = [...new Set(entries.flatMap((a) => (a.actorId ? [a.actorId] : [])))];
  const [referrers, referrals, rules, users] = await Promise.all([
    prisma.referrer.findMany({ where: { id: { in: referrerIds } }, select: { id: true, client: { select: { name: true } } } }),
    prisma.referral.findMany({ where: { id: { in: referralIds } }, select: { id: true, referredClient: { select: { clientCode: true } } } }),
    prisma.rewardRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, name: true } }),
    actorIds.length ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const rows = assembleLedger(entries, {
    referrerNames: new Map(referrers.map((r) => [r.id, r.client.name])),
    referredCodes: new Map(referrals.map((r) => [r.id, r.referredClient?.clientCode ?? null])),
    ruleNames: new Map(rules.map((r) => [r.id, r.name])),
    actorNames: new Map(users.map((u) => [u.id, u.name])),
  });
  return { total: rows.length, rows: rows.slice(0, MAX_ROWS) };
}

export type RuleRow = { id: string; name: string; event: string; kind: "FIXED" | "PERCENT"; fixedPaise: number | null; percentBps: number | null; maxRewardPaise: number | null; capPerReferrerMonthPaise: number | null; validFrom: Date | null; validTo: Date | null; clawbackDays: number | null; active: boolean };

export type RulesData = { rules: RuleRow[]; disclaimer: string; disclosure: SignoffState; editorId: string | null; velocityLimit: number; linkBaseConfigured: boolean };

export async function loadRules(): Promise<RulesData> {
  const [rules, settings] = await Promise.all([prisma.rewardRule.findMany({ orderBy: { createdAt: "asc" } }), prisma.referralSetting.findMany()]);
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  const v = Number(get("velocity_limit"));
  return { rules: rules.map((r) => ({ ...r, kind: r.kind as "FIXED" | "PERCENT" })), disclaimer: get("disclaimer") ?? "", disclosure: signoffState({ custom: get("disclaimer"), signoff: get("disclaimer_signoff"), editor: get("disclaimer_editor") }), editorId: get("disclaimer_editor") ?? null, velocityLimit: Number.isInteger(v) && v > 0 ? v : DEFAULT_VELOCITY_LIMIT, linkBaseConfigured: !!process.env.REFERRAL_LINK_BASE };
}

export type StatementLine = { kind: "REWARD" | "RECOVERY"; event: string | null; amountPaise: number };
export type StatementView = { id: string; referrerId: string; referrerName: string; period: string; status: "PREPARED" | "APPROVED" | "PAID"; totalPaise: number; lineCount: number; recoveryPaise: number; lines: StatementLine[]; preparedById: string; preparedBy: string; approvedBy: string | null; bankReference: string | null };
export type ReadyRow = { referrerId: string; referrerName: string; paise: number; count: number; recoveries: number; hasStatement: boolean };

export async function loadStatements(now: Date): Promise<{ period: string; ready: ReadyRow[]; statements: StatementView[] }> {
  const period = monthKeyIST(now);
  const [entries, statements, referrers] = await Promise.all([
    prisma.rewardLedgerEntry.findMany({ orderBy: { createdAt: "asc" }, take: 20000 }),
    prisma.rewardStatement.findMany({ orderBy: [{ period: "desc" }, { preparedAt: "desc" }], take: 100 }),
    prisma.referrer.findMany({ select: { id: true, client: { select: { name: true } } } }),
  ]);
  const name = new Map(referrers.map((r) => [r.id, r.client.name]));
  const ledger = entries.map(toEntry);
  const userIds = [...new Set(statements.flatMap((s) => [s.preparedById, s.approvedById].filter((x): x is string => !!x)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const ready: ReadyRow[] = [];
  for (const r of referrers) {
    const c = statementCandidates(ledger, r.id, period);
    if (c.length) ready.push({ referrerId: r.id, referrerName: name.get(r.id) ?? "", paise: c.reduce((s, e) => s + e.amountPaise, 0), count: c.length, recoveries: c.filter((e) => e.kind === "CLAWBACK").length, hasStatement: statements.some((s) => s.referrerId === r.id && s.period === period) });
  }
  return {
    period,
    ready,
    statements: statements.map((s) => {
      const lines: StatementLine[] = (Array.isArray(s.lines) ? (s.lines as { entryId: string; amountPaise: number }[]) : []).map((l) => {
        const e = ledger.find((x) => x.id === l.entryId);
        const refd = e?.kind === "CLAWBACK" && e.refEntryId ? ledger.find((x) => x.id === e.refEntryId) : e;
        return { kind: e?.kind === "CLAWBACK" ? "RECOVERY" : "REWARD", event: refd?.eventType ?? null, amountPaise: l.amountPaise };
      });
      return { lines, recoveryPaise: lines.filter((l) => l.kind === "RECOVERY").reduce((t, l) => t + l.amountPaise, 0), id: s.id, referrerId: s.referrerId, referrerName: name.get(s.referrerId) ?? "Former referrer", period: s.period, status: s.status as StatementView["status"], totalPaise: s.totalPaise, lineCount: Array.isArray(s.lines) ? s.lines.length : 0, preparedById: s.preparedById, preparedBy: userName.get(s.preparedById) ?? "Unknown", approvedBy: s.approvedById ? (userName.get(s.approvedById) ?? "Unknown") : null, bankReference: s.bankReference };
    }),
  };
}

export type { AccrualState };
