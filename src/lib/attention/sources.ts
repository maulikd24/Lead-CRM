import { prisma } from "@/lib/db/prisma";
import { groupFailures } from "@/lib/system/failures";
import { loadFailureItems } from "@/lib/system/failures-sources";
import { jobSpec } from "@/lib/system/job-registry";

import { allowedKinds, type AttentionCandidate, type AttentionKind, type Scope } from "./engine";
import { loadOpenRecommendations } from "@/lib/intelligence/decision/attention-read";
import { loadServiceAttentionFacts } from "@/lib/service/read";
import {
  approvalCandidate, bandForValue, commitmentCandidate, complaintCandidate, dataQualityCandidate, decisionCandidate, decisionRecordCandidate, formalCommitmentCandidate, formalComplaintCandidate, hotLeadCandidate, integrationCandidates,
  kycBlockerCandidate, opportunityCandidate, taskCandidate,
} from "./mappers";

/**
 * The existing records that feed the Attention Engine, read-only. Each source runs ONLY when the viewer's role may see the kinds it
 * produces (the engine filters again), reads the viewer's own scope (an RM's customers, a manager's team, everything for an admin),
 * and is capped. A source that fails is reported and skipped: one broken table never blanks the whole feed.
 *
 * Decision Engine (workstream A, integrated in Wave 2): `decisionCandidates` reads the stored, open RECOMMEND decisions (intelligence/decision/attention-read.ts) and falls back to
 * the next-best-action row on CustomerIntelligence for a customer that has no open decision (or while the engine is off). Shadow decisions follow the engine's own visibility rule: managers
 * and admins within their scope, an RM only with NBA_RM_VISIBLE.
 * Service state (workstream B, integrated in Wave 2): formal complaints and overdue, person-confirmed promises come from the Complaint and Commitment models (service/read.ts) and replace the
 * conversation insight they were registered from, so a case is never shown twice.
 * SEAM (approvals, Wave 1): `approvalSource` reads ApprovalRequest directly; at integration it reads the canonical approvals inbox.
 */

const D = 86_400_000;
const CAP = 60;

export type SourceResult = { candidates: AttentionCandidate[]; errors: string[] };
type Source = { name: string; kinds: readonly AttentionKind[]; run: (scope: Scope, now: Date, ctx: LoadContext) => Promise<AttentionCandidate[]> };
/**
 * A source that lives in another module and is handed in by the caller. Campaign anomalies come this way: they read ad-spend rows, and
 * customer-side code must not import the marketing module (loader-segregation.test.ts), so the Marketing page passes its own source in.
 */
export type ExtraSource = { name: string; kinds: readonly AttentionKind[]; run: (scope: Scope, now: Date) => Promise<AttentionCandidate[]> };
type LoadContext = { clientWhere: { isDeleted: false; assignedToId?: { in: string[] } }; value: (clientId: string) => number | null };

const clientRef = { select: { id: true, name: true, assignedToId: true } } as const;

async function valueMap(clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const rows = await prisma.opportunity.groupBy({ by: ["clientId"], where: { clientId: { in: clientIds }, stage: { not: "LOST_DEFERRED" } }, _max: { estimatedValue: true } });
  return new Map(rows.map((r) => [r.clientId, r._max.estimatedValue ? Number(r._max.estimatedValue) : 0]));
}

const sources: Source[] = [
  {
    name: "conversation insights",
    kinds: ["complaint", "overdue_commitment"],
    run: async (scope, now, ctx) => {
      // An insight already registered as a formal complaint or promise is shown from the case (confirmed), not from the insight (unconfirmed).
      const linked = (await loadServiceAttentionFacts(ctx.clientWhere, now, 1)).linkedInsightIds;
      const rows = await prisma.conversationInsight.findMany({
        where: { status: "OPEN", ...(linked.length ? { id: { notIn: linked } } : {}), client: ctx.clientWhere, OR: [{ kind: { in: ["COMPLAINT", "COMPLIANCE_CONCERN"] } }, { kind: "COMMITMENT", dueAt: { lt: now } }] },
        select: { id: true, kind: true, severity: true, occurredAt: true, dueAt: true, client: clientRef },
        orderBy: { occurredAt: "desc" },
        take: CAP,
      });
      return rows.map((r) =>
        r.kind === "COMMITMENT"
          ? commitmentCandidate({ id: r.id, dueAt: r.dueAt!, occurredAt: r.occurredAt, client: r.client }, now, bandForValue(ctx.value(r.client.id)))
          : complaintCandidate({ id: r.id, kind: r.kind as "COMPLAINT" | "COMPLIANCE_CONCERN", severity: r.severity, occurredAt: r.occurredAt, client: r.client }, now, bandForValue(ctx.value(r.client.id))),
      );
    },
  },
  {
    name: "formal complaints and promises",
    kinds: ["complaint", "overdue_commitment"],
    run: async (_scope, now, ctx) => {
      const f = await loadServiceAttentionFacts(ctx.clientWhere, now, CAP);
      return [
        ...f.complaints.map((c) => formalComplaintCandidate(c, now, bandForValue(ctx.value(c.client.id)))),
        ...f.commitments.map((m) => formalCommitmentCandidate(m, now, bandForValue(ctx.value(m.client.id)))),
      ];
    },
  },
  {
    name: "KYC blockers",
    kinds: ["kyc_blocker"],
    run: async (_scope, now, ctx) => {
      const rows = await prisma.exception.findMany({ where: { status: "OPEN", client: { ...ctx.clientWhere, status: "ACTIVE" } }, select: { id: true, createdAt: true, client: clientRef }, orderBy: { createdAt: "asc" }, take: CAP });
      return rows.map((r) => kycBlockerCandidate(r, now, bandForValue(ctx.value(r.client.id))));
    },
  },
  {
    name: "hot leads",
    kinds: ["hot_lead"],
    run: async (_scope, now, ctx) => {
      const rows = await prisma.client.findMany({
        where: { ...ctx.clientWhere, status: "ACTIVE", priority: "HIGH", createdAt: { gte: new Date(now.getTime() - 14 * D) }, activities: { none: { type: { in: ["CALL", "CONTACT", "MESSAGE", "MEETING"] } } } },
        select: { id: true, name: true, assignedToId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: CAP,
      });
      return rows.map((r) => hotLeadCandidate({ id: r.id, createdAt: r.createdAt, client: r }, now, bandForValue(ctx.value(r.id))));
    },
  },
  {
    name: "opportunities",
    kinds: ["customer_opportunity"],
    run: async (_scope, now, ctx) => {
      const rows = await prisma.opportunity.findMany({ where: { stage: { in: ["INTERESTED", "RECOMMENDATION", "DECISION_PENDING"] }, client: ctx.clientWhere }, select: { id: true, stage: true, stageEnteredAt: true, ownerId: true, estimatedValue: true, client: clientRef }, orderBy: { stageEnteredAt: "asc" }, take: CAP });
      return rows.map((r) => opportunityCandidate(r, now, bandForValue(Number(r.estimatedValue))));
    },
  },
  {
    name: "decision candidates",
    kinds: ["customer_opportunity"],
    run: async (scope, now, ctx) => decisionCandidates(scope, now, ctx),
  },
  {
    name: "tasks",
    kinds: ["task"],
    run: async (scope, now, ctx) => {
      const rows = await prisma.task.findMany({
        where: { status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: new Date(now.getTime() + 4 * 3_600_000) }, client: { isDeleted: false }, ...(scope.visibleUserIds ? { assignedToId: { in: scope.visibleUserIds } } : {}) },
        select: { id: true, title: true, dueAt: true, category: true, assignedToId: true, client: { select: { id: true, name: true, assignedToId: true, priority: true } } },
        orderBy: { dueAt: "asc" },
        take: CAP * 2,
      });
      return rows.map((r) => taskCandidate(r, now, bandForValue(ctx.value(r.client.id))));
    },
  },
  {
    name: "failures and alerts",
    kinds: ["failed_integration", "agent_failure"],
    run: async (_scope, now) => {
      const [items, alerts] = await Promise.all([
        loadFailureItems(now).then((i) => groupFailures(i)),
        prisma.controlPlaneAlert.findMany({ where: { resolvedAt: null, acknowledgedAt: null }, select: { id: true, key: true, severity: true, title: true, firstRaisedAt: true }, orderBy: { firstRaisedAt: "asc" }, take: 30 }),
      ]);
      const failures = items.map((g) => ({ key: g.key, source: g.source, group: g.group, label: g.label, reason: g.reason, lastSeen: g.lastSeen, count: g.count, stillFailing: g.stillFailing, agent: jobSpec(g.group)?.owner === "Agents" || g.source === "agent-proposal" }));
      return integrationCandidates(failures, alerts, now);
    },
  },
  {
    name: "approvals",
    kinds: ["approval"],
    run: async (_scope, now) => {
      const rows = await prisma.approvalRequest.findMany({ where: { status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, actionType: true, requestedAt: true }, orderBy: { requestedAt: "asc" }, take: 30 });
      return rows.map((r) => approvalCandidate(r, now));
    },
  },
  {
    name: "data quality",
    kinds: ["data_quality"],
    run: async (scope, now, ctx) => {
      const out: AttentionCandidate[] = [];
      const merges = await prisma.mergeSuggestion.aggregate({ where: { status: "OPEN", clientA: ctx.clientWhere }, _count: { _all: true }, _min: { createdAt: true } });
      if (merges._count._all > 0) out.push(dataQualityCandidate({ ref: `merge-suggestions:${scope.userId}`, ownerUserId: scope.userId, title: `${merges._count._all} possible duplicate customer${merges._count._all === 1 ? "" : "s"} to review`, detail: "Matching phone, email or PAN between two records.", count: merges._count._all, since: merges._min.createdAt ?? now, href: "/clients/duplicates" }));
      if (scope.role === "ADMIN") {
        const unowned = await prisma.client.aggregate({ where: { isDeleted: false, status: "ACTIVE", assignedToId: null }, _count: { _all: true }, _min: { createdAt: true } });
        if (unowned._count._all > 0) out.push(dataQualityCandidate({ ref: "unowned-customers", ownerUserId: null, title: `${unowned._count._all} active customer${unowned._count._all === 1 ? " has" : "s have"} no owner`, detail: "Assign an RM so they appear in someone's day.", count: unowned._count._all, since: unowned._min.createdAt ?? now, href: "/clients?assigned=none" }));
      }
      return out;
    },
  },
];

/** Decision candidates, as AttentionCandidates: stored decisions first, the next-best-action row for every customer that has none. */
async function decisionCandidates(scope: Scope, now: Date, ctx: LoadContext): Promise<AttentionCandidate[]> {
  // Shadow decisions are not shown to RMs unless the owner switched that on (the same rule as the Evidence Drawer and the review list).
  const mayShowDecisions = scope.role !== "RM" || process.env.NBA_RM_VISIBLE === "1";
  const decisions = mayShowDecisions ? await loadOpenRecommendations(ctx.clientWhere, now) : [];
  const covered = new Set(decisions.map((d) => d.clientId));
  const rows = await prisma.customerIntelligence.findMany({
    where: { nbaPriority: "High", nbaAction: { not: "No Action" }, client: { ...ctx.clientWhere, status: "ACTIVE" }, ...(covered.size ? { clientId: { notIn: [...covered] } } : {}) },
    select: { clientId: true, nbaAction: true, nbaTopic: true, priorityScore: true, computedAt: true, client: clientRef },
    orderBy: { priorityScore: "desc" },
    take: 30,
  });
  return [
    ...decisions.map((d) => decisionRecordCandidate(d, bandForValue(ctx.value(d.clientId)))),
    ...rows.map((r) => decisionCandidate({ clientId: r.clientId, clientName: r.client.name, ownerId: r.client.assignedToId, action: r.nbaAction, topic: r.nbaTopic, priorityScore: r.priorityScore, computedAt: r.computedAt }, bandForValue(ctx.value(r.clientId)))),
  ];
}

/** Every candidate this viewer may be shown. Never throws: a failing source is listed in `errors`. */
export async function loadCandidates(scope: Scope, now: Date, extra: readonly ExtraSource[] = []): Promise<SourceResult> {
  const allowed = new Set(allowedKinds(scope.role));
  const active = [...sources, ...extra.map((e): Source => ({ ...e, run: (sc, n) => e.run(sc, n) }))].filter((s) => s.kinds.some((k) => allowed.has(k)));
  const errors: string[] = [];
  const clientWhere = scope.visibleUserIds ? ({ isDeleted: false, assignedToId: { in: scope.visibleUserIds } } as const) : ({ isDeleted: false } as const);
  // Customer value is read once for every customer any customer-facing source may touch.
  const customerSide = active.some((s) => s.kinds.some((k) => ["complaint", "overdue_commitment", "kyc_blocker", "hot_lead", "customer_opportunity", "task"].includes(k)));
  let values = new Map<string, number>();
  if (customerSide) {
    try {
      const ids = await prisma.client.findMany({ where: clientWhere, select: { id: true }, take: 5000 });
      values = await valueMap(ids.map((c) => c.id));
    } catch {
      errors.push("customer value");
    }
  }
  const ctx: LoadContext = { clientWhere, value: (id) => values.get(id) ?? null };
  const results = await Promise.all(
    active.map(async (s) => {
      try {
        return await s.run(scope, now, ctx);
      } catch {
        errors.push(s.name);
        return [] as AttentionCandidate[];
      }
    }),
  );
  return { candidates: results.flat(), errors };
}

/** Open workload per person: pending and overdue tasks. The capacity input. */
export async function loadWorkloads(userIds: string[]): Promise<Record<string, { openWorkload: number }>> {
  if (userIds.length === 0) return {};
  const rows = await prisma.task.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: userIds }, status: { in: ["PENDING", "OVERDUE"] } }, _count: { _all: true } });
  const out: Record<string, { openWorkload: number }> = {};
  for (const id of userIds) out[id] = { openWorkload: 0 };
  for (const r of rows) out[r.assignedToId] = { openWorkload: r._count._all };
  return out;
}
