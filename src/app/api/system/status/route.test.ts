import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());

const deps = vi.hoisted(() => ({ ping: vi.fn(), migrations: vi.fn(), migrationsOnDisk: vi.fn(), heartbeatAgeMs: vi.fn(), dailyJobs: vi.fn(), queueFacts: vi.fn(), integrationRows: vi.fn(), aiKeySaved: vi.fn() }));
vi.mock("@/lib/system/status-wiring", () => ({ statusDeps: deps }));

import { GET } from "./route";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const SECRETS = { DATABASE_URL: "postgres://u:topsecretpw@h/d", CRON_SECRET: "cron-topsecret", ENCRYPTION_KEY: "cd".repeat(32), AUTH_SECRET: "auth-topsecret" };

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
  deps.ping.mockResolvedValue({ database: "db1", serverVersion: "16.4" });
  deps.migrations.mockResolvedValue({ applied: ["m1"], failed: [] });
  deps.migrationsOnDisk.mockResolvedValue(["m1"]);
  deps.heartbeatAgeMs.mockResolvedValue(60_000);
  deps.dailyJobs.mockResolvedValue([]);
  deps.queueFacts.mockResolvedValue({ whatsappQueued: { n: 0, oldest: null }, draftsWaiting: { n: 0, oldest: null }, leadErrors7d: 0, reviewsBacklog: { n: 0, oldest: null }, mergeOpen: 0 });
  deps.integrationRows.mockResolvedValue([]);
  deps.aiKeySaved.mockResolvedValue(false);
});

describe("GET /api/system/status", () => {
  it("sends a signed-out caller to /login without touching the database", async () => {
    asAnonymous();
    expect(await outcomeOf(() => GET())).toEqual({ kind: "redirect", url: "/login" });
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
  });
  it.each(ALL_ROLES.filter((r) => r !== "ADMIN"))("bounces the %s role without touching the database", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => GET())).kind).toBe("redirect");
    for (const f of Object.values(deps)) expect(f).not.toHaveBeenCalled();
  });
  it("gives an Admin the status as no-store JSON with no secret anywhere in it", async () => {
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => GET());
    if (r.kind !== "returned") throw new Error("expected a response");
    expect(r.value.status).toBe(200);
    expect(r.value.headers.get("cache-control")).toBe("no-store");
    const text = await r.value.text();
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
    const body = JSON.parse(text);
    expect(body.database).toMatchObject({ connected: true, name: "db1" });
    expect(body.env.find((e: { name: string }) => e.name === "CRON_SECRET")).toMatchObject({ present: true });
  });
  it("still answers when the database is down (and says so)", async () => {
    asUser({ role: "ADMIN" });
    for (const f of Object.values(deps)) f.mockRejectedValue(new Error("connect failed postgres://u:topsecretpw@h/d"));
    const r = await outcomeOf(() => GET());
    if (r.kind !== "returned") throw new Error("expected a response");
    const text = await r.value.text();
    expect(JSON.parse(text).database.connected).toBe(false);
    expect(text).not.toContain("topsecretpw");
  });
});
