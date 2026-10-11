import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { referralEnabled } from "@/lib/referrals/flag";
import { addDays } from "@/lib/marketing/dates";
import { loadMarketingWorkspace } from "@/lib/marketing/report";
import { netRevenue } from "@/lib/marketing/revenue";

import { buildDirectorReport, assignOtherChannel, type ChannelPeriod, type DirectorReport, type PeriodData, type CampaignPeriod } from "./report";
import { buildDigestEmail, digestDue, previousWeeks } from "./digest";
import { clampExpiryDays, generateToken, hashToken, isWellFormedToken, scrubSnapshot, shareState } from "./share";

/** Database side of the director reports: the period loader, shareable links and the weekly digest job. Aggregates only. */

const startOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function lastSync(provider: string): Promise<string | null> {
  const run = await prisma.adSyncRun.findFirst({ where: { provider, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } });
  const at = run ? (run.finishedAt ?? run.startedAt) : null;
  return at ? at.toISOString() : null;
}

async function crmChannels(from: string, to: string): Promise<{ referral: ChannelPeriod; partner: ChannelPeriod }> {
  const empty = (channel: "referral" | "partner"): ChannelPeriod => ({ channel, available: false, spend: null, leads: null, kyc: null, funded: null, revenue: null });
  const referralOn = referralEnabled();
  const partnerOn = isPartnerWorkspaceEnabled();
  if (!referralOn && !partnerOn) return { referral: empty("referral"), partner: empty("partner") };
  const gte = startOf(from);
  const lt = startOf(addDays(to, 1));
  const [referrals, touches] = await Promise.all([
    referralOn ? prisma.referral.findMany({ where: { outcome: "ATTRIBUTED", referredClientId: { not: null }, attributedAt: { gte, lt } }, select: { referredClientId: true }, take: 20_000 }) : Promise.resolve([]),
    partnerOn ? prisma.partnerReferralTouch.findMany({ where: { touchedAt: { gte, lt } }, select: { clientId: true }, take: 20_000 }) : Promise.resolve([]),
  ]);
  const referred = new Set(referrals.flatMap((r) => (r.referredClientId ? [r.referredClientId] : [])));
  const touched = new Set(touches.map((t) => t.clientId));
  const ids = [...new Set([...referred, ...touched])];
  const clients = ids.length
    ? await prisma.client.findMany({
        where: { id: { in: ids }, isDeleted: false, mergedIntoId: null },
        select: {
          id: true, leadSource: true, leadAttribution: true,
          kycRecord: { select: { status: true } }, fundingRecord: { select: { status: true } },
          payments: { where: { paymentType: "FUNDS_IN", status: "SUCCESS" }, select: { id: true }, take: 1 },
          revenueEvents: { select: { id: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } } },
        },
      })
    : [];
  const acc = { referral: { leads: 0, kyc: 0, funded: 0, revenue: 0 }, partner: { leads: 0, kyc: 0, funded: 0, revenue: 0 } };
  for (const c of clients) {
    const attribution = c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null;
    const channel = assignOtherChannel({ hasPartnerTouch: partnerOn && touched.has(c.id), hasReferral: referralOn && referred.has(c.id), attribution, leadSource: c.leadSource });
    if (!channel) continue;
    const a = acc[channel];
    a.leads++;
    if (c.kycRecord?.status === "APPROVED") a.kyc++;
    if (c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || c.payments.length > 0) a.funded++;
    a.revenue += netRevenue(c.revenueEvents.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null })));
  }
  return {
    referral: referralOn ? { channel: "referral", available: true, spend: null, ...acc.referral } : empty("referral"),
    partner: partnerOn ? { channel: "partner", available: true, spend: null, ...acc.partner } : empty("partner"),
  };
}

export async function loadPeriodData(from: string, to: string): Promise<PeriodData> {
  const ws = await loadMarketingWorkspace(() => ({ from, to, preset: "custom" }));
  const channels: ChannelPeriod[] = [];
  const campaigns: CampaignPeriod[] = [];
  const asOf: PeriodData["asOf"] = { meta: null, google: null, referral: null, partner: null };
  for (const c of ws.channels) {
    if (!c.report) {
      channels.push({ channel: c.channel, available: false, spend: null, leads: null, kyc: null, funded: null, revenue: null });
      continue;
    }
    const t = c.report.totals;
    channels.push({ channel: c.channel, available: true, spend: t.spend, leads: t.crmLeads, kyc: t.kyc, funded: t.funded, revenue: t.revenue });
    asOf[c.channel] = await lastSync(c.channel);
    for (const k of c.report.campaigns) campaigns.push({ channel: c.channel, campaignId: k.campaignId, name: k.name, spend: k.spend, leads: k.crmLeads, funded: k.funded, revenue: k.revenue });
  }
  const crm = await crmChannels(from, to);
  channels.push(crm.referral, crm.partner);
  const notes = ["A customer is counted once: someone who came through an ad stays with that ad channel even if a referral or partner code was also used.", ...(ws.blended?.notes.map((n) => n.text) ?? [])];
  return { from, to, currency: ws.blended?.currency ?? ws.channels.find((c) => c.report)?.report?.currency ?? null, channels, campaigns, asOf, notes };
}

/** The report for a period and the one before it of the same length. */
export async function loadDirectorReport(from: string, to: string, now = new Date()): Promise<DirectorReport> {
  const days = Math.round((startOf(to).getTime() - startOf(from).getTime()) / 86_400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const [current, previous] = await Promise.all([loadPeriodData(from, to), loadPeriodData(prevFrom, prevTo)]);
  return buildDirectorReport({ current, previous, generatedAt: now.toISOString() });
}

// ---- Shareable links ------------------------------------------------------------------------------------------------

export async function createShare(input: { report: DirectorReport; userId: string; expiryDays?: number; label?: string; now?: Date }): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + clampExpiryDays(input.expiryDays) * 86_400_000);
  const token = generateToken();
  const { value } = scrubSnapshot(input.report);
  const row = await prisma.reportShare.create({
    data: { tokenHash: hashToken(token), label: input.label?.trim().slice(0, 80) || null, periodFrom: startOf(input.report.period.from), periodTo: startOf(input.report.period.to), snapshot: value as unknown as Prisma.InputJsonValue, createdById: input.userId, expiresAt },
  });
  await prisma.auditLog.create({ data: { userId: input.userId, entity: "ReportShare", entityId: row.id, action: "report_share_created", newValue: { expiresAt: expiresAt.toISOString() } } });
  return { id: row.id, token, expiresAt };
}

export type OpenedShare = { state: "open"; report: DirectorReport; expiresAt: Date } | { state: "expired" | "revoked" | "not_found" };

export async function openShare(token: unknown, now = new Date()): Promise<OpenedShare> {
  if (!isWellFormedToken(token)) return { state: "not_found" };
  const row = await prisma.reportShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row) return { state: "not_found" };
  const state = shareState(row, now);
  if (state !== "open") return { state };
  await prisma.reportShare.update({ where: { id: row.id }, data: { viewCount: { increment: 1 }, lastViewedAt: now } });
  return { state: "open", report: row.snapshot as unknown as DirectorReport, expiresAt: row.expiresAt };
}

export async function revokeShare(id: string, userId: string, now = new Date()): Promise<boolean> {
  const res = await prisma.reportShare.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now, revokedById: userId } });
  if (res.count === 1) await prisma.auditLog.create({ data: { userId, entity: "ReportShare", entityId: id, action: "report_share_revoked" } });
  return res.count === 1;
}

export async function listShares(now = new Date()) {
  const rows = await prisma.reportShare.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, label: true, periodFrom: true, periodTo: true, expiresAt: true, revokedAt: true, viewCount: true, lastViewedAt: true, createdAt: true } });
  return rows.map((r) => ({ ...r, state: shareState(r, now) }));
}

// ---- Weekly digest ----------------------------------------------------------------------------------------------------

export type DigestJobResult = { skipped: string } | { created: string; notified: number };

/**
 * Prepares the Monday summary: a DRAFT email for approval and an in-app notice for the recipients that are users. Runs from the
 * cron tick; a no-op unless DIRECTOR_REPORTS_ENABLED=1 and the digest is switched on in settings. NEVER sends an email.
 * One digest per week (the week start is unique), so a repeat tick does nothing.
 */
export async function runWeeklyDigest(now = new Date(), env: Record<string, string | undefined> = process.env): Promise<DigestJobResult> {
  if (env.DIRECTOR_REPORTS_ENABLED !== "1") return { skipped: "flag off" };
  const { getDigestSettings } = await import("@/lib/creative/settings");
  const settings = await getDigestSettings();
  if (!settings.enabled) return { skipped: "digest off in settings" };
  const existing = new Set((await prisma.directorDigest.findMany({ select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 8 })).map((d) => d.weekStart.toISOString().slice(0, 10)));
  const due = digestDue(now, existing);
  if (!due.due) return { skipped: "not due" };
  const weeks = previousWeeks(now);
  const [current, previous] = await Promise.all([loadPeriodData(weeks.current.from, weeks.current.to), loadPeriodData(weeks.previous.from, weeks.previous.to)]);
  const report = buildDirectorReport({ current, previous, generatedAt: now.toISOString() });
  const email = buildDigestEmail(report, settings.recipients);
  try {
    await prisma.directorDigest.create({ data: { weekStart: startOf(weeks.weekStart), report: scrubSnapshot(report).value as unknown as Prisma.InputJsonValue, subject: email.subject, bodyText: email.bodyText, recipients: email.recipients } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { skipped: "already prepared" };
    throw e;
  }
  const users = settings.recipients.length ? await prisma.user.findMany({ where: { email: { in: settings.recipients }, role: { in: ["ADMIN", "MARKETING"] } }, select: { id: true } }) : [];
  for (const u of users) await prisma.notification.create({ data: { userId: u.id, type: "marketing_weekly_digest", payload: { weekStart: weeks.weekStart, subject: email.subject, hasData: report.hasData } } });
  return { created: weeks.weekStart, notified: users.length };
}

export async function approveDigest(id: string, userId: string, now = new Date()): Promise<boolean> {
  const res = await prisma.directorDigest.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedById: userId, approvedAt: now } });
  if (res.count === 1) await prisma.auditLog.create({ data: { userId, entity: "DirectorDigest", entityId: id, action: "digest_approved" } });
  return res.count === 1;
}

export async function discardDigest(id: string, userId: string): Promise<boolean> {
  const res = await prisma.directorDigest.updateMany({ where: { id, status: "DRAFT" }, data: { status: "DISCARDED" } });
  if (res.count === 1) await prisma.auditLog.create({ data: { userId, entity: "DirectorDigest", entityId: id, action: "digest_discarded" } });
  return res.count === 1;
}

export async function listDigests() {
  return prisma.directorDigest.findMany({ orderBy: { weekStart: "desc" }, take: 8 });
}
