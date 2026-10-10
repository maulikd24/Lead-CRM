import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import type { Party } from "./attribution";
import type { LedgerEntry, LedgerKind } from "./ledger";
import type { RuleSpec } from "./rewards";
import type { ReferralEventType } from "./state-machine";
import type { NewLedgerEntry, ReferralStore, StatementRow } from "./store";

const paise = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Math.round(Number(d) * 100));
const party = (c: { id: string; mobileKey: string | null; emailKey: string | null; pan: string | null }): Party => ({ clientId: c.id, phoneKey: c.mobileKey, emailKey: c.emailKey, pan: c.pan });
const PARTY = { id: true, mobileKey: true, emailKey: true, pan: true } as const;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const toEntry = (e: { id: string; kind: string; referrerId: string; amountPaise: number; refEntryId: string | null; flags: string[]; periodMonth: string }): LedgerEntry => ({ id: e.id, kind: e.kind as LedgerKind, referrerId: e.referrerId, amountPaise: e.amountPaise, refEntryId: e.refEntryId, flags: e.flags, periodMonth: e.periodMonth });
const toRow = (s: { id: string; referrerId: string; period: string; status: string; totalPaise: number; lines: Prisma.JsonValue; preparedById: string; approvedById: string | null; bankReference: string | null }): StatementRow => ({ ...s, status: s.status as StatementRow["status"], lines: s.lines as StatementRow["lines"] });
const toData = (e: NewLedgerEntry): Prisma.RewardLedgerEntryCreateManyInput => ({ idempotencyKey: e.idempotencyKey, kind: e.kind, referrerId: e.referrerId, referralId: e.referralId, eventType: e.eventType, ruleId: e.ruleId, refEntryId: e.refEntryId, statementId: e.statementId, amountPaise: e.amountPaise, periodMonth: e.periodMonth, flags: e.flags, note: e.note, actorId: e.actorId });

export const prismaReferralStore: ReferralStore = {
  async findClaim(key) {
    const r = await prisma.referral.findUnique({ where: { idempotencyKey: key }, select: { outcome: true, reason: true } });
    return r ? { outcome: r.outcome as "ATTRIBUTED" | "REJECTED", reason: r.reason } : null;
  },
  async findCodeByValue(code) {
    const c = await prisma.referralCode.findUnique({ where: { code }, include: { referrer: { select: { status: true, client: { select: PARTY } } } } });
    if (!c) return null;
    return { id: c.id, referrerId: c.referrerId, status: c.status as "ACTIVE" | "REVOKED", createdAt: c.createdAt, revokedAt: c.revokedAt, referrerStatus: c.referrer.status as "ACTIVE" | "SUSPENDED", referrer: party(c.referrer.client) };
  },
  async loadParty(clientId) {
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: PARTY });
    return c ? party(c) : null;
  },
  async isReferred(clientId) {
    return (await prisma.referral.count({ where: { referredClientId: clientId } })) > 0;
  },
  async saveClaim(c) {
    try {
      await prisma.$transaction(async (tx) => {
        const row = await tx.referral.create({ data: { idempotencyKey: c.key, referrerId: c.referrerId, codeId: c.codeId, referredClientId: c.referredClientId, outcome: c.outcome, reason: c.reason, attributedAt: c.attributedAt } });
        if (c.outcome === "ATTRIBUTED") await tx.referralEvent.create({ data: { referralId: row.id, type: "SIGNED_UP", occurredAt: c.attributedAt } });
      });
      return "saved";
    } catch (e) {
      if (isUnique(e)) return "conflict";
      throw e;
    }
  },
  async listAttributed(limit) {
    const rows = await prisma.referral.findMany({ where: { outcome: "ATTRIBUTED", referrerId: { not: null }, referredClientId: { not: null } }, orderBy: [{ attributedAt: "asc" }, { id: "asc" }], take: limit, select: { id: true, referrerId: true, referredClientId: true, attributedAt: true } });
    return rows.map((r) => ({ id: r.id, referrerId: r.referrerId!, referredClientId: r.referredClientId!, attributedAt: r.attributedAt }));
  },
  async loadProgress(r) {
    const [events, kyc, funding, referrerRow, referred, sibs, last24] = await Promise.all([
      prisma.referralEvent.findMany({ where: { referralId: r.id }, select: { id: true, type: true, occurredAt: true, amountPaise: true } }),
      prisma.kycRecord.findUnique({ where: { clientId: r.referredClientId }, select: { status: true, completionDate: true, updatedAt: true } }),
      prisma.fundingRecord.findUnique({ where: { clientId: r.referredClientId }, select: { status: true, amount: true, fundingDate: true, updatedAt: true } }),
      prisma.referrer.findUniqueOrThrow({ where: { id: r.referrerId }, select: { client: { select: PARTY } } }),
      prisma.client.findUniqueOrThrow({ where: { id: r.referredClientId }, select: PARTY }),
      prisma.referral.findMany({ where: { referrerId: r.referrerId, outcome: "ATTRIBUTED", referredClientId: { not: null } }, select: { referredClient: { select: PARTY } } }),
      prisma.referral.count({ where: { referrerId: r.referrerId, outcome: "ATTRIBUTED", attributedAt: { gt: new Date(r.attributedAt.getTime() - 86_400_000), lte: r.attributedAt } } }),
    ]);
    const funded = funding && (funding.status === "FULLY_FUNDED" || funding.status === "PARTIALLY_FUNDED");
    return {
      events: events.map((e) => ({ id: e.id, type: e.type as ReferralEventType, occurredAt: e.occurredAt, amountPaise: e.amountPaise })),
      evidence: {
        kycApprovedAt: kyc?.status === "APPROVED" ? (kyc.completionDate ?? kyc.updatedAt) : null,
        firstFundedAt: funded ? (funding.fundingDate ?? funding.updatedAt) : null,
        fundedAmountPaise: funded ? paise(funding.amount) : null,
      },
      referrer: party(referrerRow.client),
      referred: party(referred),
      siblings: sibs.flatMap((s) => (s.referredClient ? [party(s.referredClient)] : [])),
      attributionsLast24h: last24,
    };
  },
  async listRules() {
    const rows = await prisma.rewardRule.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((r): RuleSpec => ({ id: r.id, event: r.event as ReferralEventType, kind: r.kind as "FIXED" | "PERCENT", fixedPaise: r.fixedPaise, percentBps: r.percentBps, maxRewardPaise: r.maxRewardPaise, capPerReferrerMonthPaise: r.capPerReferrerMonthPaise, validFrom: r.validFrom, validTo: r.validTo, active: r.active }));
  },
  async getSetting(key) {
    return (await prisma.referralSetting.findUnique({ where: { key } }))?.value ?? null;
  },
  async accrualKeys(referralId) {
    const rows = await prisma.rewardLedgerEntry.findMany({ where: { kind: "ACCRUED", idempotencyKey: { startsWith: `accrue:${referralId}:` } }, select: { idempotencyKey: true } });
    return new Set(rows.map((r) => r.idempotencyKey));
  },
  async ledgerForReferrerMonth(referrerId, month) {
    return (await prisma.rewardLedgerEntry.findMany({ where: { referrerId, periodMonth: month, kind: { in: ["ACCRUED", "REVERSED"] } } })).map(toEntry);
  },
  async commitProgress(c) {
    await prisma.$transaction([
      prisma.referralEvent.createMany({ data: c.events.map((e) => ({ referralId: c.referralId, type: e.type, occurredAt: e.occurredAt, amountPaise: e.amountPaise })), skipDuplicates: true }),
      prisma.rewardLedgerEntry.createMany({ data: c.entries.map(toData), skipDuplicates: true }),
    ]);
  },
  async ledgerForReferrer(referrerId) {
    return (await prisma.rewardLedgerEntry.findMany({ where: { referrerId }, orderBy: { createdAt: "asc" } })).map(toEntry);
  },
  async appendEntries(entries) {
    if (entries.length) await prisma.rewardLedgerEntry.createMany({ data: entries.map(toData), skipDuplicates: true });
  },
  async getStatement(referrerId, period) {
    const s = await prisma.rewardStatement.findUnique({ where: { referrerId_period: { referrerId, period } } });
    return s ? toRow(s) : null;
  },
  async getStatementById(id) {
    const s = await prisma.rewardStatement.findUnique({ where: { id } });
    return s ? toRow(s) : null;
  },
  async upsertPreparedStatement(s) {
    const lines = s.lines as unknown as Prisma.InputJsonValue;
    try {
      return toRow(await prisma.rewardStatement.create({ data: { referrerId: s.referrerId, period: s.period, totalPaise: s.totalPaise, lines, preparedById: s.preparedById } }));
    } catch (e) {
      if (!isUnique(e)) throw e;
      await prisma.rewardStatement.updateMany({ where: { referrerId: s.referrerId, period: s.period, status: "PREPARED" }, data: { totalPaise: s.totalPaise, lines, preparedById: s.preparedById, preparedAt: new Date() } });
      return toRow(await prisma.rewardStatement.findUniqueOrThrow({ where: { referrerId_period: { referrerId: s.referrerId, period: s.period } } }));
    }
  },
  async advanceStatement(id, from, to, entries) {
    return prisma.$transaction(async (tx) => {
      const data = to.status === "APPROVED" ? { status: "APPROVED", approvedById: to.approvedById, approvedAt: new Date() } : { status: "PAID", paidMarkedById: to.paidMarkedById, paidMarkedAt: new Date(), bankReference: to.bankReference };
      const res = await tx.rewardStatement.updateMany({ where: { id, status: from }, data });
      if (res.count !== 1) return false;
      await tx.rewardLedgerEntry.createMany({ data: entries.map(toData), skipDuplicates: true });
      return true;
    });
  },
};
