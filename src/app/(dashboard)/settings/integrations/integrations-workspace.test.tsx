import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { aiSafetyItems, type StatusRow } from "@/lib/integrations/overview";
import { IntegrationCard } from "./integration-card";
import { IntegrationsRail } from "./integrations-rail";
import { PROVIDER_META } from "./provider-meta";
import { SafetyCard } from "./safety-card";

vi.mock("./actions", () => ({
  setIntegrationModeAction: vi.fn(),
  saveIntegrationCredentialsAction: vi.fn(),
  testIntegrationConnectionAction: vi.fn(),
  markPartnerContractVerifiedAction: vi.fn(),
}));

const html = (n: React.ReactElement) => renderToStaticMarkup(n);

describe("IntegrationCard status", () => {
  const card = (status?: { state: "connected" | "mock" | "needs_setup" | "flag_off"; flagName?: string }) =>
    html(<IntegrationCard provider="meta_ads" meta={PROVIDER_META.meta_ads} config={null} status={status} />);
  it("shows the state in words next to Live or Mock", () => {
    expect(card({ state: "needs_setup" })).toContain("Needs setup");
    expect(card({ state: "connected" })).toContain("Connected");
  });
  it("gives deliberate Mock mode its own badge and says nothing is broken", () => {
    const out = card({ state: "mock" });
    expect(out).toContain("Mock mode");
    expect(out).not.toContain("Needs setup");
  });
  it("explains a flag-off card and names the server switch", () => {
    const out = card({ state: "flag_off", flagName: "META_ADS_SYNC_ENABLED" });
    expect(out).toContain("Flag off");
    expect(out).toContain("META_ADS_SYNC_ENABLED");
    expect(out).toContain("Nothing runs for this until it is turned on.");
  });
  it("still works with no status, as before", () => {
    expect(card()).toContain("Use live credentials");
  });
  it("uses no hard-coded colours", () => {
    expect(card({ state: "needs_setup" })).not.toMatch(/text-green-\d|text-red-\d|bg-\w+-\d{3}/);
  });
});

describe("SafetyCard", () => {
  it("is read-only status: a state, what it is for, and which setting, never a form", () => {
    const item = aiSafetyItems({ AGENT_NUDGER_ENABLED: "1" }).find((i) => i.id === "nudger")!;
    const out = html(<SafetyCard item={item} index={0} />);
    expect(out).toContain("Connected");
    expect(out).toContain("AGENT_NUDGER_ENABLED");
    expect(out).not.toMatch(/<input|<button|<form/);
  });
});

describe("IntegrationsRail", () => {
  const rows: StatusRow[] = [
    { id: "whatsapp_meta", label: "WhatsApp (Meta Cloud API)", group: "messaging", state: "connected" },
    { id: "meta_ads", label: "Meta Ads (reporting)", group: "marketing", state: "flag_off", detail: "META_ADS_SYNC_ENABLED" },
    { id: "clevertap", label: "Clevertap", group: "data", state: "needs_setup" },
    { id: "jira", label: "Jira", group: "data", state: "mock" },
  ];
  it("counts connected, needs setup and flag off", () => {
    const out = html(<IntegrationsRail rows={rows} />);
    for (const label of ["Connected", "Mock mode", "Needs setup", "Flag off"]) expect(out).toContain(label);
    expect(out).toContain('aria-label="Integration status"');
  });
  it("lists each integration under its group and links to that group's tab", () => {
    const out = html(<IntegrationsRail rows={rows} />);
    expect(out).toContain("WhatsApp (Meta Cloud API)");
    expect(out).toContain('href="/settings/integrations"');
    expect(out).toContain('href="/settings/integrations?tab=marketing"');
    expect(out).toContain('href="/settings/integrations?tab=data"');
    expect(out).toContain("META_ADS_SYNC_ENABLED");
  });
});
