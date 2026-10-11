import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../agents/actions", () => ({ setAgentEnabledAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/system/status", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { buildAiPanel, type AiPanelRaw } from "@/lib/ai/gateway/panel";
import { AiPanelView } from "./ai-view";

const raw = (over: Partial<AiPanelRaw> = {}): AiPanelRaw => ({
  now: new Date("2026-10-12T10:00:00Z"), windowDays: 7,
  window: [
    { purposeId: "nudger.draft", agentKey: "wa_nudger", status: "OK", runs: 90, inputTokens: 9000, outputTokens: 2000, costUsd: 1.1, p50Ms: 420, p95Ms: 1800 },
    { purposeId: "nudger.draft", agentKey: "wa_nudger", status: "ABSTAINED", runs: 6, inputTokens: 0, outputTokens: 0, costUsd: 0, p50Ms: 5, p95Ms: 9 },
    { purposeId: "nudger.draft", agentKey: "wa_nudger", status: "FAILED", runs: 3, inputTokens: 300, outputTokens: 0, costUsd: 0, p50Ms: 20000, p95Ms: 20000 },
  ],
  today: [{ purposeId: "nudger.draft", costUsd: 4 }], settings: [{ agentKey: "wa_nudger", enabled: true }], autonomy: [],
  env: { AGENT_NUDGER_ENABLED: "1", AI_PURPOSE_BUDGETS_USD: "nudger.draft=5" }, oldestRun: new Date("2026-08-01T00:00:00Z"), ...over,
});

describe("AiPanelView", () => {
  const html = renderToStaticMarkup(<AiPanelView data={buildAiPanel(raw())} />);
  it("shows the headline figures and every registered purpose with its budget state", () => {
    expect(html).toContain("Runs, 7 days");
    expect(html).toContain("nudger.draft");
    expect(html).toContain("ask.intelligence");
    expect(html).toContain("No budget set");
    expect(html).toContain("Near the cap");
    expect(html).toContain("$4.00 of $5.00");
  });
  it("shows failure and abstain rates, never NaN", () => {
    expect(html).toContain("3.0% / 6.1%");
    expect(html).not.toContain("NaN");
    expect(html).toContain("n/a");
  });
  it("shows each agent's ladder with its ceiling and the real kill-switch halves", () => {
    expect(html).toContain("L3 draft");
    expect(html).toContain("ceiling L4");
    expect(html).toContain("AGENT_NUDGER_ENABLED");
    expect(html).toContain("Turn setting off");
    expect(html).toContain("only AI_KILL_SWITCH stops it");
  });
  it("says so loudly when the global kill switch is on", () => {
    const off = renderToStaticMarkup(<AiPanelView data={buildAiPanel(raw({ env: { AI_KILL_SWITCH: "1" } }))} />);
    expect(off).toContain("AI is switched off");
  });
  it("is honest about what it keeps", () => expect(html).toContain("No prompt, answer or customer text is stored"));
  it("offers no way to raise an autonomy level (read-only first)", () => expect(html).not.toMatch(/<button[^>]*>[^<]*(Raise|Set level)/i));
});
