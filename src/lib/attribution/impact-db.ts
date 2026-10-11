import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canAccessMarketing } from "@/lib/access/marketing-access";
import { isPseudonymousViewer } from "@/lib/access/pseudonym";
import { AD_CHANNELS, CHANNEL_LABEL, type AdChannel } from "@/lib/marketing/channels";
import { addDays, todayInTimeZone, ymdToDate } from "@/lib/marketing/dates";
import { googleAdsReportingEnabled } from "@/lib/marketing/flags";
import { currencyExponent } from "@/lib/marketing/money";

import { loadAttributionContext, loadContactSignals, loadSettings } from "./db";
import { firstContactAt } from "./first-contact";
import { buildImpact, classifyContact, spendFreshness, type ImpactClient, type ImpactReport, type SpendFreshness, type SpendInput } from "./impact";
import { attribute, groupOf } from "./model";
import { fundedAtOf, intakeTouch, revenueSummary } from "./rows";
import { standInId, standInName } from "./stand-in";

/** Database side of Campaign impact. Aggregates cover every customer; the customer LIST is limited to the ones the viewer may open. */

const LEAD_LIMIT = 5000;

export type Range = { from: string; to: string };
export type CustomerLine = { clientId: string; name: string; rmName: string | null; stage: string; leadDate: string; createdAtIso: string; funded: boolean; kycApproved: boolean; revenue: number; confidence: ImpactClient["confidence"]; contact: ImpactClient["contact"]; /** True when the name, RM and id are stand-ins: no link into the CRM. */ pseudonymous?: boolean };

export type ImpactData = {
  report: ImpactReport;
  /** Every customer of the period as the model sees them. Present only when asked for (lead cohorts); aggregates need not carry it. */
  clients?: ImpactClient[];
  freshness: { channel: AdChannel; label: string; value: SpendFreshness }[];
  /** Customers the viewer may open, by group key. */
  customers: Record<string, CustomerLine[]>;
  /** Every customer by group key, whoever may open them: the aggregates count all of them. */
  groupTotals: Record<string, number>;
  hiddenCustomers: number;
  slaMinutes: number;
  truncated: boolean;
  timezone: string;
};

type Viewer = { id: string; role: string };

/** Assets under management per customer today: the latest holdings value of each trading account. */
async function aumByClient(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ clientId: string; aum: Prisma.Decimal | null }[]>(Prisma.sql`
    SELECT ta."clientId" AS "clientId", SUM(p."currentValue") AS aum
    FROM "Position" p JOIN "TradingAccount" ta ON ta."id" = p."tradingAccountId"
    WHERE ta."clientId" = ANY(${ids}::text[])
      AND p."asOfDate" = (SELECT MAX(p2."asOfDate") FROM "Position" p2 WHERE p2."tradingAccountId" = p."tradingAccountId")
    GROUP BY ta."clientId"`);
  return new Map(rows.map((r) => [r.clientId, Number(r.aum ?? 0)]));
}

async function loadSpend(range: Range, now: Date, today: string) {
  const channels: AdChannel[] = AD_CHANNELS.filter((c) => c === "meta" || googleAdsReportingEnabled());
  const spend: SpendInput[] = [];
  const freshness: ImpactData["freshness"] = [];
  const minorByCurrency = new Map<string, number>();
  const gte = ymdToDate(range.from);
  const lte = ymdToDate(range.to);
  for (const channel of channels) {
    const [rows, dates, lastRun, first] = await Promise.all([
      prisma.adCampaignDaily.groupBy({ by: ["campaignId", "currency"], where: { provider: channel, date: { gte, lte } }, _sum: { spendMinor: true } }),
      prisma.adCampaignDaily.groupBy({ by: ["date"], where: { provider: channel, date: { gte, lte } } }),
      prisma.adSyncRun.findFirst({ where: { provider: channel, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
      prisma.adCampaignDaily.aggregate({ where: { provider: channel }, _min: { date: true } }),
    ]);
    const names = await prisma.adCampaignDaily.findMany({ where: { provider: channel, campaignId: { in: rows.map((r) => r.campaignId) } }, orderBy: { date: "desc" }, distinct: ["campaignId"], select: { campaignId: true, campaignName: true } });
    const nameOf = new Map(names.map((n) => [n.campaignId, n.campaignName]));
    const creativeRows = channel === "google" ? await prisma.adCreativeDaily.groupBy({ by: ["campaignId", "adName", "currency"], where: { provider: channel, date: { gte, lte } }, _sum: { spendMinor: true } }) : [];
    for (const r of rows) {
      const minor = Number(r._sum.spendMinor ?? 0);
      minorByCurrency.set(r.currency, (minorByCurrency.get(r.currency) ?? 0) + minor);
      const exp = currencyExponent(r.currency);
      spend.push({
        key: `${channel}:${r.campaignId}`, label: nameOf.get(r.campaignId) ?? r.campaignId, channel, currency: r.currency, spend: minor / 10 ** exp,
        creatives: creativeRows.filter((c) => c.campaignId === r.campaignId && c.currency === r.currency).map((c) => ({ name: c.adName, spend: Number(c._sum.spendMinor ?? 0) / 10 ** exp })),
      });
    }
    freshness.push({
      channel, label: CHANNEL_LABEL[channel],
      value: spendFreshness({ now, today, range, lastSuccessAt: lastRun?.startedAt ?? null, daysWithData: new Set(dates.map((d) => d.date.toISOString().slice(0, 10))), historyStart: first._min.date ? first._min.date.toISOString().slice(0, 10) : null }),
    });
  }
  const currency = [...minorByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "INR";
  return { spend, freshness, currency };
}

/** Everything about one period. `viewer` null means aggregates only (the comparison period). */
export async function loadImpact(range: Range, viewer: Viewer | null, now = new Date(), opts: { includeClients?: boolean } = {}): Promise<ImpactData> {
  // Cost and return are for ADMIN and MARKETING only. The pages check this too; the loader refuses on its own.
  if (viewer && !canAccessMarketing(viewer.role)) throw new Error("Not allowed to see campaign cost and return");
  // MARKETING sees stand-ins only, so the real name and RM are not even selected for them.
  const pseudo = viewer ? isPseudonymousViewer(viewer.role) : false;
  const ctx = await loadAttributionContext(now);
  const tz = ctx.timezone;
  const today = todayInTimeZone(now, tz);
  const [settings, { spend, freshness, currency }] = await Promise.all([loadSettings(), loadSpend(range, now, today)]);

  const rows = await prisma.client.findMany({
    where: { isDeleted: false, mergedIntoId: null, createdAt: { gte: ymdToDate(addDays(range.from, -1)), lt: ymdToDate(addDays(range.to, 2)) } },
    orderBy: { createdAt: "desc" },
    take: LEAD_LIMIT,
    select: {
      id: true, createdAt: true, leadSource: true, leadAttribution: true, assignedToId: true,
      ...(opts.includeClients ? { city: true, state: true } : {}),
      ...(pseudo ? {} : { name: true, assignedTo: { select: { name: true } } }),
      currentStage: { select: { name: true } },
      kycRecord: { select: { status: true } }, fundingRecord: { select: { status: true, fundingDate: true } },
    },
  });
  const inRange = rows.filter((c) => {
    const day = todayInTimeZone(c.createdAt, tz);
    return day >= range.from && day <= range.to;
  });
  const ids = inRange.map((c) => c.id);
  const [intakes, partners, referrals, payments, revenue, signals] = ids.length
    ? await Promise.all([
        prisma.leadIntake.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, source: true, externalId: true, receivedAt: true, rawPayload: true } }),
        prisma.partnerReferralTouch.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, code: true, touchedAt: true, source: true } }),
        prisma.referral.findMany({ where: { referredClientId: { in: ids }, outcome: "ATTRIBUTED" }, select: { referredClientId: true, attributedAt: true, codeId: true } }),
        prisma.clientPayment.findMany({ where: { clientId: { in: ids }, paymentType: "FUNDS_IN", status: "SUCCESS" }, select: { clientId: true, paidAt: true } }),
        prisma.revenueEvent.findMany({ where: { clientId: { in: ids } }, select: { id: true, clientId: true, revenueType: true, grossRevenueAmount: true, eventDate: true, reversesEventId: true, reverses: { select: { revenueType: true } } } }),
        loadContactSignals(ids),
      ])
    : [[], [], [], [], [], new Map<string, never[]>()];
  const codeIds = referrals.flatMap((r) => (r.codeId ? [r.codeId] : []));
  const codes = codeIds.length ? await prisma.referralCode.findMany({ where: { id: { in: codeIds } }, select: { id: true, code: true } }) : [];

  const by = <T extends { clientId: string | null }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) if (r.clientId) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const intakeBy = by(intakes);
  const partnerBy = new Map(partners.map((p) => [p.clientId, p]));
  const referralBy = new Map(referrals.map((r) => [r.referredClientId, r]));
  const paymentBy = by(payments);
  const revenueBy = by(revenue);

  const aum = opts.includeClients ? await aumByClient(ids) : new Map<string, number>();
  const customers: Record<string, CustomerLine[]> = {};
  const groupTotals: Record<string, number> = {};
  const impactClients: ImpactClient[] = inRange.map((c) => {
    const pays = (paymentBy.get(c.id) ?? []).map((p) => p.paidAt);
    const fundedAt = fundedAtOf({ payments: pays, funding: c.fundingRecord });
    const partner = partnerBy.get(c.id);
    const ref = referralBy.get(c.id);
    const attribution = attribute(
      {
        clientId: c.id, createdAt: c.createdAt, leadSource: c.leadSource,
        leadAttribution: c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null,
        intakes: (intakeBy.get(c.id) ?? []).map(intakeTouch),
        partner: partner ? { code: partner.code, at: partner.touchedAt, source: partner.source } : null,
        referral: ref ? { code: codes.find((k) => k.id === ref.codeId)?.code ?? null, at: ref.attributedAt } : null,
        fundedAt,
      },
      ctx,
    );
    const first = attribution.status === "attributed" ? attribution.first : null;
    const rev = revenueSummary((revenueBy.get(c.id) ?? []).map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null, eventDate: e.eventDate })));
    const contactedAt = firstContactAt(signals.get(c.id) ?? [], c.createdAt);
    const funded = c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || pays.length > 0;
    const line: ImpactClient = {
      clientId: c.id, name: pseudo ? standInName(c.id) : (c.name ?? ""), rmId: c.assignedToId, rmName: pseudo ? null : (c.assignedTo?.name ?? null), stage: c.currentStage.name, createdAt: c.createdAt,
      leadMonth: todayInTimeZone(c.createdAt, tz).slice(0, 7), group: groupOf(first), creative: first?.creative ?? null, confidence: first?.confidence ?? null,
      contact: classifyContact({ createdAt: c.createdAt, contactedAt, slaMinutes: settings.slaMinutes, now }),
      firstContactMinutes: contactedAt ? Math.round((contactedAt.getTime() - c.createdAt.getTime()) / 60_000) : null,
      kycApproved: c.kycRecord?.status === "APPROVED", funded, revenue: rev.total, revenueByMonth: rev.byMonth,
      ...(opts.includeClients ? { city: (c as { city?: string | null }).city ?? null, state: (c as { state?: string | null }).state ?? null, aum: aum.get(c.id) ?? 0 } : {}),
    };
    groupTotals[line.group.key] = (groupTotals[line.group.key] ?? 0) + 1;
    // Only ADMIN and MARKETING get this far (refused above), and both see every customer in the list: ADMIN as themselves, MARKETING as stand-ins.
    if (viewer) {
      (customers[line.group.key] ??= []).push({ clientId: pseudo ? standInId(c.id) : c.id, name: pseudo ? standInName(c.id) : (c.name ?? ""), rmName: pseudo ? null : line.rmName, pseudonymous: pseudo || undefined, stage: line.stage, leadDate: todayInTimeZone(c.createdAt, tz), createdAtIso: c.createdAt.toISOString(), funded, kycApproved: line.kycApproved, revenue: line.revenue, confidence: line.confidence, contact: line.contact });
    }
    return line;
  });

  return {
    report: buildImpact({ clients: impactClients, spend, slaMinutes: settings.slaMinutes, currency }),
    ...(opts.includeClients ? { clients: impactClients } : {}),
    freshness, customers, groupTotals, hiddenCustomers: 0, slaMinutes: settings.slaMinutes, truncated: rows.length >= LEAD_LIMIT, timezone: tz,
  };
}
