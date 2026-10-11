import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  integrationConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  conversionOutbox: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { retryOutboxRowAction, saveAumBandsAction, saveDestinationAction, setKillSwitchAction } from "./actions";

const MARKETING = "MARKETING" as Role; // added to the Role enum by the access branch; the helper only compares the string
const ALLOWED_TO_VIEW: Role[] = ["ADMIN", MARKETING];
const DENIED: Role[] = ["RM", "MANAGER", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"];

const save = () => saveDestinationAction("meta_capi", { enabled: true, region: "global", allowedRegions: "global", sendValue: false, credentials: { pixelId: "1", accessToken: "tok" } });
const ACTIONS: [string, () => Promise<unknown>, { adminOnly: boolean }][] = [
  ["retryOutboxRowAction", () => retryOutboxRowAction("row1"), { adminOnly: false }],
  ["setKillSwitchAction(on)", () => setKillSwitchAction(true), { adminOnly: false }],
  ["setKillSwitchAction(off)", () => setKillSwitchAction(false), { adminOnly: true }],
  ["saveDestinationAction", save, { adminOnly: true }],
  ["saveAumBandsAction", () => saveAumBandsAction("10L=1000000"), { adminOnly: true }],
];
const touched = () => Object.values(db).flatMap((m) => Object.values(m)).some((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length > 0);

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("CLOSED_LOOP_CONVERSIONS_ENABLED", "1");
  vi.stubEnv("ENCRYPTION_KEY", "11".repeat(32));
  db.integrationConfig.findUnique.mockResolvedValue(null);
  db.integrationConfig.upsert.mockResolvedValue({});
  db.conversionOutbox.updateMany.mockResolvedValue({ count: 1 });
  db.auditLog.create.mockResolvedValue({});
});

describe("closed-loop actions: who can run them", () => {
  it.each(ACTIONS)("%s sends a signed-out visitor to /login and touches nothing", async (_n, run) => {
    asAnonymous();
    expect(await outcomeOf(run)).toEqual({ kind: "redirect", url: "/login" });
    expect(touched()).toBe(false);
  });

  for (const role of DENIED) {
    it.each(ACTIONS)(`${role}: %s is bounced before any data access`, async (_n, run) => {
      asUser({ role });
      expect((await outcomeOf(run)).kind).toBe("redirect");
      expect(touched()).toBe(false);
    });
  }

  it.each(ACTIONS)("a user who must change their password gets nothing: %s", async (_n, run) => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect(await outcomeOf(run)).toEqual({ kind: "redirect", url: "/change-password" });
    expect(touched()).toBe(false);
  });

  it.each(ACTIONS)("ADMIN can run %s", async (_n, run) => {
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(run)).kind).toBe("returned");
    expect(touched()).toBe(true);
  });

  it.each(ACTIONS)("MARKETING: %s follows the admin-only rule", async (_n, run, { adminOnly }) => {
    asUser({ role: MARKETING });
    const r = await outcomeOf(run);
    if (adminOnly) {
      expect(r.kind).toBe("redirect");
      expect(touched()).toBe(false);
    } else {
      expect(r.kind).toBe("returned");
      expect(touched()).toBe(true);
    }
  });

  it("everything is dark while the flag is off, even for an Admin", async () => {
    vi.stubEnv("CLOSED_LOOP_CONVERSIONS_ENABLED", "");
    for (const role of ALLOWED_TO_VIEW) {
      asUser({ role });
      for (const [, run, { adminOnly }] of ACTIONS) expect((await outcomeOf(run)).kind).toBe(role === MARKETING && adminOnly ? "redirect" : "notFound");
    }
    expect(touched()).toBe(false);
  });
});

describe("closed-loop actions: behaviour", () => {
  beforeEach(() => asUser({ role: "ADMIN" }));

  it("saving a destination stores credentials encrypted, never in the settings, and keeps a field left blank", async () => {
    db.integrationConfig.findUnique.mockResolvedValue({ credentials: (await import("@/lib/security/crypto")).encryptJson({ pixelId: "old", accessToken: "keep-me" }) });
    const r = await saveDestinationAction("meta_capi", { enabled: true, region: " Global ", allowedRegions: "global, in", sendValue: true, credentials: { pixelId: "new", accessToken: "" } });
    expect(r).toEqual({ ok: true });
    const call = db.integrationConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ provider: "closedloop_meta_capi" });
    expect(call.update.settings).toEqual({ enabled: true, region: "global", allowedRegions: ["global", "in"], sendValue: true });
    expect(JSON.stringify(call.update.settings)).not.toMatch(/keep-me|new/);
    expect(typeof call.update.credentials).toBe("string");
    expect(call.update.credentials).not.toContain("keep-me");
    const { decryptJson } = await import("@/lib/security/crypto");
    expect(decryptJson(call.update.credentials)).toEqual({ pixelId: "new", accessToken: "keep-me" });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toMatch(/keep-me|"new"|tok/);
  });

  it("rejects an unknown destination, an unknown credential field and an over-long region", async () => {
    expect(await saveDestinationAction("nope" as never, { enabled: false, region: "", allowedRegions: "", sendValue: false, credentials: {} })).toMatchObject({ ok: false });
    expect(await saveDestinationAction("meta_capi", { enabled: false, region: "", allowedRegions: "", sendValue: false, credentials: { hacker: "x" } })).toMatchObject({ ok: false });
    expect(await saveDestinationAction("meta_capi", { enabled: false, region: "x".repeat(80), allowedRegions: "", sendValue: false, credentials: {} })).toMatchObject({ ok: false });
    expect(db.integrationConfig.upsert).not.toHaveBeenCalled();
  });

  it("the demo destination cannot be configured unless demo mode is on", async () => {
    expect(await saveDestinationAction("fake", { enabled: true, region: "global", allowedRegions: "global", sendValue: false, credentials: {} })).toMatchObject({ ok: false });
    vi.stubEnv("CLOSED_LOOP_DEMO", "1");
    expect(await saveDestinationAction("fake", { enabled: true, region: "global", allowedRegions: "global", sendValue: false, credentials: {} })).toEqual({ ok: true });
  });

  it("the kill switch is stored in the global setting and audited", async () => {
    expect(await setKillSwitchAction(true)).toEqual({ ok: true });
    expect(db.integrationConfig.upsert.mock.calls[0][0].update.settings).toMatchObject({ killSwitch: true });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("assets bands: a bad line is reported and nothing is saved", async () => {
    expect(await saveAumBandsAction("oops")).toMatchObject({ ok: false });
    expect(db.integrationConfig.upsert).not.toHaveBeenCalled();
    expect(await saveAumBandsAction("10L=1000000")).toEqual({ ok: true });
    expect(db.integrationConfig.upsert.mock.calls[0][0].update.settings.aumBands).toEqual([{ label: "10L", min: 1000000 }]);
  });

  it("retry puts only a dead or failed row back", async () => {
    await retryOutboxRowAction("row1");
    expect(db.conversionOutbox.updateMany.mock.calls[0][0].where).toMatchObject({ id: "row1", status: { in: ["DEAD", "FAILED"] } });
  });
});
