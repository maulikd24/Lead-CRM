import { can } from "@/lib/access/policy";
import { pseudonymize } from "@/lib/access/pseudonym";

import { assembleLedger, pageEntries, type AssembleContext } from "./assemble";
import type { Bundle } from "./bundle";
import { findApproval, findByCorrelation, findRun, loadClientBundle, loadCampaignBundle, loadCorrelationBundle } from "./load";
import { approvalVisibleTo, authoriseClient, hrefFor } from "./scope";
import { LEDGER_KINDS, isLedgerKind, type LedgerEntry, type LedgerKind, type LedgerOptions, type LedgerQueryStats, type LedgerResult, type LedgerSubject } from "./types";

/**
 * getActionLedger(subject, options): THE reader that answers "why did Allvest do this?". One read model over the records that already exist (see types.ts and
 * assemble.ts); nothing is stored for it. It checks access for itself, so a caller cannot forget:
 *  - client: needs `action-ledger` and a customer the viewer may open (RM own customers, manager their team, admin all; anything else is "not found"). Decision records
 *    appear only to a viewer who may see decisions. Approvals appear per kind.
 *  - campaign: MARKETING (and admin) only: autopilot chains and aggregated counts; a customer is a pseudonym, never named.
 *  - correlation, agentRun, approval: ADMIN only (`action-ledger-investigate`), the audit and debugging tool.
 * Read only: it never writes, never refreshes intelligence, never fires a journey.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const stat = (...s: LedgerQueryStats[]): LedgerQueryStats => ({ queries: s.reduce((a, b) => a + b.queries, 0), rowsRead: s.reduce((a, b) => a + b.rowsRead, 0) });
const limitOf = (n: number | undefined) => Math.min(MAX_LIMIT, Math.max(1, Math.floor(n ?? DEFAULT_LIMIT)));

function finish(entries: LedgerEntry[], o: LedgerOptions, limit: number, stats: LedgerQueryStats, capped: boolean, hiddenDecisions: boolean): LedgerResult {
  const counts: Partial<Record<LedgerKind, number>> = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const kinds = o.kinds?.filter(isLedgerKind);
  const filtered = kinds && kinds.length && kinds.length < LEDGER_KINDS.length ? entries.filter((e) => kinds.includes(e.kind)) : entries;
  const { page, nextCursor, olderNotShown } = pageEntries(filtered, { limit, before: o.before });
  return { ok: true, entries: page, nextCursor, olderNotShown: olderNotShown || (capped && !nextCursor && page.length >= limit), stats, counts, hidden: { decisions: hiddenDecisions } };
}

export async function getActionLedger(subject: LedgerSubject, options: LedgerOptions): Promise<LedgerResult> {
  const { viewer } = options;
  const now = options.now ?? new Date();
  const limit = limitOf(options.limit);

  if (subject.type === "client") {
    const { access, queries } = await authoriseClient(viewer, subject.id);
    if (!access.ok) return access;
    const ctx: AssembleContext = { now, canSeeDecisions: access.canSeeDecisions, approvalVisible: (t) => approvalVisibleTo(viewer.role, t), href: hrefFor(viewer.role) };
    const { bundle, stats, capped } = await loadClientBundle(subject.id, { limit, before: options.before, includeDecisions: access.canSeeDecisions });
    return finish(assembleLedger(bundle, ctx), options, limit, stat(stats, { queries, rowsRead: 0 }), capped, !access.canSeeDecisions);
  }

  if (subject.type === "campaign") {
    if (!can(viewer.role, "action-ledger-campaigns", "view")) return { ok: false, reason: "forbidden" };
    const loaded = await loadCampaignBundle({ limit, before: options.before, campaignId: subject.id });
    const ctx: AssembleContext = { now, canSeeDecisions: false, approvalVisible: (t) => approvalVisibleTo(viewer.role, t), href: () => null };
    const chains = assembleLedger(loaded.bundle, ctx).map((e) => ({ ...e, sources: e.sources.map((s) => ({ ...s, href: null })) }));
    const aggregates = loaded.aggregates.map((g) => aggregateEntry(g));
    const all = [...chains, ...aggregates].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    return finish(all, options, limit, loaded.stats, loaded.capped, true);
  }

  // The investigation subjects are for ADMIN only.
  if (!can(viewer.role, "action-ledger-investigate", "view")) return { ok: false, reason: "forbidden" };
  const ctx: AssembleContext = { now, canSeeDecisions: true, approvalVisible: () => true, href: hrefFor(viewer.role) };

  let correlationId: string | null = null;
  let clientIds: string[] = [];
  let mustContain: string | null = null;
  const parts: LedgerQueryStats[] = [];
  if (subject.type === "correlation") {
    correlationId = subject.id;
    const found = await findByCorrelation(subject.id);
    clientIds = found.clientIds;
    parts.push(found.stats);
  } else if (subject.type === "agentRun") {
    const run = await findRun(subject.id);
    if (!run) return { ok: false, reason: "not_found" };
    parts.push(run.stats);
    correlationId = run.correlationId;
    clientIds = run.clientId ? [run.clientId] : [];
    mustContain = `AgentRun:${subject.id}`;
  } else {
    const found = await findApproval(subject.id);
    if (!found) return { ok: false, reason: "not_found" };
    parts.push(found.stats);
    correlationId = found.correlationId;
    clientIds = found.clientId ? [found.clientId] : [];
    mustContain = `${found.table}:${found.id}`;
  }

  const entries: LedgerEntry[] = [];
  let capped = false;
  const bundles: Bundle[] = [];
  for (const id of clientIds.slice(0, 5)) {
    const loaded = await loadClientBundle(id, { limit: 100, includeDecisions: true });
    parts.push(loaded.stats);
    capped ||= loaded.capped;
    bundles.push(loaded.bundle);
  }
  if (!clientIds.length && correlationId) {
    const loaded = await loadCorrelationBundle(correlationId);
    parts.push(loaded.stats);
    bundles.push(loaded.bundle);
  }
  for (const b of bundles) entries.push(...assembleLedger(b, ctx));
  const relevant = entries.filter((e) => (mustContain ? e.sources.some((s) => `${s.table}:${s.id}` === mustContain) || (correlationId !== null && e.correlationIds.includes(correlationId)) : correlationId !== null && e.correlationIds.includes(correlationId)));
  relevant.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return finish(relevant, options, limit, stat(...parts), capped, false);
}

function aggregateEntry(g: { type: string; day: string; count: number; clientIds: string[] }): LedgerEntry {
  const pseudonyms = g.clientIds.slice(0, 5).map((id) => pseudonymize(id));
  const label = `${g.count} ${g.type.replace(/^campaign\./, "").replace(/[._]/g, " ")} on ${g.day} (aggregated)`;
  return {
    id: `aggregate:${g.type}:${g.day}`, kind: "campaign", at: `${g.day}T23:59:59.000Z`, action: { label, subject: { table: "aggregate", id: `${g.type}:${g.day}`, label: "Aggregated count", href: null } },
    trigger: null, decision: null, evidence: [], initiatedBy: { type: "system", id: null, label: "System" }, executedBy: { type: "system", id: null, label: "System" }, ai: null,
    approval: { state: "not_required", label: "Not required", by: null, at: null, kind: null, reason: null, source: null }, result: { label: `${g.count} recorded`, tone: "neutral", at: null },
    followOn: [], chain: [], correlationIds: [], confidence: "certain", score: 1, inferredLinks: [], sources: [], aggregate: { count: g.count, pseudonyms },
  };
}
