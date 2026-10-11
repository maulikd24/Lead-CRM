// Candidate generators: every existing recommendation implementation, wrapped behind one adapter each. NONE of them is deleted or
// changed; each keeps its own tests and its own screens. An adapter turns that implementation's output into Candidates and nothing else.
// Pure functions of AdapterInput.
import type { NbaKind } from "@/lib/copilot/next-best-action";
import { FRESHNESS } from "../constants";
import { isAssetClass, type AssetClass, type NbaProgramme } from "../../constants";
import type { Candidate, DecisionAction, DecisionChannel, DecisionOwner, DecisionTiming, EvidenceItem } from "../types";
import type { AdapterInput } from "./types";

const DAY = 24 * 60 * 60 * 1000;
/** Mirrors copilot/check-disengagement.ts. */
export const DISENGAGEMENT_DAYS = 5;

/** Programmes that pitch or sell something. Onboarding steps and service follow-ups are not sales. */
const SALES_PROGRAMMES = new Set<NbaProgramme>(["First transaction", "Demat portfolio transfer", "Mutual fund portfolio transfer", "Portfolio rebalance", "MF / SIP opportunity", "PMS / AIF opportunity", "Broking activation / reactivation", "Tax-planning discussion"]);
const PORTFOLIO_PROGRAMMES = new Set<NbaProgramme>(["Demat portfolio transfer", "Mutual fund portfolio transfer", "Portfolio rebalance", "PMS / AIF opportunity", "Wealth Health Review"]);

export const isSalesProgramme = (p: NbaProgramme) => SALES_PROGRAMMES.has(p);

export function assetClassFor(programme: NbaProgramme, topic: string | null): AssetClass | null {
  switch (programme) {
    case "PMS / AIF opportunity":
      return isAssetClass(topic) && (topic === "PMS" || topic === "AIF") ? topic : "PMS";
    case "MF / SIP opportunity":
    case "Mutual fund portfolio transfer":
      return "Mutual Funds";
    case "Broking activation / reactivation":
    case "Demat portfolio transfer":
      return "Broking";
    case "Tax-planning discussion":
      return "Tax Planning";
    default:
      return null;
  }
}

type Base = Pick<Candidate, "id" | "source" | "programme" | "action" | "topic" | "reason" | "priority" | "ruleKey" | "fingerprint"> & Partial<Candidate>;

function mk(b: Base, input: AdapterInput): Candidate {
  const sales = b.sales ?? isSalesProgramme(b.programme);
  const portfolio = PORTFOLIO_PROGRAMMES.has(b.programme);
  const channel: DecisionChannel = b.channel ?? (b.action === "Call" || b.action === "Follow-up" ? "call" : b.action === "WhatsApp" ? "whatsapp" : b.action === "Email" ? "email" : "none");
  return {
    assetClass: b.assetClass ?? assetClassFor(b.programme, b.topic),
    owner: "RM",
    timing: (b.priority === "High" ? "Today" : b.priority === "Medium" ? "This Week" : "Later") as DecisionTiming,
    serviceRecovery: false,
    bonuses: [],
    evidence: [],
    asOf: portfolio ? (input.portfolioAsOf ?? input.now) : input.now,
    freshness: portfolio ? { ...FRESHNESS.portfolio } : { ...FRESHNESS.onboarding },
    inferredOnly: false,
    productRefs: [],
    legacyChosen: false,
    ...b,
    channel,
    sales,
  };
}

const ev = (kind: EvidenceItem["kind"], ref: string, text: string, observedAt: Date | null, confirmation: EvidenceItem["confirmation"]): EvidenceItem => ({ kind, ref, text, observedAt: observedAt ? observedAt.toISOString() : null, confirmation });

// ---- 1. stage gate (lib/copilot/next-best-action.ts) -------------------------------------------------------------------
const STAGE_GATE: Record<Exclude<NbaKind, "no_action_needed">, { programme: NbaProgramme; action: DecisionAction; priority: "High" | "Medium" | "Low" }> = {
  contact_client: { programme: "Complete KYC", action: "Call", priority: "High" },
  collect_documents: { programme: "Complete KYC", action: "Call", priority: "Medium" },
  submit_kyc: { programme: "Complete KYC", action: "Follow-up", priority: "Medium" },
  follow_up_kyc: { programme: "Complete KYC", action: "Follow-up", priority: "Medium" },
  resolve_kyc_issue: { programme: "Complete KYC", action: "Call", priority: "High" },
  follow_up_funding: { programme: "Fund account", action: "Call", priority: "Medium" },
  schedule_dealer_intro: { programme: "First transaction", action: "Follow-up", priority: "Medium" },
  follow_up_dealer_intro: { programme: "First transaction", action: "Follow-up", priority: "Medium" },
  mark_onboarding_completed: { programme: "First transaction", action: "Follow-up", priority: "Low" },
};
const INTERNAL_KINDS = new Set<NbaKind>(["submit_kyc", "follow_up_kyc", "schedule_dealer_intro", "follow_up_dealer_intro", "mark_onboarding_completed"]);

export function stageGateCandidates(input: AdapterInput): Candidate[] {
  const g = input.stageGate;
  if (!g || g.kind === "no_action_needed") return [];
  const m = STAGE_GATE[g.kind];
  const reminder = g.suggestedTemplateCategory !== null && !!input.facts?.hasContacted && m.action === "Call";
  return [
    mk(
      {
        id: `stage_gate:${g.kind}`,
        source: "stage_gate",
        programme: m.programme,
        action: reminder ? "WhatsApp" : m.action,
        channel: INTERNAL_KINDS.has(g.kind) ? "none" : undefined,
        topic: g.label,
        reason: g.detail,
        priority: m.priority,
        owner: reminder ? "CRM" : "RM",
        sales: false,
        ruleKey: `stage_gate.${g.kind}`,
        fingerprint: g.label,
        evidence: [ev("fact", `stage:${input.facts?.stage.name ?? "unknown"}`, `Onboarding stage: ${input.facts?.stage.name ?? "unknown"}`, input.facts?.stage.enteredAt ?? null, "confirmed"), ev("rule", `rule:stage_gate:${g.kind}`, g.detail, input.now, "not_applicable")],
        bonuses: input.facts && Math.floor((input.now.getTime() - input.facts.stage.enteredAt.getTime()) / DAY) >= 3 ? [{ label: "Stuck in this stage 3+ days", points: 8 }] : [],
      },
      input,
    ),
  ];
}

// ---- 2. intelligence NBA v1 (lib/intelligence/nba.ts) -----------------------------------------------------------------
export function intelligenceNbaCandidates(input: AdapterInput): Candidate[] {
  const n = input.nba;
  if (!n || n.action === "No Action") return [];
  const owner: DecisionOwner = n.owner;
  const assetClass = assetClassFor(n.programme, n.topic);
  const f = input.facts;
  const evidence: EvidenceItem[] = [];
  if (f) evidence.push(ev("fact", `stage:${f.stage.name}`, `Lifecycle context: ${f.stage.name}`, f.stage.enteredAt, "not_applicable"));
  if (f && f.portfolio.aum > 0 && PORTFOLIO_PROGRAMMES.has(n.programme)) evidence.push(ev("fact", "portfolio:aum", "Holdings on file", input.portfolioAsOf, "confirmed"));
  if (f && assetClass) {
    const interest = f.insights.find((i) => i.kind === "INTEREST" && i.assetClass === assetClass && i.status === "OPEN");
    const rmConfirmed = f.outcomes.some((o) => o.outcome === "INTERESTED" && o.assetClass === assetClass) || f.manualAcceptance.some((m) => m.assetClass === assetClass && m.level === "HIGH");
    if (interest) evidence.push(ev("memory", `insight:INTEREST:${assetClass}`, `Interest in ${assetClass} noted in a conversation`, interest.occurredAt, rmConfirmed ? "confirmed" : "ai_inferred"));
    else if (rmConfirmed) evidence.push(ev("fact", `acceptance:${assetClass}`, `An RM recorded interest or high acceptance for ${assetClass}`, null, "confirmed"));
  }
  evidence.push(ev("rule", `rule:nba_v1:${n.programme}`, n.reason, input.now, "not_applicable"));
  const counted = evidence.filter((e) => e.confirmation !== "not_applicable");
  const inferredOnly = counted.length > 0 && counted.every((e) => e.confirmation === "ai_inferred");
  const base = { High: 75, Medium: 50, Low: 20 }[n.priority];
  const extra = Math.max(0, n.priorityScore - base);
  return [
    mk(
      {
        id: `intelligence_nba:${n.programme}`,
        source: "intelligence_nba",
        programme: n.programme,
        action: n.action === "Follow-up" ? "Follow-up" : n.action,
        channel: n.action === "Review" ? "none" : undefined,
        topic: n.topic,
        reason: n.reason,
        priority: n.priority,
        owner,
        timing: n.timing,
        serviceRecovery: n.programme === "Service / relationship follow-up",
        ruleKey: `intelligence_nba.${n.programme}`,
        fingerprint: n.topic ?? n.programme,
        bonuses: extra > 0 ? [{ label: "Rule bonuses from the v1 engine (stage age, interest, portfolio size; not itemised by v1)", points: extra }] : [],
        evidence,
        inferredOnly,
        legacyChosen: true,
      },
      input,
    ),
  ];
}

// ---- 3. goal and outcomes rules (lib/outcomes/rules.ts) -----------------------------------------------------------------
const OUTCOME_MAP: Record<string, { programme: NbaProgramme; action: DecisionAction; sales: boolean; recovery?: boolean }> = {
  kyc_gap: { programme: "Complete KYC", action: "Follow-up", sales: false },
  review_overdue: { programme: "Wealth Health Review", action: "Review", sales: false },
  idle_cash: { programme: "Wealth Health Review", action: "Call", sales: true },
  concentration: { programme: "Portfolio rebalance", action: "Review", sales: true },
  consent_gap: { programme: "Service / relationship follow-up", action: "Task", sales: false },
  key_date: { programme: "Service / relationship follow-up", action: "Follow-up", sales: false, recovery: true },
  goal_behind: { programme: "Wealth Health Review", action: "Review", sales: false },
};

export function goalOutcomeCandidates(input: AdapterInput): Candidate[] {
  return input.goalSuggestions.flatMap((s) => {
    const m = OUTCOME_MAP[s.ruleKey];
    if (!m) return [];
    const priority = s.severity === "high" ? "High" : s.severity === "medium" ? "Medium" : "Low";
    return [
      mk(
        {
          id: `goal_outcomes:${s.ruleKey}:${s.fingerprint}`,
          source: "goal_outcomes",
          programme: m.programme,
          action: m.action,
          channel: m.action === "Review" || m.action === "Task" ? "none" : undefined,
          topic: s.title,
          reason: s.detail,
          priority,
          sales: m.sales,
          serviceRecovery: !!m.recovery,
          // The outcomes screens dismiss by (ruleKey, fingerprint); using the same pair keeps those dismissals in force here.
          ruleKey: s.ruleKey,
          fingerprint: s.fingerprint,
          evidence: [...s.why.map((w) => ev("fact", `outcome:${s.ruleKey}`, `${w.label}: ${w.value}`, input.now, "confirmed")), ev("rule", `rule:outcomes:${s.ruleKey}`, s.title, input.now, "not_applicable")],
        },
        input,
      ),
    ];
  });
}

// ---- 4. stage-engine next action (Client.nextActionTitle / DueAt) --------------------------------------------------------
export function stageNextActionCandidates(input: AdapterInput): Candidate[] {
  const a = input.nextAction;
  if (!a) return [];
  const overdue = !!a.dueAt && a.dueAt.getTime() < input.now.getTime();
  return [
    mk(
      {
        id: "stage_next_action:task",
        source: "stage_next_action",
        programme: "Service / relationship follow-up",
        action: "Task",
        channel: "none",
        topic: a.title,
        reason: `${overdue ? "Overdue task" : "Open task"}${a.dueAt ? ` (due ${a.dueAt.toISOString().slice(0, 10)})` : ""}: ${a.title}`,
        priority: overdue ? "High" : "Medium",
        sales: false,
        // A person planned this work. The engine ranks it; it never suppresses an RM's own task (the other rules still can).
        serviceRecovery: true,
        ruleKey: "stage_next_action",
        fingerprint: a.title,
        evidence: [ev("fact", "task:next", a.title, a.dueAt, "confirmed")],
        bonuses: overdue ? [{ label: "Task is overdue", points: 8 }] : [],
      },
      input,
    ),
  ];
}

// ---- 5. agent proposals (AgentProposal drafts) ------------------------------------------------------------------------
export function agentProposalCandidates(input: AdapterInput): Candidate[] {
  return input.proposals.map((p) => {
    const programme = (p.programme as NbaProgramme | null) ?? "Service / relationship follow-up";
    return mk(
      {
        id: `agent_proposal:${p.id}`,
        source: "agent_proposal",
        programme,
        action: p.channel === "email" ? "Email" : "WhatsApp",
        topic: null,
        reason: p.reason,
        priority: "Low",
        owner: "AI Bot",
        ruleKey: "agent_proposal",
        fingerprint: p.id,
        // A draft exists because an agent chose this customer; the draft still needs a person to approve it.
        evidence: [ev("event", `proposal:${p.id}`, "An AI draft is waiting for review", p.createdAt, "ai_inferred"), ev("rule", "rule:agent", p.reason, input.now, "not_applicable")],
        inferredOnly: false,
      },
      input,
    );
  });
}

// ---- 6. cross-sell flags (lib/copilot/cross-sell.ts) -------------------------------------------------------------------
const CROSS_SELL: { match: RegExp; programme: NbaProgramme }[] = [
  { match: /PMS|premium/i, programme: "PMS / AIF opportunity" },
  { match: /derivatives|F&O/i, programme: "Broking activation / reactivation" },
  { match: /consolidation/i, programme: "Demat portfolio transfer" },
];

export function crossSellCandidates(input: AdapterInput): Candidate[] {
  return input.crossSell.flatMap((f, i) => {
    const m = CROSS_SELL.find((x) => x.match.test(f.label));
    if (!m) return [];
    return [mk({ id: `cross_sell:${i}`, source: "cross_sell", programme: m.programme, action: "Review", channel: "none", topic: f.label, reason: f.reason, priority: "Low", ruleKey: `cross_sell.${m.programme}`, fingerprint: f.label, evidence: [ev("fact", "client:profile", f.reason, null, "confirmed"), ev("rule", "rule:cross_sell", f.label, input.now, "not_applicable")] }, input)];
  });
}

// ---- 7. disengagement (lib/copilot/check-disengagement.ts) ---------------------------------------------------------------
export function disengagementCandidates(input: AdapterInput): Candidate[] {
  const f = input.facts;
  if (!f || f.client.status !== "ACTIVE") return [];
  const last = f.lastActivityAt ?? f.client.createdAt;
  const quiet = Math.floor((input.now.getTime() - last.getTime()) / DAY);
  if (quiet < DISENGAGEMENT_DAYS) return [];
  return [
    mk(
      {
        id: "disengagement:quiet",
        source: "disengagement",
        programme: "Service / relationship follow-up",
        action: "Call",
        topic: "Re-engage",
        reason: `No contact or activity for ${quiet} days.`,
        priority: quiet >= 14 ? "Medium" : "Low",
        sales: false,
        ruleKey: "disengagement",
        fingerprint: last.toISOString().slice(0, 10),
        evidence: [ev("fact", "activity:last", `Last activity ${last.toISOString().slice(0, 10)}`, last, "confirmed")],
      },
      input,
    ),
  ];
}

export function generateCandidates(input: AdapterInput): Candidate[] {
  return [...stageGateCandidates(input), ...intelligenceNbaCandidates(input), ...goalOutcomeCandidates(input), ...stageNextActionCandidates(input), ...agentProposalCandidates(input), ...crossSellCandidates(input), ...disengagementCandidates(input)];
}
