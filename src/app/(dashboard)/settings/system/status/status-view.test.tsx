import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ setCutoverTickAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/system/status", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { CUTOVER_CHECKS } from "@/lib/system/cutover-checks";
import type { SystemStatus } from "@/lib/system/status";
import { ChecksPanel, JobsPanel, OverviewPanel } from "./status-view";

const status: SystemStatus = {
  generatedAt: "2026-10-12T04:00:00.000Z",
  app: { commit: "0123456789abcdef", shortCommit: "0123456", branch: "main", deployEnv: "production", nodeEnv: "production" },
  database: { connected: true, name: "db1", serverVersion: "16.4", latencyMs: 7 },
  migrations: { applied: 63, failed: [], latest: "20270405000000_ai_pilot", pending: 0, onDisk: 63 },
  flags: { on: [{ name: "NEXT_PUBLIC_NAV_V2", label: "Primary navigation only", buildTime: true }, { name: "WA_ASSIST_ENABLED", label: "Reply assistant", buildTime: false }], off: ["SSO_ENABLED"], settings: [{ name: "CONSENT_RECORD_ONLY_PURPOSES", value: "AI_PROCESSING_OF_CHATS" }], check: { errors: 0, warnings: 0, findings: [] } },
  cron: { tick: { state: "ticking", minutesAgo: 3 }, jobs: [{ name: "daily_leads_report", lastRunAt: "2026-10-11T15:30:00.000Z" }] },
  queues: [{ key: "whatsapp_outbox", label: "WhatsApp messages waiting to send", depth: 2, oldestMinutes: 20, level: "attention" }, { key: "agent_drafts", label: "Agent drafts waiting for review", depth: 0, oldestMinutes: null, level: "ok" }],
  integrations: [{ key: "freshdesk", label: "Freshdesk", state: "connected", note: "Live" }, { key: "meta_ads", label: "Meta Ads", state: "flag_off", note: "Off" }, { key: "jira", label: "Jira", state: "mock", note: "Mock" }, { key: "sso", label: "Single sign-on", state: "needs_setup", note: "Missing" }],
  env: [{ name: "CRON_SECRET", present: true, required: true, note: "x" }, { name: "APP_SIGNUP_SECRET", present: false, required: false, note: "y" }],
  attention: ["WhatsApp messages waiting to send: the oldest item has waited 20 minutes."],
};

describe("OverviewPanel", () => {
  it("shows version, database, migrations and the flags that are on", () => {
    const html = renderToStaticMarkup(<OverviewPanel status={status} />);
    expect(html).toContain("0123456");
    expect(html).toContain("production");
    expect(html).toContain("db1");
    expect(html).toContain("63 applied");
    expect(html).toContain("NEXT_PUBLIC_NAV_V2");
    expect(html).toContain("needs a redeploy");
    expect(html).toContain("CONSENT_RECORD_ONLY_PURPOSES");
  });
  it("leads with what needs attention, or says nothing does", () => {
    expect(renderToStaticMarkup(<OverviewPanel status={status} />)).toContain("the oldest item has waited 20 minutes");
    expect(renderToStaticMarkup(<OverviewPanel status={{ ...status, attention: [] }} />)).toContain("Nothing needs attention");
  });
  it("says so plainly when the database cannot be reached", () => {
    const html = renderToStaticMarkup(<OverviewPanel status={{ ...status, database: { connected: false, name: null, serverVersion: null, latencyMs: null }, migrations: null }} />);
    expect(html).toContain("Cannot be reached");
  });
});

describe("JobsPanel", () => {
  it("shows the scheduler, queue depths, integration states and env presence, never a value", () => {
    const html = renderToStaticMarkup(<JobsPanel status={status} />);
    expect(html).toContain("Ticking");
    expect(html).toContain("3 minutes ago");
    expect(html).toContain("daily_leads_report");
    expect(html).toContain("WhatsApp messages waiting to send");
    for (const label of ["Connected", "Flag off", "Mock", "Needs setup"]) expect(html).toContain(label);
    expect(html).toContain("CRON_SECRET");
    expect(html).toContain("Not set");
  });
});

describe("ChecksPanel", () => {
  const ticks: Record<string, { done: boolean; note: string | null; byName: string | null; at: string | null }> = { "login-admin": { done: true, note: "fine", byName: "Asha", at: "12 Oct 2026, 9:30 am" } };
  it("lists every check, automatic ones with their result and manual ones with a tick", () => {
    const html = renderToStaticMarkup(<ChecksPanel status={status} ticks={ticks} />);
    for (const c of CUTOVER_CHECKS) expect(html).toContain(c.title.replace(/'/g, "&#x27;"));
    expect(html).toContain("Done by Asha");
    expect(html).toContain("12 Oct 2026");
    expect(html).toMatch(/Mark done/);
  });
  it("counts what is left", () => {
    const manual = CUTOVER_CHECKS.filter((c) => !c.auto).length;
    const html = renderToStaticMarkup(<ChecksPanel status={status} ticks={ticks} />);
    expect(html).toContain(`${manual - 1} of ${manual} manual checks still open`);
  });
});
