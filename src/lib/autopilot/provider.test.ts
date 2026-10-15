import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { createFakeActionProvider, guarded } from "./actions";
import { getActionProvider } from "./provider";
import type { Recommendation } from "./recommendations";

/**
 * The real ad-platform adapter is NOT wired. The only provider the app can use is the unconfigured one, which refuses everything, whatever the switches say;
 * no Autopilot file holds a credential, a platform URL or a tool name that writes to an ad account. Connecting the owner's account is a separate, deliberate
 * step (an Admin, in Settings, never in chat), and the apply flag itself is blocked by the flag registry in every environment.
 */
const approved: Recommendation = { id: "BD1:m1", ruleKey: "BD1", category: "Bidding", severity: "high", issue: "i", evidence: [], action: { kind: "pause_campaign", targetIds: ["m1"], summary: "s", params: {} }, impact: { amount: null, text: "" }, confidence: "high", appliable: true, status: "APPROVED" };
const spec = { name: "n", platform: "meta" as const, objective: "funded_customers", dailyBudget: 100, geo: {}, schedule: {}, bidding: {}, landingUrl: "https://example.test", copy: { headline: "h", body: "b" }, audience: {} };

describe("the production provider is the unconfigured one", () => {
  it("refuses apply, launch and activate even with the apply switch forced on", async () => {
    const p = getActionProvider({ AUTOPILOT_APPLY_ENABLED: "1" });
    expect(p.name).toBe("unconfigured");
    expect(await p.apply(approved, "u1")).toMatchObject({ ok: false, error: expect.stringMatching(/No ad-account connection/) });
    expect(await p.launchPaused(spec, "u1")).toMatchObject({ ok: false, error: expect.stringMatching(/No ad-account connection/) });
    expect(await p.activate({ externalId: "x", status: "LAUNCHED_PAUSED", createdById: "a", complianceOk: true, annexureApproved: true }, "u2")).toMatchObject({ ok: false });
  });
  it("with the switch off (the default) it says applying is switched off", async () => {
    expect(await getActionProvider({}).apply(approved, "u1")).toMatchObject({ ok: false, error: expect.stringMatching(/switched off/) });
    expect(getActionProvider({}).applyEnabled).toBe(false);
  });
});

describe("launch drafts are created paused and turned on by a second person", () => {
  it("a campaign is created PAUSED (the spec has no status to set) and activation needs a different person", async () => {
    const fake = createFakeActionProvider();
    const p = guarded(fake, { applyEnabled: true });
    const made = await p.launchPaused(spec, "creator");
    expect(made).toMatchObject({ ok: true });
    expect([...fake.campaigns.values()]).toEqual(["PAUSED"]);
    expect(Object.keys(spec)).not.toContain("status");
    const draft = { externalId: (made as { externalId: string }).externalId, status: "LAUNCHED_PAUSED", createdById: "creator", complianceOk: true, annexureApproved: true };
    expect(await p.activate(draft, "creator")).toMatchObject({ ok: false, error: expect.stringMatching(/second person/) });
    expect([...fake.campaigns.values()]).toEqual(["PAUSED"]);
    expect(await p.activate({ ...draft, annexureApproved: false }, "other")).toMatchObject({ ok: false });
    expect(await p.activate({ ...draft, complianceOk: false }, "other")).toMatchObject({ ok: false });
    expect(await p.activate(draft, "other")).toMatchObject({ ok: true });
  });
  it("an http landing page and a zero budget are refused before anything is created", async () => {
    const fake = createFakeActionProvider();
    const p = guarded(fake, { applyEnabled: true });
    expect(await p.launchPaused({ ...spec, landingUrl: "http://example.test" }, "u")).toMatchObject({ ok: false });
    expect(await p.launchPaused({ ...spec, dailyBudget: 0 }, "u")).toMatchObject({ ok: false });
    expect(fake.log).toEqual([]);
  });
});

describe("no platform credential, URL or write tool anywhere in Autopilot", () => {
  const SRC = join(process.cwd(), "src");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.testkit\.ts$/.test(name)) out.push(full);
    }
    return out;
  };
  const files = [...walk(join(SRC, "lib/autopilot")), ...walk(join(SRC, "app/(dashboard)/autopilot"))];
  it("holds no token, secret, platform host or MCP write tool name, and imports no ad-platform adapter", () => {
    const bad = /graph\.facebook|googleads\.googleapis|access_token|ACCESS_TOKEN|META_APP_SECRET|appsecret|mcp__|ads_(create|update|activate|boost|delete)|from "@\/lib\/integrations\/adapters\/(meta|google)-ads"|from "@\/lib\/marketing\/(meta-ads|sync-meta|sync-google|providers)/;
    expect(files.filter((f) => bad.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f))).toEqual([]);
  });
});
