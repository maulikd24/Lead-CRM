import { ACTION_TYPES, LEVEL_LABEL, effectiveLevel, isActionType, type AutonomyLevel } from "@/lib/agents/autonomy";
import { getAgent } from "@/lib/agents/registry";
import { flowCorrelationId } from "@/lib/events/envelope";
import { definitionOf, isKind } from "@/lib/policy/approvals/canonical/definitions";

import type { ApprovalRow, Bundle, ComplaintRow, DecisionRow, EventRow, MessageRow, ProposalRow, RunRow, StageRow, TaskRow, ConsentRow, AuditRow } from "./bundle";
import { HEURISTICS, withinWindow, type Heuristic } from "./heuristics";
import type { Actor, ApprovalState, ChainStep, Confidence, LedgerAi, LedgerApproval, LedgerDecision, LedgerEntry, LedgerEvidence, LedgerKind, Phase, Person, SourceLink } from "./types";
import { PHASES } from "./types";

/**
 * assembleLedger: the pure half of the Action Ledger. Bundle in (plain rows the loaders read), entries out. No database, no clock but `ctx.now`.
 *
 * How records are joined, in order of trust:
 *  1. CERTAIN, "same action" (the records are one action seen in different tables): an event's `ref` or `decisionId`, `causation_id` between events, a shared
 *     SPECIFIC correlation id (never the customer-wide flow id, which every event of a customer carries and would glue the whole history together), a foreign key
 *     (draft to decision, draft to message, a task that names its decision), the canonical approval's audit row.
 *  2. CERTAIN, "follows" (a later action that names an earlier one: a task that names its complaint): two entries, linked.
 *  3. INFERRED (heuristics.ts): customer plus a time window. Marked `inferred`, lower score, plain-words reason.
 */

export type AssembleContext = {
  now: Date;
  /** The viewer may see Decision Engine records (the registry area and, for an RM, NBA_RM_VISIBLE). When false, every decision, its events and its evidence are left out. */
  canSeeDecisions: boolean;
  /** The viewer may see approvals of this action type (per approval kind, from the central policy). */
  approvalVisible: (actionType: string) => boolean;
  /** Where a source record can be opened by THIS viewer, or null. */
  href?: (table: string, id: string, clientId: string | null) => string | null;
};

type Tag = "event" | "decision" | "run" | "proposal" | "approval" | "audit" | "message" | "task" | "consent" | "complaint" | "stage";
type Node =
  | { key: string; tag: "event"; at: Date; row: EventRow }
  | { key: string; tag: "decision"; at: Date; row: DecisionRow }
  | { key: string; tag: "run"; at: Date; row: RunRow }
  | { key: string; tag: "proposal"; at: Date; row: ProposalRow }
  | { key: string; tag: "approval"; at: Date; row: ApprovalRow }
  | { key: string; tag: "audit"; at: Date; row: AuditRow }
  | { key: string; tag: "message"; at: Date; row: MessageRow }
  | { key: string; tag: "task"; at: Date; row: TaskRow }
  | { key: string; tag: "consent"; at: Date; row: ConsentRow }
  | { key: string; tag: "complaint"; at: Date; row: ComplaintRow }
  | { key: string; tag: "stage"; at: Date; row: StageRow };

const TABLE: Record<Tag, string> = { event: "CustomerEvent", decision: "DecisionRecord", run: "AgentRun", proposal: "AgentProposal", approval: "ApprovalRequest", audit: "AuditLog", message: "Message", task: "Task", consent: "ConsentRecord", complaint: "Complaint", stage: "StageHistory" };
const key = (table: string, id: string) => `${table}:${id}`;

type Follows = { from: string; to: string; confidence: Confidence; basis: "foreign_key" | "subject_time_window"; heuristic: Heuristic | null; because: string; score: number };
type Inferred = { node: string; because: string; score: number; supporting: boolean };

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const words = (v: string) => v.toLowerCase().replace(/[_-]+/g, " ");
const sentence = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v);
const clip = (v: string, max = 140) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "email", call: "call" };
const channelName = (c: string | null | undefined) => (c ? CHANNEL[c.toLowerCase()] ?? words(c) : "message");
const iso = (d: Date) => d.toISOString();

/** A task made by a job or a rule says so in `source`; only a task with no origin (manual, or none) may be guessed to follow something. */
const TASK_ORIGIN_LABEL: Record<string, string> = { nba: "Accepted recommendation", complaint: "Complaint follow-up", commitment: "Promise to the customer", outcome: "Interaction outcome", handover: "AI hand-over to a person", "kyc-step": "KYC drop-off job", "lead-intake": "Lead intake", journey: "Journey", "stage-engine": "Stage engine", "identity-conflict": "Identity conflict check", jira: "Jira" };
const taskOrigin = (source: string | null): { prefix: string; id: string | null } | null => {
  const m = source ? /^([a-z-]+)(?::(.+))?$/.exec(source) : null;
  return m && m[1] !== "manual" ? { prefix: m[1], id: m[2] ?? null } : null;
};

export function assembleLedger(bundle: Bundle, ctx: AssembleContext): LedgerEntry[] {
  const users = bundle.users;
  const userActor = (id: string | null | undefined): Actor | null => (id ? { type: "user", id, label: users.get(id) ?? "Staff member" } : null);
  const person = (id: string | null | undefined): Person | null => (id ? { id, name: users.get(id) ?? null } : null);
  const href = (table: string, id: string, clientId: string | null) => ctx.href?.(table, id, clientId) ?? null;
  const link = (table: string, id: string, label: string, clientId: string | null = bundle.clientId): SourceLink => ({ table, id, label, href: href(table, id, clientId) });

  // ---- nodes ------------------------------------------------------------------------------------------------------------------------------
  const nodes = new Map<string, Node>();
  const add = (n: Node) => nodes.set(n.key, n);
  for (const r of bundle.events) {
    if (!ctx.canSeeDecisions && (r.eventType.startsWith("nba.") || asObj(asObj(r.metadata).ref).table === "DecisionRecord")) continue;
    add({ key: key("CustomerEvent", r.id), tag: "event", at: r.occurredAt, row: r });
  }
  if (ctx.canSeeDecisions) for (const r of bundle.decisions) add({ key: key("DecisionRecord", r.id), tag: "decision", at: r.createdAt, row: r });
  for (const r of bundle.runs) add({ key: key("AgentRun", r.id), tag: "run", at: r.createdAt, row: r });
  for (const r of bundle.proposals) add({ key: key("AgentProposal", r.id), tag: "proposal", at: r.createdAt, row: r });
  for (const r of bundle.approvals) add({ key: key("ApprovalRequest", r.id), tag: "approval", at: r.requestedAt, row: r });
  for (const r of bundle.audits) add({ key: key("AuditLog", r.id), tag: "audit", at: r.timestamp, row: r });
  for (const r of bundle.messages) add({ key: key("Message", r.id), tag: "message", at: r.createdAt, row: r });
  for (const r of bundle.tasks) add({ key: key("Task", r.id), tag: "task", at: r.createdAt, row: r });
  for (const r of bundle.consents) add({ key: key("ConsentRecord", r.id), tag: "consent", at: r.capturedAt, row: r });
  for (const r of bundle.complaints) add({ key: key("Complaint", r.id), tag: "complaint", at: r.openedAt, row: r });
  for (const r of bundle.stages) add({ key: key("StageHistory", r.id), tag: "stage", at: r.changedAt, row: r });
  const has = (k: string) => nodes.has(k);

  // ---- union-find over "same action" links -----------------------------------------------------------------------------------------------
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let p = parent.get(k) ?? k;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(k, p);
    return p;
  };
  const union = (a: string, b: string) => {
    if (!has(a) || !has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const inferredNodes = new Map<string, Inferred>();
  const follows: Follows[] = [];

  // lookups for event refs
  const complaintByInsight = new Map(bundle.complaints.filter((c) => c.insightId).map((c) => [c.insightId as string, key("Complaint", c.id)]));
  const complaintByTicket = new Map(bundle.complaints.filter((c) => c.supportTicketId).map((c) => [c.supportTicketId as string, key("Complaint", c.id)]));
  const decisionByOutcome = new Map<string, string>();
  for (const d of ctx.canSeeDecisions ? bundle.decisions : []) for (const o of d.outcomes) decisionByOutcome.set(o.id, key("DecisionRecord", d.id));
  const refTarget = (table: string, id: string): string | null => {
    if (table === "ConversationInsight") return complaintByInsight.get(id) ?? null;
    if (table === "SupportTicket") return complaintByTicket.get(id) ?? null;
    if (table === "DecisionOutcome") return decisionByOutcome.get(id) ?? null;
    const k = key(table, id);
    return has(k) ? k : null;
  };

  const flowIds = new Set<string>();
  if (bundle.clientId) flowIds.add(flowCorrelationId(bundle.clientId));
  for (const e of bundle.events) if (e.clientId) flowIds.add(flowCorrelationId(e.clientId));

  const eventByEventId = new Map(bundle.events.map((e) => [e.eventId, key("CustomerEvent", e.id)]));
  const eventRefTarget = new Map<string, string>(); // event node key -> the domain node it stands for (so it is a source, not a second step)
  const byRecommendation = new Map<string, string[]>();
  for (const e of bundle.events) {
    const ek = key("CustomerEvent", e.id);
    if (!has(ek)) continue;
    const m = asObj(e.metadata);
    const ref = asObj(m.ref);
    const target = typeof ref.table === "string" && typeof ref.id === "string" ? refTarget(ref.table, ref.id) : null;
    if (target) { union(ek, target); eventRefTarget.set(ek, target); }
    const decisionId = str(m.decisionId);
    if (decisionId && has(key("DecisionRecord", decisionId))) union(ek, key("DecisionRecord", decisionId));
    if (e.causationId) { const c = eventByEventId.get(e.causationId); if (c) union(ek, c); }
    const rec = str(m.recommendationId);
    if (rec) byRecommendation.set(rec, [...(byRecommendation.get(rec) ?? []), ek]);
  }
  for (const group of byRecommendation.values()) for (const k of group.slice(1)) union(group[0], k);

  // specific correlation ids
  const corrOf = new Map<string, string[]>();
  const corrAdd = (c: string | null | undefined, k: string) => { if (c && !flowIds.has(c)) corrOf.set(c, [...(corrOf.get(c) ?? []), k]); };
  for (const n of nodes.values()) {
    if (n.tag === "event" || n.tag === "run" || n.tag === "approval" || n.tag === "decision") corrAdd(n.row.correlationId, n.key);
    if (n.tag === "audit") corrAdd(str(asObj(n.row.newValue).correlationId), n.key);
  }
  for (const group of corrOf.values()) for (const k of group.slice(1)) union(group[0], k);

  // foreign keys
  for (const p of bundle.proposals) {
    if (p.nbaDecisionId) union(key("AgentProposal", p.id), key("DecisionRecord", p.nbaDecisionId));
    if (p.messageId) union(key("AgentProposal", p.id), key("Message", p.messageId));
  }
  for (const a of bundle.approvals) {
    if (!a.mirror) continue;
    const target = a.mirror.kind === "agent-proposal" ? key("AgentProposal", a.mirror.subjectId) : null;
    if (target && has(target)) union(key("ApprovalRequest", a.id), target);
  }
  for (const r of bundle.runs) {
    const ref = r.approvalRef;
    if (!ref) continue;
    const i = ref.indexOf(":");
    const target = i > 0 ? (ref.slice(0, i) === "agent-proposal" ? key("AgentProposal", ref.slice(i + 1)) : key("ApprovalRequest", ref.slice(i + 1))) : key("ApprovalRequest", ref);
    union(key("AgentRun", r.id), target);
  }
  for (const a of bundle.audits) {
    const ak = key("AuditLog", a.id);
    if (a.entity === "Approval") {
      const i = a.entityId.indexOf(":");
      const kind = i > 0 ? a.entityId.slice(0, i) : "";
      const id = i > 0 ? a.entityId.slice(i + 1) : a.entityId;
      union(ak, kind === "agent-proposal" ? key("AgentProposal", id) : key("ApprovalRequest", id));
    } else if (a.entity === "Task" || a.entity === "DecisionRecord" || a.entity === "Complaint") union(ak, key(a.entity, a.entityId));
  }
  for (const t of bundle.tasks) {
    const o = taskOrigin(t.source);
    if (o?.prefix === "nba" && o.id) union(key("Task", t.id), key("DecisionRecord", o.id));
    if (o?.prefix === "complaint" && o.id && has(key("Complaint", o.id))) follows.push({ from: key("Complaint", o.id), to: key("Task", t.id), confidence: "certain", basis: "foreign_key", heuristic: null, because: "The task names the complaint it follows.", score: 1 });
  }
  for (const c of bundle.complaints) if (c.taskId && has(key("Task", c.taskId))) follows.push({ from: key("Complaint", c.id), to: key("Task", c.taskId), confidence: "certain", basis: "foreign_key", heuristic: null, because: "The complaint names this task.", score: 1 });
  for (const d of ctx.canSeeDecisions ? bundle.decisions : []) for (const o of d.outcomes) if (has(key("Message", o.eventRef))) union(key("DecisionRecord", d.id), key("Message", o.eventRef));

  // ---- heuristics (each labelled; see heuristics.ts) -----------------------------------------------------------------------------------------
  // H1: a model run to the draft it produced. Only runs that no id already ties to something else.
  const usedRuns = new Set<string>();
  for (const p of [...bundle.proposals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const pk = key("AgentProposal", p.id);
    const h = HEURISTICS.run_to_draft;
    const pool = bundle.runs.filter((r) => r.agentKey === p.agentKey && r.subjectType === "client" && r.subjectId === p.clientId && !usedRuns.has(r.id) && find(key("AgentRun", r.id)) !== find(pk) && withinWindow(r.createdAt, p.createdAt, h.windowMs, 60_000));
    if (!pool.length) continue;
    const clusters = new Map<string, RunRow[]>();
    for (const r of pool) clusters.set(r.correlationId, [...(clusters.get(r.correlationId) ?? []), r]);
    const best = [...clusters.values()].sort((a, b) => Math.max(...b.map((r) => r.createdAt.getTime())) - Math.max(...a.map((r) => r.createdAt.getTime())))[0];
    for (const r of bundle.runs.filter((x) => x.correlationId === best[0].correlationId)) {
      usedRuns.add(r.id);
      inferredNodes.set(key("AgentRun", r.id), { node: key("AgentRun", r.id), because: h.because, score: h.score, supporting: true });
      union(pk, key("AgentRun", r.id));
    }
  }
  // H4: the audit row written with a stage change.
  for (const s of bundle.stages) {
    const h = HEURISTICS.audit_to_stage;
    for (const a of bundle.audits) {
      if (a.entity !== "Client" || a.entityId !== s.clientId || a.userId !== s.changedById || !/^stage/.test(a.action)) continue;
      if (Math.abs(a.timestamp.getTime() - s.changedAt.getTime()) > h.windowMs) continue;
      inferredNodes.set(key("AuditLog", a.id), { node: key("AuditLog", a.id), because: h.because, score: h.score, supporting: true });
      union(key("StageHistory", s.id), key("AuditLog", a.id));
    }
  }

  // ---- components, anchors ---------------------------------------------------------------------------------------------------------------------
  const comps = new Map<string, Node[]>();
  for (const n of nodes.values()) comps.set(find(n.key), [...(comps.get(find(n.key)) ?? []), n]);
  for (const list of comps.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));

  const isCampaignEvent = (n: Node) => n.tag === "event" && /^campaign\.autopilot\./.test(n.row.eventType);
  const nativeApproval = (n: Node) => n.tag === "approval" && !n.row.mirror;
  const decisionQualifies = (n: Node) => n.tag === "decision" && (n.row.result !== "RECOMMEND" || n.row.feedback.length > 0);
  const RANK: ((n: Node) => boolean)[] = [
    (n) => n.tag === "message" && n.row.direction === "OUTBOUND",
    (n) => n.tag === "task",
    (n) => n.tag === "consent",
    (n) => n.tag === "stage",
    (n) => nativeApproval(n) && ctx.approvalVisible((n as Extract<Node, { tag: "approval" }>).row.actionType),
    (n) => n.tag === "complaint",
    (n) => n.tag === "proposal",
    decisionQualifies,
    isCampaignEvent,
  ];
  type Anchored = { id: string; nodes: Node[]; anchor: Node; rank: number };
  const anchored: Anchored[] = [];
  for (const [id, list] of comps) {
    for (let rank = 0; rank < RANK.length; rank++) {
      const pool = list.filter(RANK[rank]);
      if (!pool.length) continue;
      // The message that went out, the last campaign step; otherwise the first.
      const anchor = rank === RANK.length - 1 ? [...pool].sort((a, b) => b.at.getTime() - a.at.getTime())[0] : pool[0];
      anchored.push({ id, nodes: list, anchor, rank });
      break;
    }
  }
  const anchoredByComp = new Map(anchored.map((a) => [a.id, a]));
  const compOf = (k: string) => find(k);

  // H2: a task that follows a resolved complaint. H3: an RM message after a recommendation. Both link two ACTIONS, so they are "follows" links, never a merge.
  for (const c of bundle.complaints) {
    if (!c.resolvedAt) continue;
    const h = HEURISTICS.complaint_to_task;
    const ck = key("Complaint", c.id);
    for (const t of bundle.tasks) {
      const tk = key("Task", t.id);
      if (t.clientId !== c.clientId || taskOrigin(t.source) || follows.some((f) => f.to === tk) || find(tk) === find(ck)) continue;
      if (!withinWindow(c.resolvedAt, t.createdAt, h.windowMs, 60_000)) continue;
      const later = bundle.complaints.filter((o) => o.clientId === c.clientId && o.resolvedAt && o.resolvedAt <= t.createdAt && withinWindow(o.resolvedAt, t.createdAt, h.windowMs, 60_000)).sort((a, b) => (b.resolvedAt as Date).getTime() - (a.resolvedAt as Date).getTime())[0];
      if (later && later.id !== c.id) continue; // the nearest resolved complaint owns it
      follows.push({ from: ck, to: tk, confidence: "inferred", basis: "subject_time_window", heuristic: h, because: h.because, score: h.score });
    }
  }
  if (ctx.canSeeDecisions) {
    const h = HEURISTICS.decision_to_message;
    const taken = new Set<string>();
    for (const m of [...bundle.messages].filter((x) => x.direction === "OUTBOUND").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const mk = key("Message", m.id);
      const comp = comps.get(find(mk)) ?? [];
      if (comp.some((n) => n.tag === "decision" || n.tag === "proposal")) continue;
      const cands = bundle.decisions
        .filter((d) => d.clientId === m.clientId && d.result === "RECOMMEND" && !["DISMISSED", "EXPIRED"].includes(d.status) && !taken.has(d.id) && (!d.channel || d.channel.toLowerCase() === m.channel.toLowerCase()) && withinWindow(d.createdAt, m.createdAt, h.windowMs))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const d = cands[0];
      if (!d) continue;
      taken.add(d.id);
      follows.push({ from: key("DecisionRecord", d.id), to: mk, confidence: "inferred", basis: "subject_time_window", heuristic: h, because: h.because, score: h.score });
    }
  }

  // ---- entries ---------------------------------------------------------------------------------------------------------------------------------
  const flows = follows.filter((f) => has(f.from) && has(f.to));
  const describeAnchor = (a: Anchored) => labelOf(a);

  function labelOf(a: Anchored): { kind: LedgerKind; label: string } {
    const n = a.anchor;
    const comp = a.nodes;
    const proposal = comp.find((x): x is Extract<Node, { tag: "proposal" }> => x.tag === "proposal");
    switch (n.tag) {
      case "message": {
        const ch = channelName(n.row.channel);
        return { kind: "message", label: proposal ? `AI-drafted ${ch} message sent` : n.row.templateId ? `${sentence(ch)} template message sent` : `${sentence(ch)} message sent` };
      }
      case "task": return { kind: "task", label: `Task created: ${clip(n.row.title, 100)}` };
      case "consent": return { kind: "consent", label: `Consent ${words(n.row.status)}: ${words(n.row.purpose)}${n.row.channel ? ` (${channelName(n.row.channel)})` : ""}` };
      case "stage": return { kind: "stage", label: `Stage changed: ${n.row.fromStage ?? "none"} to ${n.row.toStage}` };
      case "approval": {
        const kindName = words(n.row.actionType).replace(/ /g, "-");
        const def = isKind(kindName) ? definitionOf(kindName) : null;
        const campaign = def?.group === "marketing" || /^(AUTOPILOT|AD_|LEAD_PUSH|SOCIAL)/.test(n.row.actionType);
        return { kind: campaign ? "campaign" : "approval", label: campaign ? `${def?.label ?? sentence(words(n.row.actionType))} ${approvalWord(n.row)}` : `${def?.label ?? sentence(words(n.row.actionType))}: ${approvalWord(n.row)}` };
      }
      case "complaint": return { kind: "service", label: n.row.resolvedAt ? "Complaint resolved" : `Complaint ${words(n.row.status)}` };
      case "proposal": return { kind: "draft", label: `AI-drafted ${channelName(n.row.channel)} message ${proposalWord(n.row, ctx.now)}` };
      case "decision": {
        const r = n.row;
        if (r.result === "NO_ACTION") return { kind: "decision", label: "No action taken: contact held back" };
        if (r.result === "ABSTAIN") return { kind: "decision", label: `Abstained: ${words(r.abstainReason ?? "not enough to decide")}` };
        return { kind: "decision", label: `Recommended: ${words(r.programme)}` };
      }
      case "event": {
        const last = n.row.eventType.split(".").pop() ?? "";
        return { kind: "campaign", label: `Ad recommendation ${last === "applied" ? "applied" : last === "approved" ? "approved" : "recommended"}` };
      }
      default: return { kind: "task", label: "Action" };
    }
  }

  const entryIdOf = (a: Anchored) => a.anchor.key;
  const entries: LedgerEntry[] = [];
  const labelsByComp = new Map(anchored.map((a) => [a.id, describeAnchor(a)]));

  for (const a of anchored) {
    const { kind, label } = labelsByComp.get(a.id) as { kind: LedgerKind; label: string };
    const comp = a.nodes;
    const anchor = a.anchor;
    const clientId = bundle.clientId ?? (comp.find((n) => "clientId" in n.row && (n.row as { clientId?: string | null }).clientId) as { row: { clientId?: string | null } } | undefined)?.row.clientId ?? null;
    const subject = subjectLink(anchor, link);

    const decisionNode = comp.find((n): n is Extract<Node, { tag: "decision" }> => n.tag === "decision");
    const proposal = comp.find((n): n is Extract<Node, { tag: "proposal" }> => n.tag === "proposal");
    const message = comp.find((n): n is Extract<Node, { tag: "message" }> => n.tag === "message" && n.row.direction === "OUTBOUND");
    const approvalNative = comp.filter((n): n is Extract<Node, { tag: "approval" }> => n.tag === "approval" && !n.row.mirror && ctx.approvalVisible(n.row.actionType));
    const runs = comp.filter((n): n is Extract<Node, { tag: "run" }> => n.tag === "run");
    const events = comp.filter((n): n is Extract<Node, { tag: "event" }> => n.tag === "event");
    const complaint = comp.find((n): n is Extract<Node, { tag: "complaint" }> => n.tag === "complaint");
    const entryFollows = flows.filter((f) => compOf(f.to) === a.id);
    const followedBy = flows.filter((f) => compOf(f.from) === a.id);

    // ---- chain ------------------------------------------------------------------------------------------------------------------------
    const chain: ChainStep[] = [];
    const push = (n: Node, phase: Phase, title: string, o: { at?: Date; detail?: string; table?: string; id?: string; sourceLabel?: string } = {}) => {
      const inf = inferredNodes.get(n.key);
      chain.push({
        id: `${n.key}#${phase}${o.id ? `:${o.id}` : ""}`, phase, at: iso(o.at ?? n.at), title, ...(o.detail ? { detail: o.detail } : {}),
        source: link(o.table ?? TABLE[n.tag], o.id ?? idOf(n), o.sourceLabel ?? sourceLabel(n), clientId),
        confidence: inf ? "inferred" : "certain", ...(inf ? { inferredBecause: inf.because } : {}), score: inf ? inf.score : 1,
      });
    };
    for (const n of comp) {
      switch (n.tag) {
        case "decision": {
          const r = n.row;
          push(n, "decision", `Decision engine ${r.engineVersion}: ${decisionResultWords(r)}`, { detail: clip(r.reason) });
          for (const f of r.feedback) push(n, "result", `Reviewer feedback: ${words(f.kind)}${f.reason ? ` (${words(f.reason)})` : ""}`, { at: f.createdAt, table: "DecisionFeedback", id: f.id, sourceLabel: "Decision feedback", detail: users.get(f.userId) ? `By ${users.get(f.userId)}` : undefined });
          for (const o of r.outcomes) push(n, "follow_on", `Customer ${words(o.kind)} ${o.daysAfter === 0 ? "the same day" : `${o.daysAfter} day${o.daysAfter === 1 ? "" : "s"} later`}`, { at: o.occurredAt, table: "DecisionOutcome", id: o.id, sourceLabel: "Decision outcome", detail: "Linked by the decision's outcome tracker. A correlation, not proof the decision caused it." });
          break;
        }
        case "run": push(n, "decision", `Model run: ${n.row.purposeId} (${words(n.row.status)})`, { detail: n.row.reasonCode ? words(n.row.reasonCode) : undefined }); break;
        case "proposal": {
          const r = n.row;
          push(n, "decision", `AI draft saved by ${r.agentKey}`, { detail: r.programme ? `Programme: ${words(r.programme)}` : undefined });
          const ap = proposalApproval(r, ctx.now, person);
          if (r.decidedAt || r.status !== "DRAFT") push(n, "approval", ap.label, { at: r.decidedAt ?? r.createdAt, id: `${r.id}:decision` });
          else push(n, "approval", ap.label, { at: r.createdAt, id: `${r.id}:decision` });
          break;
        }
        case "approval": {
          if (n.row.mirror) break;
          if (!ctx.approvalVisible(n.row.actionType)) break;
          const r = n.row;
          push(n, "approval", `Requested${users.get(r.requestedById) ? ` by ${users.get(r.requestedById)}` : ""}`, { id: `${r.id}:requested` });
          if (r.decidedAt) push(n, "approval", `${sentence(words(r.status))}${users.get(r.decidedById ?? "") ? ` by ${users.get(r.decidedById ?? "")}` : ""}`, { at: r.decidedAt, id: `${r.id}:decided` });
          if (r.appliedAt) push(n, "execution", "Applied", { at: r.appliedAt, id: `${r.id}:applied` });
          break;
        }
        case "audit": push(n, /^approval/.test(n.row.action) ? "approval" : "execution", `Audit: ${words(n.row.action)}${users.get(n.row.userId) ? ` by ${users.get(n.row.userId)}` : ""}`); break;
        case "message": {
          if (n.row.direction === "OUTBOUND") push(n, "execution", `${sentence(channelName(n.row.channel))} message ${words(n.row.status)}`, { detail: n.row.senderUserId && users.get(n.row.senderUserId) ? `Sent by ${users.get(n.row.senderUserId)}` : undefined });
          else push(n, "follow_on", `Customer replied on ${channelName(n.row.channel)}`);
          break;
        }
        case "task": {
          push(n, "execution", `Task created: ${clip(n.row.title, 100)}`, { detail: `Due ${n.row.dueAt.toISOString().slice(0, 10)}` });
          if (n.row.status === "DONE") push(n, "result", "Task completed", { at: n.row.updatedAt, id: `${n.row.id}:done` });
          break;
        }
        case "consent": push(n, "execution", `Consent ${words(n.row.status)}: ${words(n.row.purpose)}`, { detail: `Source: ${words(n.row.source)}` }); break;
        case "stage": push(n, "execution", `Stage ${n.row.fromStage ?? "none"} to ${n.row.toStage}`); break;
        case "complaint": {
          push(n, "trigger", `Complaint raised${n.row.severity ? ` (${words(n.row.severity)})` : ""}`, { at: n.row.openedAt, id: `${n.row.id}:opened` });
          if (n.row.resolvedAt) push(n, "result", "Complaint resolved", { at: n.row.resolvedAt, id: `${n.row.id}:resolved`, detail: n.row.resolutionCode ? words(n.row.resolutionCode) : undefined });
          break;
        }
        case "event": {
          if (eventRefTarget.has(n.key) && nodes.has(eventRefTarget.get(n.key) as string) && comp.some((x) => x.key === eventRefTarget.get(n.key))) break; // stands for a domain record that is already a step
          const phase = eventPhase(n.row.eventType, n.at, anchor.at);
          push(n, phase, eventTitle(n.row.eventType));
          break;
        }
      }
    }
    // a "follows" link where this entry is the later action puts the earlier action first; where it is the earlier one, the later action is follow-on.
    const followSteps: ChainStep[] = [];
    for (const f of followedBy) {
      const to = nodes.get(f.to);
      const later = to ? anchoredByComp.get(compOf(f.to)) : undefined;
      if (!to || !later) continue;
      const lbl = labelsByComp.get(later.id)?.label ?? "Later action";
      followSteps.push({
        id: `${later.anchor.key}#follow_on`, phase: "follow_on", at: iso(later.anchor.at), title: lbl, detail: f.confidence === "inferred" ? undefined : f.because,
        source: link(TABLE[later.anchor.tag], idOf(later.anchor), sourceLabel(later.anchor), clientId), confidence: f.confidence, ...(f.confidence === "inferred" ? { inferredBecause: f.because } : {}), score: f.score,
      });
    }
    chain.push(...followSteps);
    chain.sort((x, y) => PHASES.indexOf(x.phase) - PHASES.indexOf(y.phase) || x.at.localeCompare(y.at) || x.id.localeCompare(y.id));

    // ---- decision, evidence --------------------------------------------------------------------------------------------------------------
    const decision: LedgerDecision | null = decisionNode ? toDecision(decisionNode.row, link) : null;
    const evidence: LedgerEvidence[] = [];
    if (decisionNode) {
      for (const e of arr<{ kind?: string; ref?: string; text?: string; observedAt?: string | null; confirmation?: string }>(decisionNode.row.evidence).slice(0, 8)) {
        if (!e?.ref) continue;
        const k = e.kind === "memory" || e.kind === "event" || e.kind === "rule" || e.kind === "fact" ? e.kind : "fact";
        evidence.push({ table: "evidence", id: e.ref, label: clip(String(e.text ?? e.ref), 120), href: null, kind: k, confirmation: e.confirmation, observedAt: e.observedAt ?? null });
      }
    }
    const consentEv = events.map((e) => asObj(e.row.consentContext)).find((c) => str(c.purpose));
    if (consentEv) evidence.push({ table: "consent", id: String(consentEv.purpose), label: `Consent at the time: ${words(String(consentEv.purpose))} ${words(String(consentEv.status ?? "recorded"))}`, href: null, kind: "record" });

    // ---- actors ----------------------------------------------------------------------------------------------------------------------------
    const approverUser = proposal?.row.decidedById ?? approvalNative.find((x) => x.row.decidedById)?.row.decidedById ?? null;
    const agentKeyFromEvents = events.map((e) => (e.row.actorType === "agent" ? e.row.actorId : null)).find(Boolean) ?? null;
    const eventActor = (e: Extract<Node, { tag: "event" }> | undefined): Actor | null => {
      if (!e) return null;
      if (e.row.actorType === "user") return userActor(e.row.actorId);
      if (e.row.actorType === "agent") return { type: "agent", id: e.row.actorId, label: e.row.actorId ?? "AI agent" };
      if (e.row.actorType === "customer") return { type: "customer", id: e.row.actorId, label: "The customer" };
      if (e.row.actorType === "integration") return { type: "integration", id: e.row.actorId, label: sentence(words(e.row.actorId ?? "integration")) };
      return { type: "system", id: null, label: "System" };
    };
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const agentActor: Actor | null = proposal ? { type: "agent", id: proposal.row.agentKey, label: `AI agent ${proposal.row.agentKey}` } : agentKeyFromEvents ? { type: "agent", id: agentKeyFromEvents, label: `AI agent ${agentKeyFromEvents}` } : null;

    let initiatedBy: Actor | null = null;
    let executedBy: Actor | null = null;
    switch (anchor.tag) {
      case "message":
        initiatedBy = agentActor ?? (decisionNode ? { type: "engine", id: null, label: "Decision Engine" } : userActor(anchor.row.senderUserId));
        executedBy = (proposal ? userActor(proposal.row.decidedById) : null) ?? userActor(anchor.row.senderUserId) ?? { type: "system", id: null, label: "System" };
        break;
      case "proposal":
        initiatedBy = agentActor;
        executedBy = userActor(anchor.row.decidedById);
        break;
      case "task": {
        const o = taskOrigin(anchor.row.source);
        initiatedBy = o ? { type: "system", id: null, label: TASK_ORIGIN_LABEL[o.prefix] ?? "Automatic rule" } : userActor(comp.filter((n): n is Extract<Node, { tag: "audit" }> => n.tag === "audit").map((x) => x.row.userId)[0]) ?? null;
        const fb = decisionNode?.row.feedback[0];
        executedBy = (fb ? userActor(fb.userId) : null) ?? (o ? null : initiatedBy);
        break;
      }
      case "consent":
        initiatedBy = anchor.row.capturedById ? userActor(anchor.row.capturedById) : /whatsapp|keyword|app|web|import/i.test(anchor.row.source) ? { type: "customer", id: null, label: "The customer" } : { type: "system", id: null, label: sentence(words(anchor.row.source)) };
        executedBy = anchor.row.capturedById ? userActor(anchor.row.capturedById) : { type: "system", id: null, label: "System" };
        break;
      case "stage":
        initiatedBy = userActor(anchor.row.changedById);
        executedBy = initiatedBy;
        break;
      case "approval":
        initiatedBy = userActor(anchor.row.requestedById);
        executedBy = userActor(anchor.row.decidedById);
        break;
      case "complaint": {
        const resolver = anchor.row.events.filter((e) => e.type === "resolved").map((e) => e.actorId).find(Boolean) ?? anchor.row.ownerId;
        initiatedBy = anchor.row.createdById ? userActor(anchor.row.createdById) : { type: "system", id: null, label: `Raised from a ${words(anchor.row.sourceType)}` };
        executedBy = userActor(resolver);
        break;
      }
      case "decision":
        initiatedBy = { type: "engine", id: null, label: "Decision Engine" };
        executedBy = null;
        break;
      case "event":
        initiatedBy = eventActor(events.find((e) => /recommended$/.test(e.row.eventType)) ?? firstEvent);
        executedBy = eventActor(events.find((e) => /applied$/.test(e.row.eventType)) ?? lastEvent);
        break;
    }
    if (kind === "campaign" && anchor.tag === "approval") {
      initiatedBy = eventActor(events.find((e) => /recommended$/.test(e.row.eventType))) ?? userActor(anchor.row.requestedById);
      executedBy = eventActor(events.find((e) => /applied$/.test(e.row.eventType))) ?? userActor(anchor.row.decidedById);
    }

    // ---- trigger ---------------------------------------------------------------------------------------------------------------------------
    let trigger: LedgerEntry["trigger"] = null;
    const earlier = entryFollows[0];
    const certainEarlier = entryFollows.find((f) => f.confidence === "certain");
    if (decisionNode && decisionNode.row.result !== "ABSTAIN" || (decisionNode && anchor.tag === "decision")) {
      const d = decisionNode.row;
      trigger = { label: `Decision engine ${d.engineVersion}: ${clip(d.reason, 100)}`, source: link("DecisionRecord", d.id, `Decision ${d.engineVersion}`, clientId), actor: { type: "engine", id: null, label: "Decision Engine" } };
    } else if (complaint && anchor.tag !== "complaint") {
      trigger = { label: "Complaint raised", source: link("Complaint", complaint.row.id, "Complaint", clientId), actor: null };
    } else if (anchor.tag === "complaint") {
      trigger = { label: `Complaint raised${anchor.row.severity ? ` (${words(anchor.row.severity)})` : ""} from a ${words(anchor.row.sourceType)}`, source: link("Complaint", anchor.row.id, "Complaint", clientId), actor: null };
    } else if (kind === "campaign" || anchor.tag === "event") {
      const rec = events.find((e) => /recommended$/.test(e.row.eventType)) ?? events[0];
      trigger = rec ? { label: `${eventTitle(rec.row.eventType)}`, source: link("CustomerEvent", rec.row.id, "Event", clientId), actor: eventActor(rec) } : null;
    } else if (certainEarlier) {
      const from = anchoredByComp.get(compOf(certainEarlier.from));
      trigger = { label: `Follows: ${(from && labelsByComp.get(from.id)?.label) ?? "an earlier action"}`, source: from ? link(TABLE[from.anchor.tag], idOf(from.anchor), sourceLabel(from.anchor), clientId) : null, actor: null };
    } else if (earlier) {
      const from = anchoredByComp.get(compOf(earlier.from));
      const h = earlier.heuristic as Heuristic;
      const src = nodes.get(earlier.from);
      trigger = { label: `${h.trigger}${from ? `: ${labelsByComp.get(from.id)?.label ?? ""}` : src?.tag === "decision" ? `: ${words((src.row as DecisionRow).programme)}` : ""}`.trim(), source: src ? link(TABLE[src.tag], idOf(src), sourceLabel(src), clientId) : null, actor: null };
    } else if (anchor.tag === "task" && taskOrigin(anchor.row.source)) {
      trigger = { label: TASK_ORIGIN_LABEL[taskOrigin(anchor.row.source)?.prefix ?? ""] ?? "Automatic rule", source: null, actor: initiatedBy };
    } else if (initiatedBy?.type === "user") {
      trigger = { label: `Done directly by ${initiatedBy.label}`, source: null, actor: initiatedBy };
    }
    // a certain "follows" link that is not the trigger above still shows as a step
    if (certainEarlier && trigger && !trigger.label.startsWith("Follows")) {
      const from = anchoredByComp.get(compOf(certainEarlier.from));
      if (from) chain.unshift({ id: `${from.anchor.key}#trigger`, phase: "trigger", at: iso(from.anchor.at), title: labelsByComp.get(from.id)?.label ?? "Earlier action", source: link(TABLE[from.anchor.tag], idOf(from.anchor), sourceLabel(from.anchor), clientId), confidence: "certain", score: 1 });
    }
    if (earlier && earlier.confidence === "inferred") {
      const from = anchoredByComp.get(compOf(earlier.from));
      const src = nodes.get(earlier.from);
      if (src) chain.unshift({ id: `${src.key}#trigger`, phase: "trigger", at: iso((from?.anchor ?? src).at), title: from ? labelsByComp.get(from.id)?.label ?? "Earlier action" : src.tag === "decision" ? `Recommendation: ${words((src.row as DecisionRow).programme)}` : "Earlier action", source: link(TABLE[src.tag], idOf(src), sourceLabel(src), clientId), confidence: "inferred", inferredBecause: earlier.because, score: earlier.score });
    }

    // ---- AI involvement --------------------------------------------------------------------------------------------------------------------
    const ai = buildAi({ proposal: proposal?.row ?? null, decisionOwn: decisionNode && (anchor.tag === "decision" || !!proposal || certainDecision(comp)) ? decisionNode.row : null, agentKey: agentKeyFromEvents, runs, inferredNodes, autonomy: bundle.autonomy, link, clientId });

    // ---- approval --------------------------------------------------------------------------------------------------------------------------
    const approval = buildApproval({ anchor, proposal: proposal?.row ?? null, native: approvalNative[0]?.row ?? null, hiddenNative: comp.some((n) => nativeApproval(n) && !ctx.approvalVisible((n as Extract<Node, { tag: "approval" }>).row.actionType)), message: message?.row ?? null, approverUser, person, link, clientId, now: ctx.now, kind, executedBy, events });

    // ---- result ----------------------------------------------------------------------------------------------------------------------------
    const result = buildResult({ anchor, proposal: proposal?.row ?? null, message: message?.row ?? null, now: ctx.now, approval, comp });

    // ---- confidence ------------------------------------------------------------------------------------------------------------------------
    const inferredLinks: LedgerEntry["inferredLinks"] = [];
    for (const f of entryFollows.filter((x) => x.confidence === "inferred")) inferredLinks.push({ from: f.from, to: f.to, because: f.because, score: f.score, role: "trigger" });
    for (const f of followedBy.filter((x) => x.confidence === "inferred")) inferredLinks.push({ from: f.from, to: f.to, because: f.because, score: f.score, role: "follow_on" });
    for (const [k, v] of inferredNodes) if (comp.some((n) => n.key === k)) inferredLinks.push({ from: entryIdOf(a), to: k, because: v.because, score: v.score, role: "supporting" });
    const triggerLinks = inferredLinks.filter((l) => l.role === "trigger");
    const confidence: Confidence = triggerLinks.length ? "inferred" : "certain";
    const score = triggerLinks.length ? Math.min(...triggerLinks.map((l) => l.score)) : 1;

    // ---- correlation ids and sources -------------------------------------------------------------------------------------------------------
    const correlationIds = new Set<string>();
    for (const n of comp) {
      if (n.tag === "event" || n.tag === "run" || n.tag === "approval" || n.tag === "decision") { const c = n.row.correlationId; if (c && !flowIds.has(c)) correlationIds.add(c); }
      if (n.tag === "audit") { const c = str(asObj(n.row.newValue).correlationId); if (c && !flowIds.has(c)) correlationIds.add(c); }
    }
    const sources = new Map<string, SourceLink>();
    for (const n of comp) sources.set(n.key, link(TABLE[n.tag], idOf(n), sourceLabel(n), clientId));
    for (const s of chain) if (s.source.table !== "evidence") sources.set(`${s.source.table}:${s.source.id}`, s.source);

    const followOn = chain.filter((s) => s.phase === "follow_on");
    entries.push({
      id: entryIdOf(a), kind, at: iso(anchor.at), action: { label, subject }, trigger, decision, evidence, initiatedBy, executedBy, ai, approval, result,
      followOn, chain, correlationIds: [...correlationIds].sort(), confidence, score, inferredLinks, sources: [...sources.values()],
    });
  }

  entries.sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
  return entries;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------

const idOf = (n: Node): string => n.row.id;
const certainDecision = (comp: Node[]) => comp.some((n) => n.tag === "decision") && comp.some((n) => n.tag === "task" || n.tag === "message" || n.tag === "proposal");

function sourceLabel(n: Node): string {
  switch (n.tag) {
    case "event": return `Event ${n.row.eventType}`;
    case "decision": return `Decision ${n.row.engineVersion}`;
    case "run": return `Model run ${n.row.purposeId}`;
    case "proposal": return "AI draft";
    case "approval": return n.row.mirror ? "Canonical approval record" : "Approval request";
    case "audit": return `Audit ${words(n.row.action)}`;
    case "message": return `${sentence(channelName(n.row.channel))} message`;
    case "task": return "Task";
    case "consent": return "Consent record";
    case "complaint": return "Complaint";
    case "stage": return "Stage change";
  }
}

function subjectLink(n: Node, link: (t: string, i: string, l: string, c?: string | null) => SourceLink): SourceLink {
  return link(TABLE[n.tag], idOf(n), sourceLabel(n));
}

function approvalWord(a: ApprovalRow): string {
  if (a.status === "APPROVED") return a.appliedAt ? "applied" : "approved";
  return words(a.status);
}

function proposalWord(p: ProposalRow, now: Date): string {
  if (p.status === "DRAFT") return p.expiresAt <= now ? "expired unapproved" : "awaiting approval";
  return { APPROVED: "approved, not yet sent", SENT: "sent", REJECTED: "rejected", EXPIRED: "expired unapproved", BLOCKED: "blocked before approval" }[p.status] ?? words(p.status);
}

function proposalApproval(p: ProposalRow, now: Date, person: (id: string | null | undefined) => Person | null): { state: ApprovalState; label: string } {
  const by = person(p.decidedById)?.name;
  switch (p.status) {
    case "SENT": return { state: "executed", label: `Approved${by ? ` by ${by}` : ""} and sent` };
    case "APPROVED": return { state: "approved", label: `Approved${by ? ` by ${by}` : ""}` };
    case "REJECTED": return { state: "rejected", label: `Rejected${by ? ` by ${by}` : ""}` };
    case "EXPIRED": return { state: "expired", label: "Expired without a decision" };
    case "BLOCKED": return { state: "failed", label: `Blocked before it reached an approver${p.blockedReason ? `: ${clip(p.blockedReason.split(":")[0], 40)}` : ""}` };
    default: return p.expiresAt <= now ? { state: "expired", label: "Expired without a decision" } : { state: "requested", label: "Waiting for approval" };
  }
}

function eventPhase(type: string, at: Date, anchorAt: Date): Phase {
  if (/recommended$/.test(type)) return "trigger";
  if (/decision\.created$/.test(type)) return "decision";
  if (/approved$/.test(type)) return "approval";
  if (/(applied|sent|stage\.changed)$/.test(type)) return "execution";
  if (/(raised|received|created)$/.test(type)) return "trigger";
  if (/(resolved|linked|delivered|read)$/.test(type)) return "result";
  return at.getTime() < anchorAt.getTime() ? "trigger" : "follow_on";
}
function eventTitle(type: string): string {
  const parts = type.split(".");
  if (parts[0] === "campaign" && parts[1] === "autopilot") return ({ recommended: "Ad action recommended by the autopilot", approved: "Ad recommendation approved", applied: "Ad recommendation applied" } as Record<string, string>)[parts[2] ?? ""] ?? `Ad autopilot ${words(parts[2] ?? "")}`;
  return sentence(words(parts.slice(-2).join(" ")));
}

function decisionResultWords(r: DecisionRow): string {
  if (r.result === "NO_ACTION") return "no action";
  if (r.result === "ABSTAIN") return `abstained (${words(r.abstainReason ?? "unspecified")})`;
  return `recommended ${words(r.action)} for ${words(r.programme)}`;
}

function toDecision(r: DecisionRow, link: (t: string, i: string, l: string, c?: string | null) => SourceLink): LedgerDecision {
  const p = asObj(r.policyResult);
  const consent = str(p.consent) ? `Consent ${p.consent === "ok" ? "ok" : "blocked"}${str(p.consentPurpose) ? ` for ${words(String(p.consentPurpose))}` : ""}${str(p.consentReason) ? `: ${words(String(p.consentReason))}` : ""}` : null;
  return {
    engineVersion: r.engineVersion, result: r.result as LedgerDecision["result"], programme: r.programme, abstainReason: r.abstainReason, mode: r.mode, summary: clip(r.reason),
    suppressions: arr<{ rule?: string; effect?: string; because?: string }>(r.suppression).filter((s) => s?.rule).map((s) => ({ rule: String(s.rule), effect: String(s.effect ?? "block"), because: clip(String(s.because ?? ""), 120) })),
    consent, source: link("DecisionRecord", r.id, `Decision ${r.engineVersion}`),
  };
}

function buildAi(o: { proposal: ProposalRow | null; decisionOwn: DecisionRow | null; agentKey: string | null; runs: Extract<Node, { tag: "run" }>[]; inferredNodes: Map<string, Inferred>; autonomy: ReadonlyMap<string, number>; link: (t: string, i: string, l: string, c?: string | null) => SourceLink; clientId: string | null }): LedgerAi | null {
  const agentKey = o.proposal?.agentKey ?? o.agentKey ?? (o.decisionOwn ? "nba_engine" : o.runs[0]?.row.agentKey ?? null);
  if (!agentKey) return null;
  const def = getAgent(agentKey);
  const preferred = o.proposal ? (agentKey === "wa_reply" ? "suggest_reply" : "draft_customer_message") : null;
  const entry = def?.actions.find((a) => a.actionType === preferred) ?? def?.actions[0] ?? null;
  const level: AutonomyLevel | null = entry && isActionType(entry.actionType) ? effectiveLevel(entry, entry.actionType, o.autonomy.get(`${agentKey}:${entry.actionType}`)) : null;
  const runs = o.runs.length
    ? {
        count: o.runs.length,
        costUsdEstimate: Math.round(o.runs.reduce((s, r) => s + r.row.costUsdEstimate, 0) * 1e6) / 1e6,
        confidence: (o.runs.some((r) => o.inferredNodes.has(r.key)) ? "inferred" : "certain") as Confidence,
        sources: o.runs.map((r) => o.link("AgentRun", r.row.id, `Model run ${r.row.purposeId}`, o.clientId)),
      }
    : null;
  return {
    agentKey, registered: !!def, agentVersion: def?.version ?? null, purpose: def ? def.purpose : null, actionType: entry?.actionType ?? null,
    actionLabel: entry && isActionType(entry.actionType) ? ACTION_TYPES[entry.actionType].label : null, level, levelLabel: level === null ? null : LEVEL_LABEL[level], approvalPolicy: def?.approval.required ?? null, runs,
  };
}

function buildApproval(o: {
  anchor: Node; proposal: ProposalRow | null; native: ApprovalRow | null; hiddenNative: boolean; message: MessageRow | null; approverUser: string | null; person: (id: string | null | undefined) => Person | null;
  link: (t: string, i: string, l: string, c?: string | null) => SourceLink; clientId: string | null; now: Date; kind: LedgerKind; executedBy: Actor | null; events: Extract<Node, { tag: "event" }>[];
}): LedgerApproval {
  if (o.proposal) {
    const a = proposalApproval(o.proposal, o.now, o.person);
    return { state: a.state, label: a.label, by: o.person(o.proposal.decidedById), at: o.proposal.decidedAt ? iso(o.proposal.decidedAt) : null, kind: "agent-proposal", reason: o.proposal.blockedReason ? clip(o.proposal.blockedReason, 80) : null, source: o.link("AgentProposal", o.proposal.id, "AI draft", o.clientId) };
  }
  if (o.native) {
    const r = o.native;
    const state: ApprovalState = r.status === "APPROVED" ? (r.appliedAt ? "executed" : "approved") : r.status === "REJECTED" ? "rejected" : r.status === "EXPIRED" ? "expired" : r.status === "CANCELLED" ? "cancelled" : "requested";
    const by = o.person(r.decidedById);
    const label = state === "executed" ? `Approved${by?.name ? ` by ${by.name}` : ""} and applied` : state === "requested" ? "Waiting for approval" : `${sentence(words(r.status))}${by?.name ? ` by ${by.name}` : ""}`;
    return { state, label, by, at: r.decidedAt ? iso(r.decidedAt) : null, kind: words(r.actionType).replace(/ /g, "-"), reason: r.decisionNote ? clip(r.decisionNote, 80) : null, source: o.link("ApprovalRequest", r.id, "Approval request", o.clientId) };
  }
  if (o.hiddenNative) return { state: "requested", label: "An approval applies; its kind is not visible to your role", by: null, at: null, kind: null, reason: null, source: null };
  const ev = o.events.find((e) => /approved$/.test(e.row.eventType));
  if (ev) return { state: "approved", label: `Approved${ev.row.actorType === "user" && o.person(ev.row.actorId)?.name ? ` by ${o.person(ev.row.actorId)?.name}` : ""}`, by: ev.row.actorType === "user" ? o.person(ev.row.actorId) : null, at: iso(ev.row.occurredAt), kind: null, reason: null, source: o.link("CustomerEvent", ev.row.id, "Event", o.clientId) };
  if (o.anchor.tag === "decision") return { state: "not_required", label: "Not required: nothing was executed", by: null, at: null, kind: null, reason: null, source: null };
  const human = o.executedBy?.type === "user" ? o.executedBy.label : null;
  return { state: "not_required", label: human ? `Not required: done directly by ${human}` : "Not required", by: null, at: null, kind: null, reason: null, source: null };
}

function buildResult(o: { anchor: Node; proposal: ProposalRow | null; message: MessageRow | null; now: Date; approval: LedgerApproval; comp: Node[] }): LedgerEntry["result"] {
  const n = o.anchor;
  switch (n.tag) {
    case "message": {
      const s = n.row.status;
      return { label: sentence(words(s)), tone: s === "FAILED" ? "negative" : s === "READ" || s === "DELIVERED" ? "positive" : "neutral", at: iso(n.row.sentAt ?? n.row.createdAt) };
    }
    case "proposal": {
      const a = proposalApproval(n.row, o.now, () => null);
      return { label: a.state === "requested" ? "Waiting for approval; nothing sent" : a.state === "rejected" || a.state === "expired" || a.state === "failed" ? "Not sent" : a.label, tone: a.state === "failed" || a.state === "rejected" ? "warning" : "neutral", at: n.row.decidedAt ? iso(n.row.decidedAt) : null };
    }
    case "decision": return n.row.result === "RECOMMEND" ? { label: "Recommendation stored; nothing was executed by the engine", tone: "neutral", at: iso(n.row.createdAt) } : { label: "Held back: nothing was sent", tone: n.row.result === "ABSTAIN" ? "warning" : "neutral", at: iso(n.row.createdAt) };
    case "task": return n.row.status === "DONE" ? { label: "Completed", tone: "positive", at: iso(n.row.updatedAt) } : n.row.status === "CANCELLED" ? { label: "Cancelled", tone: "neutral", at: iso(n.row.updatedAt) } : { label: n.row.dueAt <= o.now ? "Open and overdue" : "Open", tone: n.row.dueAt <= o.now ? "warning" : "neutral", at: null };
    case "consent": return { label: sentence(words(n.row.status)), tone: n.row.status === "WITHDRAWN" || n.row.status === "DENIED" ? "warning" : "positive", at: iso(n.row.capturedAt) };
    case "stage": return { label: `Moved to ${n.row.toStage}`, tone: "neutral", at: iso(n.row.changedAt) };
    case "complaint": return n.row.resolvedAt ? { label: `Resolved${n.row.resolutionCode ? `: ${words(n.row.resolutionCode)}` : ""}`, tone: "positive", at: iso(n.row.resolvedAt) } : { label: sentence(words(n.row.status)), tone: "warning", at: null };
    case "approval": return { label: o.approval.label, tone: o.approval.state === "rejected" ? "warning" : o.approval.state === "executed" ? "positive" : "neutral", at: n.row.appliedAt ? iso(n.row.appliedAt) : n.row.decidedAt ? iso(n.row.decidedAt) : null };
    case "event": {
      const applied = o.comp.find((x) => x.tag === "event" && /applied$/.test(x.row.eventType));
      return applied ? { label: "Applied", tone: "positive", at: iso(applied.at) } : { label: "Not applied yet", tone: "neutral", at: null };
    }
    default: return null;
  }
}

/** Newest-first page of entries. `before` is the ISO time of the last entry on the previous page. */
export function pageEntries(entries: LedgerEntry[], o: { limit: number; before?: string | null }): { page: LedgerEntry[]; nextCursor: string | null; olderNotShown: boolean } {
  const before = o.before && !Number.isNaN(Date.parse(o.before)) ? new Date(o.before).toISOString() : null;
  const eligible = before ? entries.filter((e) => e.at < before) : entries;
  const page = eligible.slice(0, o.limit);
  const more = eligible.length > page.length;
  return { page, nextCursor: more ? page[page.length - 1].at : null, olderNotShown: more };
}
