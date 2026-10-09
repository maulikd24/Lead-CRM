import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/lib/nav-items";
import { composeInsights, type InsightsData, type RawInsights } from "@/lib/insights/compose";
import { OutcomeMixPanel, ReplyDelayChart } from "./charts";
import { CountUp, formatCount } from "./count-up";
import { RangeControl } from "./range-control";
import { AbPanel, AgentQualityPanel, ConversionTable, Drilldown, JourneyFunnel, KpiTiles, ObjectionHeat, ResponseTables, SuggestionsPanel } from "./sections";

const NOW = new Date("2026-10-09T12:00:00Z");
const D = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * D);

const empty: RawInsights = {
  now: NOW, days: 30, outcomes: [], sentDrafts: [], proposals: [], outbound: [], inbound: [], milestones: new Map(), objectionsCurrent: [], objectionsPrevious: [],
  stages: [], journeyClients: [], history: [], drilldown: [], truncated: false,
};

function populated(): InsightsData {
  const outcome = (i: number, outcome: "INTERESTED" | "NOT_INTERESTED", assetClass: string) => ({
    clientId: `c${i}`, outcome, channel: "WHATSAPP", actorType: "RM", rmId: "u1", rmName: "RM One", assetClass, programme: "Complete KYC", language: "English", createdAt: ago(20), aiDraftSent: false,
  });
  const proposal = (over: Record<string, unknown> = {}) => ({
    agentKey: "wa_nudger", status: "SENT" as const, blockedReason: null, model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 100, body: "Hi", originalBody: "Hi",
    programme: "Complete KYC", createdAt: ago(5), decidedAt: ago(5), decidedById: "u1", expiresAt: ago(-1), messageId: "m", ...over,
  });
  return composeInsights({
    ...empty,
    outcomes: [outcome(1, "INTERESTED", "Mutual Funds"), outcome(2, "NOT_INTERESTED", "PMS")],
    proposals: [proposal(), proposal({ status: "BLOCKED", decidedById: null, blockedReason: "JUDGE: x", messageId: null })],
    objectionsCurrent: [{ assetClass: "PMS", text: "lock-in is too long" }],
    stages: [{ id: "s1", name: "Lead", sequence: 1 }, { id: "s2", name: "KYC", sequence: 2 }],
    journeyClients: [{ id: "a", createdAt: ago(10), currentStageId: "s2" }],
    history: [{ clientId: "a", fromStageId: "s1", toStageId: "s2", changedAt: ago(8) }],
    drilldown: [{ clientId: "c2", firstName: "Asha", clientCode: "CL-00002", outcome: "NOT_INTERESTED", assetClass: "PMS", at: ago(20) }],
    outbound: [{ id: "m1", clientId: "c1", sentAt: ago(10), language: "English", viaAgent: true }],
    inbound: [{ clientId: "c1", at: new Date(ago(10).getTime() + 1_800_000) }],
  });
}

describe("CountUp", () => {
  it("renders the final value for assistive tech and the first paint", () => {
    const html = renderToStaticMarkup(<CountUp value={1234} />);
    expect(html).toContain('class="sr-only">1,234<');
    expect(html).toContain('aria-hidden="true"');
  });
  it("formats decimals, prefix and suffix", () => {
    expect(formatCount(12.345, 1, "$", " h")).toBe("$12.3 h");
  });
});

describe("empty period", () => {
  const data = composeInsights(empty);
  it("KPI tiles show dashes and n/a instead of invented numbers", () => {
    const html = renderToStaticMarkup(<KpiTiles kpis={data.kpis} />);
    expect(html).toContain("Outcomes logged");
    expect(html).toContain("n/a");
    expect(html).toContain("—");
  });
  it("every panel renders an empty state", () => {
    expect(renderToStaticMarkup(<OutcomeMixPanel mix={data.mix} />)).toContain("No outcomes recorded in this period");
    expect(renderToStaticMarkup(<ReplyDelayChart buckets={data.response.buckets} />)).toContain("No replies yet");
    expect(renderToStaticMarkup(<ObjectionHeat objections={data.objections} />)).toContain("No concerns recorded");
    expect(renderToStaticMarkup(<JourneyFunnel funnel={data.funnel} />)).toContain("No customers joined");
    expect(renderToStaticMarkup(<AgentQualityPanel agents={data.agents} />)).toContain("No agent drafts");
    expect(renderToStaticMarkup(<AbPanel aiVsRm={data.aiVsRm} />)).toContain("No messages to compare");
    expect(renderToStaticMarkup(<ConversionTable conversion={data.conversion} />)).toContain("Nothing mature enough yet");
    expect(renderToStaticMarkup(<ResponseTables response={data.response} />)).toContain("No messages old enough");
    expect(renderToStaticMarkup(<Drilldown rows={data.drilldown} />)).toContain("No declines");
    expect(renderToStaticMarkup(<SuggestionsPanel suggestions={data.suggestions} />)).toContain("Not enough data yet");
  });
});

describe("populated period", () => {
  const data = populated();
  it("outcome mix offers a text table and pressed-state buttons", () => {
    const html = renderToStaticMarkup(<OutcomeMixPanel mix={data.mix} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Outcome mix by asset class");
    expect(html).toContain("Mutual Funds");
  });
  it("objection heat table has a caption and counts, and never prints customer wording", () => {
    const html = renderToStaticMarkup(<ObjectionHeat objections={data.objections} />);
    expect(html).toContain("Lock-in / liquidity");
    expect(html).toContain("<caption");
    expect(html).not.toContain("too long");
  });
  it("funnel gives each bar a text alternative", () => {
    const html = renderToStaticMarkup(<JourneyFunnel funnel={data.funnel} />);
    expect(html).toContain('aria-label="Lead: 1 of 1 customers reached this stage"');
    expect(html).toContain("moved on");
  });
  it("agent panel labels cost as an estimate and keeps judge wording out", () => {
    const html = renderToStaticMarkup(<AgentQualityPanel agents={data.agents} />);
    expect(html).toContain("WhatsApp nudger");
    expect(html).toContain("Est. cost per approved message");
    expect(html).toContain("not billing data");
    expect(html).toContain("LLM judge 1");
  });
  it("unknown models read n/a", () => {
    const unknown = composeInsights({
      ...empty,
      proposals: [{ agentKey: "wa_nudger", status: "SENT", blockedReason: null, model: "mystery", inputTokens: 10, outputTokens: 1, body: "a", originalBody: "a", programme: null, createdAt: ago(3), decidedAt: ago(3), decidedById: "u", expiresAt: ago(-1), messageId: "m" }],
    });
    const html = renderToStaticMarkup(<AgentQualityPanel agents={unknown.agents} />);
    expect(html).toContain("n/a");
    expect(html).toContain("Model not in price table: mystery");
  });
  it("A/B panel says too early for a tiny sample", () => {
    expect(renderToStaticMarkup(<AbPanel aiVsRm={{ a: { successes: 3, n: 4 }, b: { successes: 1, n: 5 } }} />)).toContain("Too early to call");
  });
  it("drill-down shows first name and client code only", () => {
    const html = renderToStaticMarkup(<Drilldown rows={data.drilldown} />);
    expect(html).toContain("Asha");
    expect(html).toContain("CL-00002");
  });
  it("suggestions panel gives every item its evidence", () => {
    const html = renderToStaticMarkup(<SuggestionsPanel suggestions={data.suggestions} />);
    expect(html).toContain("Evidence:");
  });
});

describe("navigation", () => {
  it("range control marks the current range", () => {
    const html = renderToStaticMarkup(<RangeControl days={30} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("/agents/insights?days=7");
  });
  it("does not add a sidebar entry (Cmd+K and the Agents page only)", () => {
    expect(NAV_ITEMS.some((i) => i.href.startsWith("/agents/insights"))).toBe(false);
  });
});
