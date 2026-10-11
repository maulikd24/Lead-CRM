import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { EMAIL_PROVIDERS, INTEGRATION_PROVIDERS } from "@/lib/integrations/registry";
import { MESSAGING_CHANNELS, messagingProviderKeyFor } from "@/lib/messaging/registry";

import { collectSystemStatus, type StatusDeps } from "./status";

const NOW = new Date("2026-10-12T04:00:00Z");
const MIN = 60_000;

function deps(over: Partial<StatusDeps> = {}): StatusDeps {
  return {
    ping: async () => ({ database: "supportify_prod", serverVersion: "16.4" }),
    migrations: async () => ({ applied: ["20260101_a", "20260102_b", "20270405000000_ai_pilot"], failed: [] }),
    migrationsOnDisk: async () => ["20260101_a", "20260102_b", "20270405000000_ai_pilot"],
    heartbeatAgeMs: async () => 2 * MIN,
    dailyJobs: async () => [{ name: "daily_leads_report", at: new Date(NOW.getTime() - 7 * 3600_000) }],
    queueFacts: async () => ({ whatsappQueued: { n: 0, oldest: null }, draftsWaiting: { n: 3, oldest: new Date(NOW.getTime() - 30 * MIN) }, leadErrors7d: 0, reviewsBacklog: { n: 0, oldest: null }, mergeOpen: 12 }),
    integrationRows: async () => [],
    aiKeySaved: async () => false,
    ...over,
  };
}
const GOOD_ENV = { DATABASE_URL: "postgres://u:supersecretpw@h/d", DIRECT_DATABASE_URL: "postgres://u:supersecretpw@h/d", ENCRYPTION_KEY: "ab".repeat(32), AUTH_SECRET: "s3cret-auth", NEXTAUTH_URL: "https://crm.example.test", CRON_SECRET: "cron-secret-value", DAILY_REPORT_RECIPIENT_EMAIL: "ops@example.test", WHATSAPP_WORKER_SECRET: "w-secret", META_WEBHOOK_VERIFY_TOKEN: "meta-verify", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567", VERCEL_GIT_COMMIT_REF: "main", VERCEL_ENV: "production", NODE_ENV: "production" };

describe("collectSystemStatus", () => {
  it("reports the app version, the database and the migration state", async () => {
    const s = await collectSystemStatus(deps(), GOOD_ENV, NOW);
    expect(s.app).toMatchObject({ shortCommit: "0123456", branch: "main", deployEnv: "production" });
    expect(s.database).toMatchObject({ connected: true, name: "supportify_prod", serverVersion: "16.4" });
    expect(s.migrations).toMatchObject({ applied: 3, failed: [], pending: 0, latest: "20270405000000_ai_pilot" });
    expect(s.attention).toEqual([]);
  });

  it("says unknown when no commit is exposed, instead of failing", async () => {
    const s = await collectSystemStatus(deps(), { ...GOOD_ENV, VERCEL_GIT_COMMIT_SHA: undefined }, NOW);
    expect(s.app.shortCommit).toBe("unknown");
  });

  it("a database that cannot be reached is reported, the other sections degrade, and nothing throws", async () => {
    const down = async () => { throw new Error("connect ECONNREFUSED postgres://u:supersecretpw@h/d"); };
    const s = await collectSystemStatus(deps({ ping: down, migrations: down, heartbeatAgeMs: down, dailyJobs: down, queueFacts: down, integrationRows: down, aiKeySaved: down }), GOOD_ENV, NOW);
    expect(s.database.connected).toBe(false);
    expect(s.migrations).toBeNull();
    expect(s.cron.tick.state).toBe("unknown");
    expect(s.queues).toEqual([]);
    expect(s.attention.join(" ")).toContain("database");
    expect(JSON.stringify(s)).not.toContain("supersecretpw");
  });

  it("flags a failed or pending migration", async () => {
    const s = await collectSystemStatus(deps({ migrations: async () => ({ applied: ["20260101_a"], failed: ["20260102_b"] }) }), GOOD_ENV, NOW);
    expect(s.migrations).toMatchObject({ failed: ["20260102_b"], pending: 2 });
    expect(s.attention.join(" ")).toMatch(/migration/i);
  });

  it("when the migration folder is not available in this deployment, pending is unknown, not zero", async () => {
    const s = await collectSystemStatus(deps({ migrationsOnDisk: async () => null }), GOOD_ENV, NOW);
    expect(s.migrations?.pending).toBeNull();
  });

  it("counts flags that are exactly 1, and lists the rest as off", async () => {
    const s = await collectSystemStatus(deps(), { ...GOOD_ENV, NEXT_PUBLIC_NAV_V2: "1", WA_ASSIST_ENABLED: "true", CONSENT_RECORD_ONLY_PURPOSES: "AI_PROCESSING_OF_CHATS" }, NOW);
    expect(s.flags.on.map((f) => f.name)).toEqual(["NEXT_PUBLIC_NAV_V2"]);
    expect(s.flags.off).toContain("WA_ASSIST_ENABLED");
    expect(s.flags.settings).toContainEqual({ name: "CONSENT_RECORD_ONLY_PURPOSES", value: "AI_PROCESSING_OF_CHATS" });
  });

  it("never exposes a secret value: only names and on/off", async () => {
    const s = await collectSystemStatus(deps(), GOOD_ENV, NOW);
    const text = JSON.stringify(s);
    for (const secret of ["supersecretpw", "s3cret-auth", "cron-secret-value", "w-secret", "meta-verify", "ab".repeat(32)]) expect(text).not.toContain(secret);
    expect(s.env.find((e) => e.name === "CRON_SECRET")).toMatchObject({ present: true });
  });

  it("the scheduler: ticking, stale after 15 minutes, or never", async () => {
    expect((await collectSystemStatus(deps({ heartbeatAgeMs: async () => 4 * MIN }), GOOD_ENV, NOW)).cron.tick).toMatchObject({ state: "ticking", minutesAgo: 4 });
    const stale = await collectSystemStatus(deps({ heartbeatAgeMs: async () => 40 * MIN }), GOOD_ENV, NOW);
    expect(stale.cron.tick).toMatchObject({ state: "stale", minutesAgo: 40 });
    expect(stale.attention.join(" ")).toMatch(/scheduler/i);
    expect((await collectSystemStatus(deps({ heartbeatAgeMs: async () => null }), GOOD_ENV, NOW)).cron.tick.state).toBe("never");
  });

  it("queue depths with the age of the oldest item; an old unsent WhatsApp message needs attention", async () => {
    const ok = await collectSystemStatus(deps(), GOOD_ENV, NOW);
    expect(ok.queues.find((q) => q.key === "agent_drafts")).toMatchObject({ depth: 3, oldestMinutes: 30, level: "ok" });
    const stuck = await collectSystemStatus(deps({ queueFacts: async () => ({ whatsappQueued: { n: 5, oldest: new Date(NOW.getTime() - 45 * MIN) }, draftsWaiting: { n: 0, oldest: null }, leadErrors7d: 4, reviewsBacklog: { n: 0, oldest: null }, mergeOpen: 0 }) }), GOOD_ENV, NOW);
    expect(stuck.queues.find((q) => q.key === "whatsapp_outbox")).toMatchObject({ depth: 5, oldestMinutes: 45, level: "attention" });
    expect(stuck.queues.find((q) => q.key === "lead_errors")).toMatchObject({ depth: 4, level: "attention" });
  });

  describe("integration states", () => {
    const row = (provider: string, over: Partial<{ mode: string; isEnabled: boolean; hasCredentials: boolean }> = {}) => ({ provider, mode: "live", isEnabled: true, hasCredentials: true, updatedAt: NOW, ...over });
    const state = async (rows: ReturnType<typeof row>[], env: Record<string, string | undefined> = GOOD_ENV, key = "freshdesk") =>
      (await collectSystemStatus(deps({ integrationRows: async () => rows }), env, NOW)).integrations.find((i) => i.key === key)?.state;

    it("no row, or mock mode, is mock", async () => {
      expect(await state([])).toBe("mock");
      expect(await state([row("freshdesk", { mode: "mock" })])).toBe("mock");
    });
    it("live and enabled with credentials is connected; live without credentials or disabled needs setup", async () => {
      expect(await state([row("freshdesk")])).toBe("connected");
      expect(await state([row("freshdesk", { hasCredentials: false })])).toBe("needs_setup");
      expect(await state([row("freshdesk", { isEnabled: false })])).toBe("needs_setup");
    });
    it("a provider whose feature flag is off says flag off, whatever its row says", async () => {
      expect(await state([row("meta_ads")], GOOD_ENV, "meta_ads")).toBe("flag_off");
      expect(await state([row("meta_ads")], { ...GOOD_ENV, META_ADS_SYNC_ENABLED: "1" }, "meta_ads")).toBe("connected");
      expect(await state([row("google_ads")], GOOD_ENV, "google_ads")).toBe("flag_off");
    });
    it("single sign-on: flag off, needs setup without its three settings, connected with them", async () => {
      expect(await state([], GOOD_ENV, "sso")).toBe("flag_off");
      expect(await state([], { ...GOOD_ENV, SSO_ENABLED: "1" }, "sso")).toBe("needs_setup");
      expect(await state([], { ...GOOD_ENV, SSO_ENABLED: "1", KEYCLOAK_ISSUER: "https://idp.example.test", KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" }, "sso")).toBe("connected");
    });
    it("the AI provider key follows the pilot: not saved is needs setup, saved is connected", async () => {
      const off = (await collectSystemStatus(deps({ aiKeySaved: async () => false }), GOOD_ENV, NOW)).integrations.find((i) => i.key === "ai_pilot_key");
      const on = (await collectSystemStatus(deps({ aiKeySaved: async () => true }), GOOD_ENV, NOW)).integrations.find((i) => i.key === "ai_pilot_key");
      expect([off?.state, on?.state]).toEqual(["needs_setup", "connected"]);
    });
    it("lists every provider the integrations registries really have, so a new provider cannot be forgotten", async () => {
      const keys = (await collectSystemStatus(deps(), GOOD_ENV, NOW)).integrations.map((i) => i.key);
      for (const k of [...INTEGRATION_PROVIDERS, ...EMAIL_PROVIDERS, ...MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c))]) expect(keys, k).toContain(k);
    });
    it("covers every provider the integrations page knows", async () => {
      const keys = (await collectSystemStatus(deps(), GOOD_ENV, NOW)).integrations.map((i) => i.key);
      for (const k of ["freshdesk", "exotel", "clevertap", "clickup", "jira", "meta_ads", "google_ads", "whatsapp_meta", "resend_email", "sso", "ai_pilot_key", "app_signup", "cron_trigger"]) expect(keys, k).toContain(k);
    });
  });

  it("env: a missing variable that is always needed needs attention; one that is only needed with a flag is required only then", async () => {
    const s = await collectSystemStatus(deps(), { ...GOOD_ENV, CRON_SECRET: undefined }, NOW);
    expect(s.env.find((e) => e.name === "CRON_SECRET")).toMatchObject({ present: false, required: true });
    expect(s.attention.join(" ")).toContain("CRON_SECRET");
    expect(s.env.find((e) => e.name === "APP_SIGNUP_SECRET")).toMatchObject({ present: false, required: false });
    const withReferral = await collectSystemStatus(deps(), { ...GOOD_ENV, REFERRAL_PROGRAM_ENABLED: "1" }, NOW);
    expect(withReferral.env.find((e) => e.name === "APP_SIGNUP_SECRET")).toMatchObject({ required: true });
  });

  it("a variable set to an empty string counts as missing", async () => {
    const s = await collectSystemStatus(deps(), { ...GOOD_ENV, CRON_SECRET: "" }, NOW);
    expect(s.env.find((e) => e.name === "CRON_SECRET")?.present).toBe(false);
  });
});
