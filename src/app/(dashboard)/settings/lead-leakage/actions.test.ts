import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
const db = vi.hoisted(() => ({ saveSettings: vi.fn() }));
vi.mock("@/lib/attribution/db", () => db);
const audit = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { auditLog: audit } }));

import { saveAttributionSettingsAction } from "./actions";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
  db.saveSettings.mockResolvedValue(undefined);
  audit.create.mockResolvedValue({});
});

describe("saveAttributionSettingsAction", () => {
  it("only an admin can save; every other role is refused before anything is written", async () => {
    for (const role of ALL_ROLES.filter((r) => r !== "ADMIN")) {
      asUser({ role });
      expect((await outcomeOf(() => saveAttributionSettingsAction({ slaMinutes: 20, graceMinutes: 5 }))).kind, role).toBe("redirect");
    }
    asAnonymous();
    expect(await outcomeOf(() => saveAttributionSettingsAction({ slaMinutes: 20, graceMinutes: 5 }))).toEqual({ kind: "redirect", url: "/login" });
    expect(db.saveSettings).not.toHaveBeenCalled();
  });

  it("is a 404 while the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => saveAttributionSettingsAction({ slaMinutes: 20, graceMinutes: 5 }))).toEqual({ kind: "notFound" });
    expect(db.saveSettings).not.toHaveBeenCalled();
  });

  it("saves valid minutes for an admin and leaves an audit entry with who and what", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    const r = await outcomeOf(() => saveAttributionSettingsAction({ slaMinutes: "20", graceMinutes: 5 }));
    expect(r).toEqual({ kind: "returned", value: { ok: true, settings: { slaMinutes: 20, graceMinutes: 5 } } });
    expect(db.saveSettings).toHaveBeenCalledWith({ slaMinutes: 20, graceMinutes: 5 }, "admin-1");
    expect(audit.create.mock.calls[0][0].data).toMatchObject({ userId: "admin-1", entity: "AttributionSetting", action: "lead_sla_changed", newValue: { slaMinutes: 20, graceMinutes: 5 } });
  });

  it("refuses values that make no sense, with a plain message, and writes nothing", async () => {
    asUser({ role: "ADMIN" });
    for (const bad of [{ slaMinutes: 1, graceMinutes: 0 }, { slaMinutes: 99999, graceMinutes: 0 }, { slaMinutes: 15, graceMinutes: -5 }, "x", null]) {
      const r = await outcomeOf(() => saveAttributionSettingsAction(bad));
      expect(r.kind).toBe("returned");
      expect((r as { value: { ok: boolean; error?: string } }).value).toMatchObject({ ok: false });
      expect(((r as { value: { error: string } }).value.error)).toMatch(/minutes/);
    }
    expect(db.saveSettings).not.toHaveBeenCalled();
  });
});
