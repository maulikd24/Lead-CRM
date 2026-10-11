import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/system/status", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { buildFlagsPanel } from "@/lib/flags/panel";
import { PROFILES, PROFILE_NAMES } from "@/lib/flags/profiles";
import { REGISTRY } from "@/lib/flags/registry";
import { FlagsPanel } from "./flags-view";

const env = { NEXT_PUBLIC_C360: "1", PARTNER_WORKSPACE_ENABLED: "1", AGENT_NUDGER_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test-LEAKCHECK77", DATABASE_URL: "postgresql://u:LEAKPW@db.example.com/x", AI_PROVIDER: "openai" };

describe("FlagsPanel", () => {
  const html = renderToStaticMarkup(<FlagsPanel data={buildFlagsPanel(env)} />);

  it("shows every registered flag with its current effective value", () => {
    for (const f of REGISTRY) expect(html, f.name).toContain(f.name);
    expect(html).toContain("openai");
  });

  it("labels public flags as set at build and says a change needs a rebuild", () => {
    expect(html).toContain("set at build");
    expect(html).toMatch(/rebuild/i);
  });

  it("shows the validation errors with their rule id, flag and how to fix them", () => {
    expect(html).toContain("FR-10");
    expect(html).toContain("AGENT_NUDGER_ENABLED");
    expect(html).toMatch(/Set CONSENT_ENFORCEMENT=1/);
  });

  it("compares the environment with the five profiles", () => {
    for (const p of PROFILE_NAMES) expect(html).toContain(p);
    expect(html).toContain(PROFILES["go-live"].purpose);
    expect(html).toMatch(/Closest profile/i);
  });

  it("never prints a secret or a connection string", () => {
    for (const leak of ["LEAKCHECK77", "LEAKPW", "db.example.com", "postgresql://"]) expect(html).not.toContain(leak);
  });

  it("is read-only: no form, no button, no input", () => {
    expect(html).not.toMatch(/<form|<button|<input|<select|<textarea/);
  });

  it("says plainly when the environment has no finding", () => {
    const clean = renderToStaticMarkup(<FlagsPanel data={buildFlagsPanel({ NODE_ENV: "production", AUTH_SECRET: "x", CRON_SECRET: "x", ENCRYPTION_KEY: "x" })} />);
    expect(clean).toContain("No rule is broken");
  });
});
