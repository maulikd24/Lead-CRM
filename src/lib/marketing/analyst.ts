import { isProviderConfigured } from "@/lib/ai/gateway/config";
import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";

import type { BlendedReport } from "./blend";
import { MIN_LEADS_FOR_VERDICT, type QualityKey } from "./metrics";
import { formatCount, formatMoney, formatPercent } from "./view-model";

/**
 * The AI Marketing Manager (agent marketing_analyst): a weekly READ over campaign aggregates. Pure, no database, no clock.
 *
 * Input is the blended campaign report the Marketing page already computes: totals, funnel steps and one row per campaign. No client
 * rows, no names, no contact details and no client ids are ever part of the input type, so none can reach the model.
 * Output is text recommendations only. Nothing here changes an ad, pauses a campaign, sends a message or stores a decision.
 *
 * Model path: one callModel() call under purpose marketing.analysis. Its text is refused (and the deterministic text used) when it
 * contains an email, a phone-like number, a PAN-shaped code, or a guarantee of returns. Without an AI key there is no model call at all.
 */

const MAX_CAMPAIGNS = 20;
const MAX_TEXT = 1500;
/** Heuristic cut-offs for the read, not policy: a rate under these is called a leak. */
const LOW_KYC_RATE = 0.3;
const LOW_FUNDED_RATE = 0.2;
const TOP_N = 3;

export type AnalystCampaign = {
  label: string;
  channel: string;
  spend: number;
  crmLeads: number;
  kyc: number;
  funded: number;
  cpl: number | null;
  costPerFunded: number | null;
  kycRate: number | null;
  quality: QualityKey;
};

export type AnalystInput = {
  from: string;
  to: string;
  currency: string | null;
  totals: {
    spend: number;
    crmLeads: number;
    kyc: number;
    funded: number;
    cpl: number | null;
    costPerFunded: number | null;
  };
  campaigns: AnalystCampaign[];
};

/** Aggregates only: the blended report carries no customer rows, so nothing else needs to be stripped. */
export function toAnalystInput(report: BlendedReport): AnalystInput {
  const campaigns = [...report.campaigns]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, MAX_CAMPAIGNS)
    .map((c): AnalystCampaign => ({
      label: c.name,
      channel: c.channel,
      spend: c.spend,
      crmLeads: c.crmLeads,
      kyc: c.kyc,
      funded: c.funded,
      cpl: c.cpl,
      costPerFunded: c.costPerFunded,
      kycRate: c.kycRate,
      quality: c.quality.key,
    }));
  return {
    from: report.range.from,
    to: report.range.to,
    currency: report.currency,
    totals: {
      spend: report.totals.spend,
      crmLeads: report.totals.crmLeads,
      kyc: report.totals.kyc,
      funded: report.totals.funded,
      cpl: report.totals.cpl,
      costPerFunded: report.totals.costPerFunded,
    },
    campaigns,
  };
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

type Leak = { weaker: "kyc" | "funded" | null; leadToKyc: number | null; kycToFunded: number | null };

/** Which funnel step converts worse: lead to approved KYC, or approved KYC to funded. */
export function findLeak(input: AnalystInput): Leak {
  const leadToKyc = ratio(input.totals.kyc, input.totals.crmLeads);
  const kycToFunded = ratio(input.totals.funded, input.totals.kyc);
  if (leadToKyc === null || kycToFunded === null) return { weaker: null, leadToKyc, kycToFunded };
  return { weaker: leadToKyc <= kycToFunded ? "kyc" : "funded", leadToKyc, kycToFunded };
}

const eligible = (c: AnalystCampaign) => c.crmLeads >= MIN_LEADS_FOR_VERDICT;

/** Deterministic weekly read over the aggregates. Same numbers the model would see, so it is always safe to show. */
export function deterministicSummary(input: AnalystInput): string {
  const cur = input.currency;
  const t = input.totals;
  const lines: string[] = [];
  lines.push(`Weekly marketing read, ${input.from} to ${input.to}${cur ? ` (${cur})` : ""}.`);
  lines.push(
    `Overall: ${formatCount(t.crmLeads)} CRM leads, ${formatCount(t.kyc)} KYC approved (${formatPercent(ratio(t.kyc, t.crmLeads))}), ${formatCount(t.funded)} funded. Cost per funded customer: ${formatMoney(t.costPerFunded, cur)}.`,
  );

  const ranked = input.campaigns
    .filter((c) => eligible(c) && c.funded > 0 && c.costPerFunded !== null)
    .sort((a, b) => (a.costPerFunded ?? 0) - (b.costPerFunded ?? 0));
  if (ranked.length === 0) {
    lines.push(`Best cost per funded customer: not ranked yet. A campaign needs at least ${MIN_LEADS_FOR_VERDICT} CRM leads and one funded customer.`);
  } else {
    lines.push("Best cost per funded customer:");
    ranked.slice(0, TOP_N).forEach((c, i) => {
      lines.push(`${i + 1}. ${c.label} (${c.channel}): ${formatMoney(c.costPerFunded, cur)} per funded customer, ${formatCount(c.funded)} funded from ${formatCount(c.crmLeads)} leads.`);
    });
  }

  const leak = findLeak(input);
  if (leak.weaker === null) {
    lines.push("Where the funnel leaks: not enough leads yet to tell.");
  } else {
    const step = leak.weaker === "kyc" ? "lead to approved KYC" : "approved KYC to funded";
    const rate = leak.weaker === "kyc" ? leak.leadToKyc : leak.kycToFunded;
    lines.push(`Where the funnel leaks: the weaker step is ${step} (${formatPercent(rate)}).`);
  }
  const lowKyc = input.campaigns.filter((c) => eligible(c) && c.kycRate !== null).sort((a, b) => (a.kycRate ?? 0) - (b.kycRate ?? 0))[0];
  if (lowKyc) lines.push(`Lowest KYC rate among campaigns with enough leads: ${lowKyc.label} (${lowKyc.channel}), ${formatPercent(lowKyc.kycRate)}.`);

  const tests: string[] = [];
  for (const c of input.campaigns.filter((x) => x.quality === "tracking_gap").slice(0, 2)) {
    tests.push(`Check lead delivery for ${c.label}: the ad platform reports far more leads than the CRM received.`);
  }
  for (const c of input.campaigns.filter((x) => x.quality === "cheap_no_funded").slice(0, 2)) {
    tests.push(`Test a narrower audience for ${c.label}: its leads are cheap but none has funded yet.`);
  }
  if (leak.weaker === "kyc") tests.push("Test a clearer eligibility question on the lead form, because lead to KYC is the weaker step.");
  if (leak.weaker === "funded") tests.push("Test faster first-call follow-up for approved KYC leads, because KYC to funded is the weaker step.");
  if (leak.kycToFunded !== null && leak.kycToFunded < LOW_FUNDED_RATE && t.kyc >= MIN_LEADS_FOR_VERDICT) tests.push("Look at why approved KYC customers are not funding, before buying more leads.");
  if (leak.leadToKyc !== null && leak.leadToKyc < LOW_KYC_RATE && t.crmLeads >= MIN_LEADS_FOR_VERDICT && leak.weaker !== "kyc") tests.push("Review the lead quality at the top of the funnel: few leads reach approved KYC.");
  if (tests.length === 0) tests.push("Keep the current mix and read again next week; no clear test stands out.");
  lines.push("What to test next:");
  tests.slice(0, 4).forEach((t2, i) => lines.push(`${i + 1}. ${t2}`));

  lines.push("Caveat: outcomes follow the leads created in the range, so recent campaigns look worse until their leads have had time to fund.");
  lines.push("Recommendations only: nothing has been changed, paused or sent.");
  return lines.join("\n").slice(0, MAX_TEXT);
}

export const SYSTEM_PROMPT = [
  "You are a marketing analyst for a regulated Indian investment broking firm.",
  "Use only the figures in the message. Do not guess, do not name or describe any customer, and do not give investment advice.",
  "Never promise or imply returns or guaranteed results. Recommend tests to run, never spend changes.",
  "Write at most six short plain-text lines covering: the best campaigns by cost per funded customer, where the funnel leaks, and what to test next.",
  "If the figures are too thin to say something, reply exactly: ABSTAIN: not enough data.",
].join(" ");

/** The aggregates as plain lines for the model. No identifiers exist in the input type, so none are written. */
export function buildUserPrompt(input: AnalystInput): string {
  const cur = input.currency ?? "n/a";
  const t = input.totals;
  const lines = [
    `Range: ${input.from} to ${input.to}. Currency: ${cur}.`,
    `Totals: spend ${t.spend}, CRM leads ${t.crmLeads}, KYC approved ${t.kyc}, funded ${t.funded}, cost per lead ${t.cpl ?? "n/a"}, cost per funded ${t.costPerFunded ?? "n/a"}.`,
    "Campaigns (label | channel | spend | CRM leads | KYC | funded | cost per funded | KYC rate | quality):",
    ...input.campaigns.map((c) => `${c.label} | ${c.channel} | ${c.spend} | ${c.crmLeads} | ${c.kyc} | ${c.funded} | ${c.costPerFunded ?? "n/a"} | ${c.kycRate ?? "n/a"} | ${c.quality}`),
  ];
  return lines.join("\n");
}

const REFUSE: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // an email address
  /\+?\d(?:[ -]?\d){9,14}/, // a phone-like number: ten or more digits; a date such as 2026-10-14 does not match
  /\b[A-Z]{5}\d{4}[A-Z]\b/i, // a PAN-shaped code
  /guarantee|assured return|risk[- ]free/i, // a promise of returns
];

/** The model's text is used only when it is short, plain and free of identifiers and promises. */
export function acceptModelText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty model text" };
  if (trimmed.length > MAX_TEXT) return { ok: false, reason: "model text too long" };
  if (REFUSE.some((re) => re.test(trimmed))) return { ok: false, reason: "model text refused by the output check" };
  return { ok: true, text: trimmed };
}

export type AnalysisDeps = {
  env: Record<string, string | undefined>;
  callModel?: (input: CallInput) => Promise<GatewayResult>;
};

export type AnalysisResult =
  | { status: "off"; reason: string }
  | { status: "ok"; source: "model" | "deterministic"; body: string; note: string | null; provider: string | null; model: string | null; inputTokens: number; outputTokens: number };

/**
 * The agent's one entry point. Off unless MARKETING_ANALYST_ENABLED is "1" and AI_KILL_SWITCH is not "1" (it stays off without a clear kill switch).
 * With no AI key, or any model failure, the deterministic read is returned and says why.
 */
export async function runMarketingAnalysis(input: AnalystInput, deps: AnalysisDeps): Promise<AnalysisResult> {
  if (deps.env.MARKETING_ANALYST_ENABLED !== "1") return { status: "off", reason: "MARKETING_ANALYST_ENABLED is not 1" };
  if (deps.env.AI_KILL_SWITCH === "1") return { status: "off", reason: "AI_KILL_SWITCH is on" };

  const deterministic = (note: string | null): AnalysisResult => ({
    status: "ok",
    source: "deterministic",
    body: deterministicSummary(input),
    note,
    provider: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
  });

  const provider = deps.env.AI_PROVIDER ?? "anthropic";
  if (!deps.callModel || !isProviderConfigured(provider, deps.env as NodeJS.ProcessEnv)) return deterministic("no AI key is set: deterministic read");

  const result = await deps.callModel({
    purpose: "marketing.analysis",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    maxTokens: 600,
    timeoutMs: 30_000,
  });

  switch (result.kind) {
    case "ok": {
      const checked = acceptModelText(result.text);
      if (!checked.ok) return deterministic(`model text not used: ${checked.reason}`);
      if (/^ABSTAIN\b/i.test(checked.text)) return deterministic("model abstained: not enough data");
      return {
        status: "ok",
        source: "model",
        body: checked.text,
        note: null,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      };
    }
    case "abstain":
      return deterministic(`model abstained: ${result.reason}`);
    case "blocked":
      return deterministic(`model blocked: ${result.reason}`);
    case "failed":
      return deterministic(`model unavailable (${result.errorClass}): deterministic read`);
  }
}
