import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getCampaignOutcomeProvider, type CampaignOutcomeProvider } from "@/lib/attribution";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { referralEnabled } from "@/lib/referrals/flag";
import { addDays } from "@/lib/marketing/dates";

import { getApprovalSettings, getDigestSettings } from "@/lib/creative/settings";
import { emitDigestStep, emitReportShareRevoked, emitReportShared } from "@/lib/events/producers-emit";

import { periodFromOutcomes } from "./period";
import { buildDirectorReport, type DirectorReport, type PeriodData } from "./report";
import { buildDigestEmail, digestDue, previousWeeks } from "./digest";
import { clampExpiryDays, generateToken, hashToken, isWellFormedToken, planShareDecision, scrubSnapshot, shareState } from "./share";

/** Database side of the director reports: the period loader, shareable links and the weekly digest job. Aggregates only. */

const startOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * One period of the report: the CampaignOutcomeProvider's numbers, as the registered system consumer "director-reports" (the callers have already
 * passed the registry: a signed-in ADMIN or MARKETING, or the weekly job). Nothing here queries customers, ad spend or syncs.
 */
export async function loadPeriodData(from: string, to: string, provider: CampaignOutcomeProvider = getCampaignOutcomeProvider()): Promise<PeriodData> {
  const report = await provider.outcomes({ grain: "campaign", period: { from, to } }, { kind: "system", consumer: "director-reports" });
  return periodFromOutcomes({ from, to, report, programmes: { referral: referralEnabled(), partner: isPartnerWorkspaceEnabled() } });
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
    // The link is created awaiting approval: it opens nothing until a person approves its publication (decideShare, canonical kind director-report).
    data: { tokenHash: hashToken(token), label: input.label?.trim().slice(0, 80) || null, periodFrom: startOf(input.report.period.from), periodTo: startOf(input.report.period.to), snapshot: value as unknown as Prisma.InputJsonValue, createdById: input.userId, expiresAt, awaitingApproval: true },
  });
  await prisma.auditLog.create({ data: { userId: input.userId, entity: "ReportShare", entityId: row.id, action: "report_share_requested", newValue: { expiresAt: expiresAt.toISOString() } } });
  return { id: row.id, token, expiresAt };
}

export type OpenedShare = { state: "open"; report: DirectorReport; expiresAt: Date } | { state: "expired" | "revoked" | "not_found" };

export async function openShare(token: unknown, now = new Date()): Promise<OpenedShare> {
  if (!isWellFormedToken(token)) return { state: "not_found" };
  const row = await prisma.reportShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row) return { state: "not_found" };
  const state = shareState(row, now);
  // A link still awaiting approval is indistinguishable from one that was never issued.
  if (state === "pending") return { state: "not_found" };
  if (state !== "open") return { state };
  await prisma.reportShare.update({ where: { id: row.id }, data: { viewCount: { increment: 1 }, lastViewedAt: now } });
  return { state: "open", report: row.snapshot as unknown as DirectorReport, expiresAt: row.expiresAt };
}

export async function revokeShare(id: string, userId: string, now = new Date()): Promise<boolean> {
  const res = await prisma.reportShare.updateMany({ where: { id, revokedAt: null, awaitingApproval: false }, data: { revokedAt: now, revokedById: userId } });
  if (res.count === 1) {
    await prisma.auditLog.create({ data: { userId, entity: "ReportShare", entityId: id, action: "report_share_revoked" } });
    await emitReportShareRevoked({ shareId: id, actorUserId: userId, occurredAt: now });
  }
  return res.count === 1;
}

export type ShareDecisionResult = { ok: true; decision: "approve" | "decline" } | { ok: false; error: string };

/**
 * The legacy path behind the canonical director-report approval for a report link: approve (the link starts to open) or decline (it is revoked with a
 * reason and never opens). Compare-and-set on "still awaiting approval", so two people cannot both decide. Four eyes follow the approval setting.
 */
export async function decideShare(input: { id: string; actorId: string; decision: "approve" | "decline"; confirmed?: boolean; reason?: string; now?: Date }): Promise<ShareDecisionResult> {
  const now = input.now ?? new Date();
  const row = await prisma.reportShare.findUnique({ where: { id: input.id }, select: { awaitingApproval: true, revokedAt: true, expiresAt: true, createdById: true } });
  if (!row) return { ok: false, error: "That link no longer exists." };
  const { reportFourEyes } = await getApprovalSettings();
  const plan = planShareDecision({ share: row, actorId: input.actorId, decision: input.decision, fourEyes: reportFourEyes, confirmed: input.confirmed, reason: input.reason, now });
  if (!plan.ok) return plan;
  const where = { id: input.id, awaitingApproval: true, revokedAt: null, expiresAt: { gt: now } };
  const res =
    plan.decision === "approve"
      ? await prisma.reportShare.updateMany({ where, data: { awaitingApproval: false, approvedAt: now, approvedById: input.actorId } })
      : await prisma.reportShare.updateMany({ where, data: { awaitingApproval: false, revokedAt: now, revokedById: input.actorId, decisionNote: plan.reason } });
  if (res.count !== 1) return { ok: false, error: "That link is no longer waiting for approval." };
  await prisma.auditLog.create({ data: { userId: input.actorId, entity: "ReportShare", entityId: input.id, action: plan.decision === "approve" ? "report_share_approved" : "report_share_declined" } });
  if (plan.decision === "approve") await emitReportShared({ shareId: input.id, expiresInDays: Math.max(1, Math.round((row.expiresAt.getTime() - now.getTime()) / 86_400_000)), actorUserId: input.actorId, occurredAt: now });
  return { ok: true, decision: plan.decision };
}

export async function listShares(now = new Date()) {
  const rows = await prisma.reportShare.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, label: true, periodFrom: true, periodTo: true, expiresAt: true, revokedAt: true, awaitingApproval: true, createdById: true, decisionNote: true, viewCount: true, lastViewedAt: true, createdAt: true } });
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
  const settings = await getDigestSettings();
  if (!settings.enabled) return { skipped: "digest off in settings" };
  const existing = new Set((await prisma.directorDigest.findMany({ select: { weekStart: true }, orderBy: { weekStart: "desc" }, take: 8 })).map((d) => d.weekStart.toISOString().slice(0, 10)));
  const due = digestDue(now, existing);
  if (!due.due) return { skipped: "not due" };
  const weeks = previousWeeks(now);
  const [current, previous] = await Promise.all([loadPeriodData(weeks.current.from, weeks.current.to), loadPeriodData(weeks.previous.from, weeks.previous.to)]);
  const report = buildDirectorReport({ current, previous, generatedAt: now.toISOString() });
  const email = buildDigestEmail(report, settings.recipients);
  let digestId: string;
  try {
    digestId = (await prisma.directorDigest.create({ select: { id: true }, data: { weekStart: startOf(weeks.weekStart), report: scrubSnapshot(report).value as unknown as Prisma.InputJsonValue, subject: email.subject, bodyText: email.bodyText, recipients: email.recipients } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { skipped: "already prepared" };
    throw e;
  }
  const users = settings.recipients.length ? await prisma.user.findMany({ where: { email: { in: settings.recipients }, role: { in: ["ADMIN", "MARKETING"] } }, select: { id: true } }) : [];
  for (const u of users) await prisma.notification.create({ data: { userId: u.id, type: "marketing_weekly_digest", payload: { weekStart: weeks.weekStart, subject: email.subject, hasData: report.hasData } } });
  await emitDigestStep({ kind: "prepared", digestId, hasData: report.hasData, occurredAt: now });
  return { created: weeks.weekStart, notified: users.length };
}

export async function approveDigest(id: string, userId: string, now = new Date()): Promise<boolean> {
  const res = await prisma.directorDigest.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedById: userId, approvedAt: now } });
  if (res.count === 1) {
    await prisma.auditLog.create({ data: { userId, entity: "DirectorDigest", entityId: id, action: "digest_approved" } });
    await emitDigestStep({ kind: "approved", digestId: id, actorUserId: userId, occurredAt: now });
  }
  return res.count === 1;
}

export async function discardDigest(id: string, userId: string, now = new Date()): Promise<boolean> {
  const res = await prisma.directorDigest.updateMany({ where: { id, status: "DRAFT" }, data: { status: "DISCARDED" } });
  if (res.count === 1) {
    await prisma.auditLog.create({ data: { userId, entity: "DirectorDigest", entityId: id, action: "digest_discarded" } });
    await emitDigestStep({ kind: "discarded", digestId: id, actorUserId: userId, occurredAt: now });
  }
  return res.count === 1;
}

export async function listDigests() {
  return prisma.directorDigest.findMany({ orderBy: { weekStart: "desc" }, take: 8 });
}
