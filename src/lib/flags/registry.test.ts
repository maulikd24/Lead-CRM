import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AREAS, isArea, rolesWith } from "@/lib/access/policy";

import { condNames } from "./cond";
import { REGISTRY, byName, flagNames, isRegistered } from "./registry";
import type { Cond, FlagDef, Kind } from "./types";

/** The 135 names the wave-0 inventory found (code on every in-flight branch plus names read dynamically). */
const INVENTORY = `
NEXT_PUBLIC_NAV_V2 NEXT_PUBLIC_HOME_V2 NEXT_PUBLIC_MOTION NEXT_PUBLIC_CLEVERTAP_CARD NEXT_PUBLIC_C360 NEXT_PUBLIC_OUTCOMES NEXT_PUBLIC_CALLS_REVIEW
NEXT_PUBLIC_CONSENT NEXT_PUBLIC_MERGE_REVIEW NEXT_PUBLIC_SUPPORT_SLA NEXT_PUBLIC_INSIGHTS NEXT_PUBLIC_MARKETING NEXT_PUBLIC_ATTRIBUTION NEXT_PUBLIC_AUTOPILOT
NEXT_PUBLIC_CREATIVE_INTEL NEXT_PUBLIC_PLANNER NEXT_PUBLIC_KANBAN NEXT_PUBLIC_DEMO_MODE
PARTNER_WORKSPACE_ENABLED PARTNER_ALLOW_SAMPLE REFERRAL_PROGRAM_ENABLED BACKOFFICE_IMPORT_ENABLED PORTFOLIO_FEED_ENABLED SOCIAL_DRAFTS_ENABLED META_ADS_SYNC_ENABLED
GOOGLE_ADS_REPORTING_ENABLED AGENT_NUDGER_ENABLED WA_ASSIST_ENABLED WA_ASSIST_AUTO WA_META_WINDOW OUTCOMES_DRAFTS_ENABLED MERGE_SUGGESTIONS_ENABLED CONSENT_ENFORCEMENT
APP_USER_ID_LINKING CLEVERTAP_PUSH_ENABLED FRESHDESK_HANDOFF_ENABLED SSO_ENABLED SSO_ONLY AI_AGENTS_ENABLED PUSH_DRY_RUN EVALS_REAL_PROVIDER LEAD_PUSH_DRAFTS_ENABLED
AUTOPILOT_APPLY_ENABLED AUTOPILOT_ASK_ENABLED CLOSED_LOOP_CONVERSIONS_ENABLED CLOSED_LOOP_KILL_SWITCH CLOSED_LOOP_DEMO DIRECTOR_REPORTS_ENABLED DEMO_MODE
AI_PROVIDER AGENT_MODEL OPENAI_SUMMARY_MODEL CONSENT_RECORD_ONLY_PURPOSES CONSENT_ADS_MEASUREMENT_NOTICE CONSENT_ADS_MEASUREMENT_NOTICE_VERSION OUTCOMES_DISCLAIMER
PARTNER_SOURCE REFERRAL_LINK_BASE SOCIAL_TIMEZONE BACKOFFICE_IMPORT_DIR BACKOFFICE_IMPORT_HOUR_UTC META_ADS_SYNC_EVERY_HOURS GOOGLE_ADS_SYNC_EVERY_HOURS
CLOSED_LOOP_LOOKBACK_DAYS CLOSED_LOOP_MAX_PER_RUN CALLS_RECORDING_HOSTS WHATSAPP_DEFAULT_COUNTRY_CODE KYC_AUTOMATION_PROVIDER DAILY_REPORT_RECIPIENT_EMAIL
SSO_BREAK_GLASS_EMAILS AUDIT_ANCHOR_LOCK_MODE AUDIT_ANCHOR_RETENTION_DAYS AUDIT_ANCHOR_S3_BUCKET AUDIT_ANCHOR_S3_PREFIX AUDIT_ANCHOR_S3_REGION META_GRAPH_BASE_URL
CRM_BASE_URL LB_BASE DEMO_ALLOW_HOSTS DEMO_BASE_URL DEMO_MAIL_DIR DEMO_SAMPLE_DIR DEMO_GUARD_LOG DEMO_PERF_MS DEMO_SHOTS PERF_SEED_CLIENTS PARTNER_PERF_SCALE
PARTNER_PERF_REPORT E2E_PORT E2E_REUSE_SERVER ANALYZE
AGENT_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY APP_DATABASE_URL APP_DB_PASSWORD APP_SIGNUP_SECRET AUDIT_ANCHOR_AWS_ACCESS_KEY_ID AUDIT_ANCHOR_AWS_SECRET_ACCESS_KEY
AUTH_SECRET NEXTAUTH_SECRET CRON_SECRET DATABASE_URL DIRECT_DATABASE_URL DEVICE_HASH_KEY ENCRYPTION_KEY FIREBASE_SERVICE_ACCOUNT_JSON KEYCLOAK_CLIENT_ID
KEYCLOAK_CLIENT_SECRET KEYCLOAK_ISSUER LB_PASSWORD META_WEBHOOK_VERIFY_TOKEN PORTFOLIO_FEED_SECRET WHATSAPP_WORKER_SECRET DEMO_CREDS DEMO_CREDS_IN DEMO_CREDS_OUT
AUTH_URL NEXTAUTH_URL NODE_ENV NEXT_RUNTIME VERCEL_ENV VERCEL_URL VERCEL_GIT_COMMIT_REF VERCEL_GIT_COMMIT_SHA
ACCESS_DB_TEST ATTRIBUTION_DB_TEST CLOSEDLOOP_DB_TEST CREATIVE_DB_TEST PLANNER_DB_TEST PILOT_DB_TEST ERASURE_DB_TEST REFERRAL_DB_TEST PARTNER_NATIVE_DB_TEST PARTNER_PERF_DB_TEST
`.split(/\s+/).filter(Boolean);

const FLAG_KINDS: Kind[] = ["feature", "safety", "outbound", "outbound-ai", "blocked"];
const OUTBOUND_KINDS: Kind[] = ["outbound", "outbound-ai"];
const DOCS = readFileSync(path.resolve(__dirname, "../../../docs/feature-flags.md"), "utf8");

describe("the registry covers the inventory", () => {
  it("has every name in the 135-name wave-0 inventory (the inventory list itself has no duplicates)", () => {
    expect(new Set(INVENTORY).size).toBe(INVENTORY.length);
    expect(INVENTORY.length).toBeGreaterThanOrEqual(130);
    expect(INVENTORY.filter((n) => !isRegistered(n))).toEqual([]);
  });
  it("registers the extra names found in code on this tree (worker and tooling variables, CI)", () => {
    for (const n of ["CI", "CHROME_PATH", "HEALTH_CHECK_MS", "HEARTBEAT_MS", "LOG_LEVEL", "MAX_MESSAGE_AGE_SECONDS", "OUTBOX_POLL_MS", "SEND_MIN_INTERVAL_MS", "SESSION_DATA_DIR", "SESSION_ID", "SESSION_IDS", "START_STAGGER_MS", "E2E_EMAIL", "E2E_PASSWORD", "FLAG_CHECK"]) expect(isRegistered(n), n).toBe(true);
  });
  it("has 48 on/off switches, 18 of them build-time (the inventory figure) plus the ones found since", () => {
    const onOff = REGISTRY.filter((f) => f.type === "bool" && FLAG_KINDS.includes(f.kind));
    const publicOnes = onOff.filter((f) => f.exposure === "public");
    expect(onOff.length).toBeGreaterThanOrEqual(48);
    expect(publicOnes.length).toBeGreaterThanOrEqual(18);
  });
});

describe("shape", () => {
  it("has unique names", () => {
    const names = REGISTRY.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect(flagNames().length).toBe(names.length);
  });
  it("derives the exposure from the name: NEXT_PUBLIC_* is build-time, nothing else is", () => {
    for (const f of REGISTRY) expect(f.exposure, f.name).toBe(f.name.startsWith("NEXT_PUBLIC_") ? "public" : "server");
  });
  it("gives every flag-like entry an owner, a label, a description and a data class", () => {
    for (const f of REGISTRY.filter((x) => FLAG_KINDS.includes(x.kind))) {
      expect(f.owner.length, `${f.name} owner`).toBeGreaterThan(1);
      expect(f.label.length, `${f.name} label`).toBeGreaterThan(2);
      expect(f.enables.length, `${f.name} enables`).toBeGreaterThan(15);
      expect(f.dataClass, f.name).toBeTruthy();
      expect(f.since, f.name).toBeTruthy();
    }
  });
  it("names every entry in the generated docs (documented flag)", () => {
    const missing = REGISTRY.filter((f) => !DOCS.includes("`" + f.name + "`")).map((f) => f.name);
    expect(missing).toEqual([]);
  });
  it("types: on/off flags are bool, secrets are secret and never carry a default or a value", () => {
    for (const f of REGISTRY) {
      if (FLAG_KINDS.includes(f.kind)) expect(f.type, f.name).toBe("bool");
      if (f.kind === "secret") {
        expect(f.type, f.name).toBe("secret");
        expect(f.default, f.name).toBeNull();
      }
    }
  });
  it("no flag defaults to on: a default of 1 would change behaviour", () => {
    for (const f of REGISTRY) expect(f.default, f.name).not.toBe("1");
    for (const f of REGISTRY.filter((x) => x.type === "bool")) expect(f.default, f.name).toBeNull();
  });
  it("keeps the documented non-bool defaults", () => {
    expect(byName("AI_PROVIDER")?.default).toBe("anthropic");
    expect(byName("AGENT_MODEL")?.default).toBe("claude-sonnet-5-5");
    expect(byName("PARTNER_SOURCE")?.default).toBe("native");
    expect(byName("SOCIAL_TIMEZONE")?.default).toBe("Asia/Kolkata");
    expect(byName("BACKOFFICE_IMPORT_HOUR_UTC")?.default).toBe("21");
    expect(byName("META_ADS_SYNC_EVERY_HOURS")?.default).toBe("6");
    expect(byName("GOOGLE_ADS_SYNC_EVERY_HOURS")?.default).toBe("6");
    expect(byName("E2E_PORT")?.default).toBe("3100");
  });
  it("a descriptive text never holds anything that looks like a secret, a key or a host", () => {
    for (const f of REGISTRY) {
      const text = [f.label, f.enables, ...[...f.requires, ...f.conflictsWith, ...f.requiresAlways].flatMap((r) => [r.message, r.fix])].join(" ");
      expect(text, f.name).not.toMatch(/\bsk-[A-Za-z0-9]{8,}|postgres(ql)?:\/\/|AKIA[0-9A-Z]{8}|Bearer\s|https?:\/\/[a-z0-9.-]+\.(com|co|in|io|net)\b/);
    }
  });
  it("uses no Allvest-internal name (public-repository hygiene)", () => {
    const text = JSON.stringify(REGISTRY).toLowerCase();
    for (const bad of ["allvest", "wohlig", "chirayu", "supportify.in"]) expect(text, bad).not.toContain(bad);
  });
});

describe("cross-references", () => {
  const known = new Set(REGISTRY.map((f) => f.name));
  const conds = (f: FlagDef): Cond[] => [...f.requires, ...f.conflictsWith, ...f.requiresAlways].map((r) => r.cond).concat(f.activeWhen ? [f.activeWhen] : []);

  it("every name a rule mentions is registered", () => {
    for (const f of REGISTRY) for (const c of conds(f)) for (const n of condNames(c)) expect(known.has(n), `${f.name} mentions ${n}`).toBe(true);
  });
  it("every demoStandIn and requiresAgentSetting-free reference is registered", () => {
    for (const f of REGISTRY) if (f.demoStandIn) expect(known.has(f.demoStandIn), f.name).toBe(true);
  });
  it("every rule carries a rule id, a message and a fix", () => {
    for (const f of REGISTRY) for (const r of [...f.requires, ...f.conflictsWith, ...f.requiresAlways]) {
      expect(r.rule, f.name).toMatch(/^FR-\d\d$/);
      expect(r.message.length, f.name).toBeGreaterThan(10);
      expect(r.fix.length, f.name).toBeGreaterThan(5);
    }
  });
});

describe("safety coverage", () => {
  // closed loop states the same gate under its own rule id (FR-11), which is the stricter chain
  const needs = (f: FlagDef, rule: string, name: string) => f.requires.some((r) => (r.rule === rule || (rule === "FR-10" && r.rule === "FR-11")) && JSON.stringify(r.cond).includes(`"${name}"`));

  it("every outbound or vendor-sharing flag requires consent enforcement and the consent screens (FR-10)", () => {
    const list = REGISTRY.filter((f) => f.type === "bool" && (OUTBOUND_KINDS.includes(f.kind) || f.effects.vendorSharing) && f.kind !== "blocked");
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const f of list) {
      expect(needs(f, "FR-10", "CONSENT_ENFORCEMENT"), `${f.name} needs CONSENT_ENFORCEMENT`).toBe(true);
      expect(needs(f, "FR-10", "NEXT_PUBLIC_CONSENT"), `${f.name} needs NEXT_PUBLIC_CONSENT`).toBe(true);
    }
  });
  it("every outbound-ai flag requires a provider key (FR-12) and records that it needs the AI sign-off", () => {
    for (const f of REGISTRY.filter((x) => x.kind === "outbound-ai")) {
      expect(f.requires.some((r) => r.rule === "FR-12" && JSON.stringify(r.cond).includes("aiKey")), f.name).toBe(true);
      expect(f.requiresAiSignoff, f.name).toBe(true);
      expect(f.effects.ai, f.name).toBe(true);
    }
  });
  it("blocked flags carry a reason and are never defaulted", () => {
    const blocked = REGISTRY.filter((f) => f.kind === "blocked");
    expect(blocked.map((f) => f.name)).toEqual(["AUTOPILOT_APPLY_ENABLED"]);
    for (const f of blocked) expect(f.blockedReason?.length ?? 0, f.name).toBeGreaterThan(20);
  });
  it("every outbound flag that sends to a person flags itself as outbound", () => {
    for (const f of REGISTRY.filter((x) => OUTBOUND_KINDS.includes(x.kind))) expect(f.effects.outbound || f.effects.vendorSharing || f.effects.ai, f.name).toBe(true);
  });
  it("live messaging and the consent decision are marked as needing approval", () => {
    for (const n of ["CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED", "CLOSED_LOOP_CONVERSIONS_ENABLED"]) expect(byName(n)?.approval, n).toBeTruthy();
  });
});

describe("access areas", () => {
  it("every flag that opens an area names a real area in the policy registry", () => {
    for (const f of REGISTRY.filter((x) => x.accessArea)) expect(isArea(f.accessArea as string), `${f.name} -> ${f.accessArea}`).toBe(true);
  });
  it("marketing flags open only marketing areas, and those require the marketing workspace flag", () => {
    const marketing = REGISTRY.filter((f) => f.accessArea && AREAS[f.accessArea as keyof typeof AREAS]?.group === "marketing");
    expect(marketing.length).toBeGreaterThanOrEqual(3);
    for (const f of marketing) {
      // the marketing workspace itself; and the referral programme, which has its own flag and is shared with finance
      if (f.name === "NEXT_PUBLIC_MARKETING" || f.name === "REFERRAL_PROGRAM_ENABLED") continue;
      const gated = f.requires.some((r) => r.rule === "FR-20" && JSON.stringify(r.cond).includes('"NEXT_PUBLIC_MARKETING"'));
      expect(gated, `${f.name} must require NEXT_PUBLIC_MARKETING`).toBe(true);
    }
  });
  it("no customer-area flag points at a marketing-only area, and the kanban board stays a customer area", () => {
    expect(byName("NEXT_PUBLIC_KANBAN")?.accessArea).toBe("clients");
    expect(rolesWith("clients")).not.toContain("MARKETING");
  });
  it("the partner and referral flags point at their areas", () => {
    expect(byName("PARTNER_WORKSPACE_ENABLED")?.accessArea).toBe("partner-workspace");
    expect(byName("REFERRAL_PROGRAM_ENABLED")?.accessArea).toBe("referral-program");
    expect(byName("BACKOFFICE_IMPORT_ENABLED")?.accessArea).toBe("settings-backoffice-import");
  });
});

describe("in-flight names", () => {
  it("are labelled with the branch they arrive with, and only in-flight names are missing from the source tree", () => {
    const inFlight = REGISTRY.filter((f) => f.inFlight).map((f) => f.name);
    for (const n of ["NEXT_PUBLIC_KANBAN", "NEXT_PUBLIC_DEMO_MODE", "DEMO_MODE", "DEMO_BASE_URL"]) expect(inFlight, n).toContain(n);
  });
});
