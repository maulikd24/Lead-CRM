import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/access/policy";
import { prisma } from "@/lib/db/prisma";
import { getEmailAdapter } from "@/lib/integrations/registry";

import { latestAuditRun } from "./audit-db";
import { evaluateControls } from "./controls";
import { dataAgeText } from "./derive";
import { createWeeklyDigest, decideDigest, weekStartOf, type DigestDeps, type DigestFacts, type DigestRow } from "./digest";
import { scoreControls } from "./scoring";
import * as store from "./store";
import { wastedSpend } from "./waste";

/** Production wiring of the weekly digest. Recipients are the active users the registry lets view Autopilot; nothing is sent until a person approves the draft. */
async function recipients() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true, role: true } });
  return users.filter((u) => can(u.role, "marketing-autopilot", "view")).map((u) => ({ id: u.id, email: u.email }));
}

async function facts(): Promise<DigestFacts> {
  const now = new Date();
  const snap = await store.loadSnapshot({ caller: { kind: "system", consumer: "autopilot" } });
  const results = evaluateControls(snap);
  const score = scoreControls(results);
  const waste = wastedSpend(snap);
  const [open, fresh, approved] = await Promise.all([
    prisma.autopilotRecommendation.findMany({ where: { status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { firstSeenAt: "desc" }, take: 200, select: { issue: true, severity: true, impact: true } }),
    prisma.autopilotRecommendation.count({ where: { firstSeenAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    prisma.autopilotRecommendation.count({ where: { status: "APPROVED" } }),
  ]);
  const weight: Record<string, number> = { critical: 4, high: 3, medium: 2, informational: 1 };
  const top = [...open].sort((a, b) => (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0)).slice(0, 5).map((r) => ({ issue: r.issue, impact: (r.impact as { text?: string } | null)?.text ?? "" }));
  return { weekStart: weekStartOf(now), health: score.score, wastedSpend: snap.days.length ? waste.wasted : null, wastedShare: waste.wastedShare, totalSpend: snap.days.length ? waste.totalSpend : null, open: open.length, newThisWeek: fresh, approvedWaiting: approved, dataAge: dataAgeText(snap), top };
}

const toRow = (r: { id: string; weekStart: string; correlationId: string; subject: string; body: string; status: string; recipients: unknown; decidedById: string | null }): DigestRow => ({
  id: r.id, weekStart: r.weekStart, correlationId: r.correlationId, subject: r.subject, body: r.body, status: r.status as DigestRow["status"], recipients: Array.isArray(r.recipients) ? (r.recipients as string[]) : [], decidedById: r.decidedById,
});

export function digestDeps(): DigestDeps {
  return {
    now: () => new Date(),
    facts, recipients,
    insert: async (row) => {
      try {
        await prisma.autopilotDigest.create({ data: { id: row.id, weekStart: row.weekStart, correlationId: row.correlationId, subject: row.subject, body: row.body, recipients: row.recipients } });
        return true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
        throw e;
      }
    },
    exists: async (weekStart) => (await prisma.autopilotDigest.count({ where: { weekStart } })) > 0,
    get: async (id) => { const r = await prisma.autopilotDigest.findUnique({ where: { id } }); return r ? toRow(r) : null; },
    claim: async (id, to, byId) => (await prisma.autopilotDigest.updateMany({ where: { id, status: "DRAFT" }, data: { status: to, decidedById: byId, decidedAt: new Date() } })).count === 1,
    release: async (id) => { await prisma.autopilotDigest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "DRAFT", decidedById: null, decidedAt: null } }); },
    notify: async (userIds, payload) => { await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type: "autopilot_digest", payload: payload as never })) }); },
    send: async (m) => {
      const adapter = await getEmailAdapter();
      const r = await adapter.sendEmail({ to: m.to, subject: m.subject, html: `<pre style="font-family: inherit; white-space: pre-wrap;">${m.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</pre>`, text: m.text });
      return r.success ? { ok: true } : { ok: false, error: r.error ?? "unknown" };
    },
    newId: () => randomUUID(),
  };
}

/** The cron job: once a week, flagged. Creates the in-app notification and the DRAFT email; sends nothing. */
export async function runWeeklyDigestJob(env: Record<string, string | undefined> = process.env): Promise<Record<string, number | boolean>> {
  if (env.NEXT_PUBLIC_AUTOPILOT !== "1" || env.AUTOPILOT_DIGEST_ENABLED !== "1") return { skipped: true };
  const r = await createWeeklyDigest(digestDeps());
  return { created: r.created };
}

export const decideDigestNow = (input: { id: string; actorId: string; verdict: "approve" | "discard" }) => decideDigest(digestDeps(), input);

export async function latestDigest() {
  const r = await prisma.autopilotDigest.findFirst({ orderBy: { createdAt: "desc" } });
  return r ? toRow(r) : null;
}
export { latestAuditRun };
