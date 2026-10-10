import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());

const db = vi.hoisted(() => ({ consentRecord: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const logExport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity/log-user-event", () => ({ logExport }));

import { GET } from "./route";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONSENT", "1");
  db.consentRecord.findMany.mockResolvedValue([
    { purpose: "MARKETING", channel: "whatsapp", status: "GRANTED", source: "RM_RECORDED", noticeVersion: "v1", capturedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null, client: { clientCode: "C-001" } },
  ]);
});

describe("GET /api/consent/export", () => {
  it("sends a signed-out caller to /login without reading the ledger", async () => {
    asAnonymous();
    expect(await outcomeOf(() => GET())).toEqual({ kind: "redirect", url: "/login" });
    expect(db.consentRecord.findMany).not.toHaveBeenCalled();
  });
  it.each(["MANAGER", "RM", "DEALER", "FINANCE", "PARTNER"] as const)("bounces the %s role without reading the ledger", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => GET())).kind).toBe("redirect");
    expect(db.consentRecord.findMany).not.toHaveBeenCalled();
    expect(logExport).not.toHaveBeenCalled();
  });
  it("is a 404 for an admin while the flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONSENT", "");
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => GET());
    expect(r.kind === "returned" && r.value.status).toBe(404);
    expect(db.consentRecord.findMany).not.toHaveBeenCalled();
  });
  it("gives an admin a no-store CSV with the customer code only, and logs the export", async () => {
    const admin = asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => GET());
    if (r.kind !== "returned") throw new Error("expected a response");
    expect(r.value.status).toBe(200);
    expect(r.value.headers.get("cache-control")).toBe("no-store");
    const body = await r.value.text();
    expect(body).toContain("C-001");
    expect(logExport).toHaveBeenCalledWith(expect.objectContaining({ id: admin.id }), "/api/consent/export", expect.any(String));
  });
});
