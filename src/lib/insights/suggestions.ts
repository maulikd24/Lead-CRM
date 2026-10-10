import type { AgentQuality } from "./agent-quality";
import type { FunnelRow, ObjectionRow, OutcomeMixGroup } from "./response-analytics";
import { compareVariants, type Proportion } from "./variant";

/** Rule-based, plain-language findings with the evidence behind each. No model is involved. */
export type Suggestion = { id: string; severity: "attention" | "info"; text: string; evidence: string };

export type SuggestionInput = {
  assetClassMix: OutcomeMixGroup[];
  programmeMix: OutcomeMixGroup[];
  agents: AgentQuality[];
  objections: ObjectionRow[];
  funnel: FunnelRow[];
  /** Reply rates: `a` = customers who got an AI draft, `b` = RM-only messages. Null when not computed. */
  aiVsRm: { a: Proportion; b: Proportion } | null;
};

export const THRESHOLDS = {
  minOutcomes: 20,
  declineRatio: 2,
  declineGap: 0.15,
  minApproved: 10,
  editRate: 0.6,
  minGenerated: 20,
  blockRate: 0.25,
  minOffered: 20,
  expiryRate: 0.4,
  rejectionRate: 0.4,
  minObjections: 10,
  objectionShare: 0.4,
  minFunnelReached: 30,
  funnelLeak: 0.7,
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const declined = (g: OutcomeMixGroup) => g.counts.NOT_INTERESTED + g.counts.NOT_RELEVANT;
const humanHours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} hours`);

export function buildSuggestions(input: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const T = THRESHOLDS;

  // 1. An asset class that customers decline much more than the best one.
  const eligible = input.assetClassMix.filter((g) => g.total >= T.minOutcomes && g.declineRate !== null && g.key !== "Unspecified");
  for (const g of eligible) {
    const others = eligible.filter((o) => o.key !== g.key);
    if (others.length === 0) continue;
    const best = others.reduce((m, o) => ((o.declineRate ?? 1) < (m.declineRate ?? 1) ? o : m));
    const gr = g.declineRate ?? 0;
    const br = best.declineRate ?? 0;
    if (gr - br < T.declineGap) continue;
    const ratio = br === 0 ? Infinity : gr / br;
    if (ratio < T.declineRatio) continue;
    out.push({
      id: `asset-decline-${g.key}`,
      severity: "attention",
      text: `${g.key} pitches get declined ${ratio === Infinity ? "far more often" : `${ratio.toFixed(1)}x as often`} as ${best.key} pitches; consider pausing them or changing the approach until the reasons are understood.`,
      evidence: `${g.key}: ${declined(g)} of ${g.total} declined (${pct(gr)}). ${best.key}: ${declined(best)} of ${best.total} (${pct(br)}).`,
    });
  }

  for (const a of input.agents) {
    // 2. Drafts people keep rewriting.
    for (const p of a.byProgramme) {
      if (p.approved >= T.minApproved && p.editRate !== null && p.editRate > T.editRate) {
        out.push({
          id: `edit-${a.agentKey}-${p.programme}`,
          severity: "attention",
          text: `Drafts for "${p.programme}" are edited ${pct(p.editRate)} of the time before they are approved; review the prompt for that programme.`,
          evidence: `${p.edited} of ${p.approved} approved drafts were edited (${a.agentKey}).`,
        });
      }
    }
    // 3. Too many drafts stopped by the guardrails.
    if (a.generated >= T.minGenerated && a.blocked.rate !== null && a.blocked.rate > T.blockRate) {
      const top = Object.entries(a.blocked.byReason).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
      out.push({
        id: `blocked-${a.agentKey}`,
        severity: "attention",
        text: `${a.blocked.total === 0 ? "" : `${pct(a.blocked.rate)} of `}${a.agentKey} drafts are stopped by the guardrails${top ? `; the most common reason is ${top[0]}` : ""}. Tighten the instructions so fewer drafts are wasted.`,
        evidence: `${a.blocked.total} of ${a.generated} drafts blocked (${a.blocked.regex} by pattern rules, ${a.blocked.judge} by the judge).`,
      });
    }
    // 4. Drafts nobody gets to.
    if (a.offered >= T.minOffered && a.expiryRate !== null && a.expiryRate > T.expiryRate) {
      out.push({
        id: `expiry-${a.agentKey}`,
        severity: "attention",
        text: `${pct(a.expiryRate)} of ${a.agentKey} drafts expire before anyone reviews them; send fewer drafts per RM or review them earlier in the day.`,
        evidence: `${a.expired} of ${a.offered} drafts that reached a reviewer expired.`,
      });
    }
    // 5. Drafts people reject.
    if (a.offered >= T.minOffered && a.rejectionRate !== null && a.rejectionRate > T.rejectionRate) {
      out.push({
        id: `rejection-${a.agentKey}`,
        severity: "attention",
        text: `${pct(a.rejectionRate)} of ${a.agentKey} drafts are rejected outright; sample the rejected drafts and look for a pattern.`,
        evidence: `${a.rejected} of ${a.offered} drafts that reached a reviewer were rejected.`,
      });
    }
  }

  // 6. A concern that dominates an asset class.
  for (const row of input.objections) {
    const top = row.themes[0];
    if (!top || top.theme === "Other" || row.total < T.minObjections || top.count / row.total < T.objectionShare) continue;
    out.push({
      id: `objection-${row.assetClass}`,
      severity: "info",
      text: `The most common concern about ${row.assetClass} is "${top.theme}"${top.trend === "up" || top.trend === "new" ? " and it is rising" : ""}; give RMs a clear, compliant answer to it.`,
      evidence: `${top.count} of ${row.total} concerns (${pct(top.count / row.total)}); previous period ${top.prevCount}.`,
    });
  }

  // 7. The biggest leak in the journey.
  const stages = input.funnel.filter((f) => f.conversion !== null && f.reached >= T.minFunnelReached);
  if (stages.length > 0) {
    const worst = stages.reduce((m, f) => ((f.conversion ?? 1) < (m.conversion ?? 1) ? f : m));
    if ((worst.conversion ?? 1) < T.funnelLeak) {
      out.push({
        id: "funnel-leak",
        severity: "attention",
        text: `The biggest leak is at "${worst.name}": only ${pct(worst.conversion ?? 0)} of customers move on to the next stage${worst.medianHoursInStage !== null ? `, after a median of ${humanHours(worst.medianHoursInStage)} there` : ""}.`,
        evidence: `${worst.advanced} of ${worst.reached} customers who reached ${worst.name} advanced.`,
      });
    }
  }

  // 8. AI drafts vs RM-only messages, with an honest sample-size check.
  if (input.aiVsRm && (input.aiVsRm.a.n > 0 || input.aiVsRm.b.n > 0)) {
    const { a, b } = input.aiVsRm;
    const cmp = compareVariants(a, b);
    const ev = `AI drafts: ${a.successes} of ${a.n} got a reply. RM-only: ${b.successes} of ${b.n}.`;
    if (cmp.status === "too_early") out.push({ id: "ai-vs-rm", severity: "info", text: `Reply rates for AI drafts and RM-only messages: too early to call (${cmp.reason}).`, evidence: ev });
    else if (cmp.status === "not_significant") out.push({ id: "ai-vs-rm", severity: "info", text: "AI drafts and RM-only messages get replies at about the same rate; the gap is within normal variation.", evidence: ev });
    else out.push({ id: "ai-vs-rm", severity: "info", text: `Customers reply more often to ${cmp.better === "a" ? "AI drafts" : "RM-only messages"} (p = ${cmp.result.pValue.toFixed(3)}).`, evidence: ev });
  }

  if (out.length === 0) {
    const hasData =
      input.assetClassMix.some((g) => g.total > 0) || input.agents.some((a) => a.generated > 0) || input.objections.length > 0 || input.funnel.some((f) => f.reached > 0);
    out.push(
      hasData
        ? { id: "all-clear", severity: "info", text: "Nothing stands out right now. Keep watching as more outcomes come in.", evidence: "No rule crossed its threshold." }
        : { id: "not-enough-data", severity: "info", text: "Not enough data yet. Suggestions appear once outcomes, drafts and journey movements have been recorded.", evidence: "No outcomes, drafts or journey data in this period." },
    );
  }
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "attention" ? -1 : 1));
}
