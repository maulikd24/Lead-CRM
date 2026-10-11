import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REGISTRY } from "../flags/registry";
import { FLAGS, SETTINGS, flagIsOn } from "./flag-registry";

const docs = readFileSync(path.resolve(__dirname, "../../../docs/feature-flags.md"), "utf8");
const documented = [...docs.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]);

describe("flag registry", () => {
  it("lists every on/off flag the flag docs document, so the status page cannot drift from the docs", () => {
    // The docs are generated from the canonical registry: every documented switch must be registered, and every registered
    // switch that exists in this code must be on the status page. (Names that arrive with an unmerged branch are registered
    // and documented but not listed here until their code lands.)
    const isFlag = (n: string) => /^(NEXT_PUBLIC_[A-Z0-9_]+|[A-Z0-9_]+_(ENABLED|ENFORCEMENT|LINKING|ONLY)|WA_ASSIST_AUTO|WA_META_WINDOW|PARTNER_ALLOW_SAMPLE)$/.test(n);
    const registered = new Set(REGISTRY.map((f) => f.name));
    expect([...new Set(documented.filter(isFlag))].filter((n) => !registered.has(n))).toEqual([]);
    const listed = new Set(FLAGS.map((f) => f.name));
    const documentedNow = [...new Set(documented.filter(isFlag))].filter((n) => !REGISTRY.find((f) => f.name === n)?.inFlight && REGISTRY.find((f) => f.name === n)?.type === "bool" && !["ERASURE_DB_TEST", "REFERRAL_DB_TEST", "PARTNER_NATIVE_DB_TEST", "PARTNER_PERF_DB_TEST"].includes(n));
    expect(documentedNow.filter((n) => !listed.has(n))).toEqual([]);
  });
  it("keeps the 31 switches the status page listed before the registry took over", () => {
    const original = "NEXT_PUBLIC_NAV_V2 NEXT_PUBLIC_HOME_V2 NEXT_PUBLIC_MOTION NEXT_PUBLIC_CLEVERTAP_CARD NEXT_PUBLIC_C360 NEXT_PUBLIC_OUTCOMES NEXT_PUBLIC_CALLS_REVIEW NEXT_PUBLIC_CONSENT NEXT_PUBLIC_MERGE_REVIEW NEXT_PUBLIC_SUPPORT_SLA NEXT_PUBLIC_INSIGHTS NEXT_PUBLIC_MARKETING PARTNER_WORKSPACE_ENABLED PARTNER_ALLOW_SAMPLE REFERRAL_PROGRAM_ENABLED BACKOFFICE_IMPORT_ENABLED PORTFOLIO_FEED_ENABLED SOCIAL_DRAFTS_ENABLED META_ADS_SYNC_ENABLED GOOGLE_ADS_REPORTING_ENABLED AGENT_NUDGER_ENABLED WA_ASSIST_ENABLED WA_ASSIST_AUTO WA_META_WINDOW OUTCOMES_DRAFTS_ENABLED MERGE_SUGGESTIONS_ENABLED CONSENT_ENFORCEMENT APP_USER_ID_LINKING CLEVERTAP_PUSH_ENABLED FRESHDESK_HANDOFF_ENABLED SSO_ENABLED SSO_ONLY".split(" ");
    const names = FLAGS.map((f) => f.name);
    expect(original.filter((n) => !names.includes(n))).toEqual([]);
    const settings = SETTINGS.map((s) => s.name);
    for (const n of ["CONSENT_RECORD_ONLY_PURPOSES", "SOCIAL_TIMEZONE", "BACKOFFICE_IMPORT_HOUR_UTC", "META_ADS_SYNC_EVERY_HOURS", "GOOGLE_ADS_SYNC_EVERY_HOURS", "PARTNER_SOURCE", "AI_PROVIDER", "AGENT_MODEL"]) expect(settings).toContain(n);
  });

  it("has unique names and no secret-looking variable", () => {
    const names = [...FLAGS.map((f) => f.name), ...SETTINGS.map((s) => s.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/SECRET|TOKEN|PASSWORD|KEY$|_URL$|CREDENTIAL/);
  });

  it("a flag is on only for the exact value 1", () => {
    expect(flagIsOn({ A: "1" }, "A")).toBe(true);
    for (const v of ["true", "TRUE", "yes", "0", "", " 1", "1 ", undefined]) expect(flagIsOn({ A: v }, "A")).toBe(false);
  });

  it("marks the build-time flags (they need a redeploy to change)", () => {
    for (const f of FLAGS) expect(f.buildTime).toBe(f.name.startsWith("NEXT_PUBLIC_"));
  });
});
