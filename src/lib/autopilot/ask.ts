import type { LlmProvider } from "@/lib/ai/provider";
import { dataAgeText, totalsByCampaign } from "./derive";
import { evaluateControls } from "./controls";
import { monthlyPacing } from "./pacing";
import { buildRecommendations, type Recommendation } from "./recommendations";
import { topRegions } from "./regions";
import { categoryScorecard, scoreControls } from "./scoring";
import { inr, pct } from "./stats";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { timingReport } from "./timing";
import { trackingIntegrity } from "./tracking";
import { wastedSpend } from "./waste";
import type { AutopilotSnapshot } from "./types";

/**
 * "Ask Autopilot": questions answered from our own numbers. The model (when switched on) can only CHOOSE which of
 * these read-only tools to run: it never writes SQL, never sees raw rows, and never writes the answer. The answer is
 * assembled here from what the tools returned, so every figure is cited and cannot be invented. Anything that looks
 * like an action comes back as a draft proposal for a person to approve elsewhere.
 */

export type Cite = { label: string; value: string };
export type ToolResult = { tool: string; lines: string[]; cites: Cite[] };
export type ToolCall = { tool: string; args: Record<string, unknown> };
type Ctx = { s: AutopilotSnapshot; t: Thresholds };

type Tool = { name: string; description: string; run: (ctx: Ctx, args: Record<string, unknown>) => ToolResult };

const TOOLS: Tool[] = [
  { name: "health_overview", description: "Overall health score, evidence coverage and per-category scores.", run: ({ s, t }) => {
    const res = evaluateControls(s, t); const sc = scoreControls(res); const cards = categoryScorecard(res);
    return { tool: "health_overview", lines: [`Health score ${sc.score ?? "not enough data"} with ${pct(sc.coverage)} evidence coverage (${sc.confidence}).`, ...cards.filter((c) => c.score !== null && c.score < 100).slice(0, 4).map((c) => `${c.category}: ${c.score}/100 at ${pct(c.coverage)} coverage`)], cites: [{ label: "Health score", value: String(sc.score ?? "n/a") }, { label: "Evidence coverage", value: pct(sc.coverage) }] };
  } },
  { name: "wasted_spend", description: "Wasted spend by cause, with total and share of spend.", run: ({ s, t }) => {
    const w = wastedSpend(s, t);
    return { tool: "wasted_spend", lines: [`Estimated wasted spend is ${inr(w.wasted)}${w.wastedShare === null ? "" : ` (${pct(w.wastedShare, 1)} of ${inr(w.totalSpend)})`}.`, ...w.causes.filter((c) => c.available && c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 4).map((c) => `${c.label}: ${inr(c.amount)}`), ...w.causes.filter((c) => !c.available).map((c) => `${c.label}: not available`)], cites: [{ label: "Wasted spend", value: inr(w.wasted) }, { label: "Total spend", value: inr(w.totalSpend) }] };
  } },
  { name: "pacing", description: "Monthly spend against plan with projected month-end, per campaign.", run: ({ s, t }) => {
    const rows = monthlyPacing(s, s.window.until, t).filter((r) => r.flag === "overspend" || r.flag === "underspend");
    return { tool: "pacing", lines: rows.length ? rows.map((r) => `${r.campaignName} is projected to ${r.flag === "overspend" ? "overspend" : "underspend"}: ${inr(r.projected as number)} against ${inr(r.planned as number)}.`) : ["No campaign with a plan is off pace, or it is too early in the month to tell."], cites: rows.map((r) => ({ label: `${r.campaignName} projected`, value: inr(r.projected as number) })) };
  } },
  { name: "top_regions", description: "Best cities or states by cost per funded customer and AUM per rupee. Args: kind = city | state.", run: ({ s, t }, a) => {
    const kind = a.kind === "state" ? "state" : "city"; const r = topRegions(s, kind, t);
    const best = r.byCostPerFunded[0];
    return { tool: "top_regions", lines: best ? [`Best ${kind} by cost per funded customer: ${best.name} at ${inr(best.costPerFunded as number)} (${best.funded} funded customers).`, ...(r.byAumPerRupee[0] ? [`Best ${kind} by AUM per rupee spent: ${r.byAumPerRupee[0].name} at ${(r.byAumPerRupee[0].aumPerRupee as number).toFixed(1)}.`] : [])] : [r.spendAvailable ? `No ${kind} has enough leads and funded customers to rank yet.` : "Spend by region is not available, so cost per funded customer by region cannot be shown."], cites: best ? [{ label: best.name, value: inr(best.costPerFunded as number) }] : [] };
  } },
  { name: "timing", description: "When leads arrive and how fast and how well they convert, plus any schedule or staffing suggestion.", run: ({ s, t }) => {
    const r = timingReport(s, t);
    return { tool: "timing", lines: [...r.recommendations.map((x) => `${x.headline}. ${x.evidence[0]}`), ...r.holds.map((h) => h.message), ...(r.recommendations.length + r.holds.length === 0 ? ["No time of day stands out with enough leads behind it."] : [])], cites: r.bands.filter((b) => b.leads > 0).map((b) => ({ label: `Leads ${b.label}`, value: String(b.leads) })) };
  } },
  { name: "tracking", description: "Conversion tracking problems: double counting, missing events, broken offline imports.", run: ({ s, t }) => {
    const r = trackingIntegrity(s, t);
    return { tool: "tracking", lines: !r.available ? ["Tracking signals are not connected yet. Not available."] : r.findings.length ? r.findings.map((f) => f.message) : ["No tracking problems found in the last 7 days."], cites: r.findings.map((f) => ({ label: f.subject, value: f.evidence[0] ?? "" })) };
  } },
  { name: "campaign_detail", description: "One campaign's spend, leads, funded customers and cost per funded customer. Args: campaign = id or name.", run: ({ s }, a) => {
    const q = String(a.campaign ?? "").toLowerCase();
    const c = totalsByCampaign(s).find((x) => x.campaign.id.toLowerCase() === q || x.campaign.name.toLowerCase().includes(q) && q.length > 1);
    if (!c) return { tool: "campaign_detail", lines: ["No campaign matches that name."], cites: [] };
    return { tool: "campaign_detail", lines: [`${c.campaign.name}: spend ${inr(c.spend)}, ${c.crmLeads} CRM leads, ${c.funded} funded customers${c.costPerFunded === null ? "" : `, ${inr(c.costPerFunded)} per funded customer`}.`], cites: [{ label: "Spend", value: inr(c.spend) }, { label: "Funded customers", value: String(c.funded) }] };
  } },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** Pick tools from the words of the question. Deterministic: this is the fallback and the demo path. */
export function planByKeywords(q: string): ToolCall[] {
  const x = q.toLowerCase(); const out: ToolCall[] = [];
  const has = (...w: string[]) => w.some((k) => x.includes(k));
  if (has("wast", "leak", "losing money")) out.push({ tool: "wasted_spend", args: {} });
  if (has("pace", "pacing", "budget", "overspend", "underspend", "month-end", "month end")) out.push({ tool: "pacing", args: {} });
  if (has("city", "cities", "region", "state", "where", "location")) out.push({ tool: "top_regions", args: { kind: has("state") ? "state" : "city" } });
  if (has("hour", "time of day", "night", "evening", "morning", "shift", "staff", "when", "late")) out.push({ tool: "timing", args: {} });
  if (has("track", "pixel", "conversion api", "duplicate", "double", "offline")) out.push({ tool: "tracking", args: {} });
  if (has("health", "score", "audit", "how are we", "overall")) out.push({ tool: "health_overview", args: {} });
  if (out.length === 0) out.push({ tool: "health_overview", args: {} });
  return out;
}

/** Ask the model to choose tools. Anything outside the whitelist is dropped; any failure falls back to keywords. */
export async function planWithModel(q: string, provider: LlmProvider, campaignNames: string[]): Promise<ToolCall[]> {
  const system = `You route questions about advertising performance to read-only tools. Reply with ONLY JSON: {"tools":[{"tool":"<name>","args":{}}]}. Choose at most 3 tools from this list and nothing else:\n${TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}\nCampaign names you may refer to: ${campaignNames.slice(0, 30).join("; ")}. Never write SQL or answers.`;
  try {
    const res = await provider.complete({ system, user: q.slice(0, 500), maxTokens: 200, timeoutMs: 15_000 });
    const m = /\{[\s\S]*\}/.exec(res.text); if (!m) return planByKeywords(q);
    const parsed = JSON.parse(m[0]) as { tools?: { tool?: unknown; args?: unknown }[] };
    const calls = (parsed.tools ?? []).filter((c) => typeof c.tool === "string" && TOOL_NAMES.includes(c.tool)).slice(0, 3).map((c) => ({ tool: c.tool as string, args: typeof c.args === "object" && c.args !== null ? Object.fromEntries(Object.entries(c.args as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 80) : v])) : {} }));
    return calls.length ? calls : planByKeywords(q);
  } catch { return planByKeywords(q); }
}

export type Answer = { question: string; lines: string[]; cites: Cite[]; dataAge: string; asOf: string; toolsUsed: string[]; draftProposals: Recommendation[]; note: string };

export function answer(question: string, calls: ToolCall[], s: AutopilotSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): Answer {
  const ctx = { s, t };
  const results = calls.slice(0, 3).flatMap((c) => { const tool = TOOLS.find((x) => x.name === c.tool); return tool ? [tool.run(ctx, c.args)] : []; });
  const wantsAction = /\b(should|what to do|fix|improve|recommend|pause|stop)\b/i.test(question);
  const drafts = wantsAction ? buildRecommendations(s, evaluateControls(s, t), t).slice(0, 3) : [];
  return {
    question: question.slice(0, 500),
    lines: results.flatMap((r) => r.lines),
    cites: results.flatMap((r) => r.cites),
    dataAge: dataAgeText(s), asOf: s.asOf,
    toolsUsed: results.map((r) => r.tool),
    draftProposals: drafts,
    note: "Answers use only the data shown above and cannot change anything. Suggested actions are drafts for a person to approve in the Actions tab.",
  };
}
