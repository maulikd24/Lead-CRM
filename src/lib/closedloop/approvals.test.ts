import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { ApprovalBlockedError } from "@/lib/policy/approvals/service";

import { applyConsentNotice, applyDestinationChange, checkConsentNotice, checkDestinationChange, classifyDestinationChange, type ApprovalDb } from "./approvals";
import type { DestinationSettings } from "./gate";

const OFF: DestinationSettings = { enabled: false, region: null, allowedRegions: [], sendValue: false };
const ON: DestinationSettings = { enabled: true, region: "in", allowedRegions: ["in"], sendValue: false };

describe("classifyDestinationChange: what needs a second person", () => {
  it("enabling a destination needs approval", () => {
    expect(classifyDestinationChange(OFF, { ...ON })).toBe("needs_approval");
  });
  it("widening where data may go, or starting to send a value, needs approval", () => {
    expect(classifyDestinationChange(ON, { ...ON, allowedRegions: ["in", "global"] })).toBe("needs_approval");
    expect(classifyDestinationChange(ON, { ...ON, region: "global", allowedRegions: ["in", "global"] })).toBe("needs_approval");
    expect(classifyDestinationChange(ON, { ...ON, sendValue: true })).toBe("needs_approval");
  });
  it("narrowing, stopping a value, switching off, or changing nothing is applied at once", () => {
    expect(classifyDestinationChange(ON, { ...ON, enabled: false })).toBe("direct");
    expect(classifyDestinationChange({ ...ON, sendValue: true }, { ...ON, sendValue: false })).toBe("direct");
    expect(classifyDestinationChange({ ...ON, allowedRegions: ["in", "global"] }, { ...ON, allowedRegions: ["in"] })).toBe("direct");
    expect(classifyDestinationChange(ON, { ...ON })).toBe("direct");
    expect(classifyDestinationChange(OFF, { ...OFF, region: "in", allowedRegions: ["in"] })).toBe("direct");
  });
});

const fakeDb = (over: { credentials?: unknown; settings?: unknown } = {}) => {
  const calls: { upsert: unknown[]; audit: unknown[] } = { upsert: [], audit: [] };
  const db: ApprovalDb = {
    integrationConfig: {
      findUnique: async () => (over.credentials === undefined && over.settings === undefined ? null : { credentials: over.credentials as never, settings: (over.settings ?? {}) as never }),
      upsert: async (a: unknown) => void calls.upsert.push(a),
    },
    auditLog: { create: async (a: unknown) => void calls.audit.push(a) },
  };
  return { db, calls };
};

describe("applying an approved destination change", () => {
  it("is refused (left pending) while the destination is not set up or the payload is malformed", async () => {
    const { db } = fakeDb();
    await expect(checkDestinationChange({ destination: "meta_capi", enabled: true, region: "in", allowedRegions: ["in"], sendValue: false }, db, {})).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkDestinationChange({ destination: "nope" } as never, db, {})).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkDestinationChange({ destination: "fake", enabled: true, region: "in", allowedRegions: ["in"], sendValue: false }, db, {})).rejects.toBeInstanceOf(ApprovalBlockedError); // demo not allowed
  });
  it("writes only the settings, keeps the credentials, records who approved, and is idempotent", async () => {
    const { db, calls } = fakeDb({ settings: { enabled: false, region: null } });
    const payload = { destination: "meta_capi" as const, enabled: true, region: "in", allowedRegions: ["in"], sendValue: false };
    await applyDestinationChange(payload, { approvalRequestId: "r1", decidedById: "u2" }, db);
    await applyDestinationChange(payload, { approvalRequestId: "r1", decidedById: "u2" }, db);
    const first = calls.upsert[0] as { where: { provider: string }; update: Record<string, unknown> };
    expect(first.where.provider).toBe("closedloop_meta_capi");
    expect(first.update.settings).toEqual({ enabled: true, region: "in", allowedRegions: ["in"], sendValue: false });
    expect(first.update.isEnabled).toBe(true);
    expect(first.update.mode).toBe("live");
    expect(first.update).not.toHaveProperty("credentials");
    expect(first.update.settings).toEqual((calls.upsert[1] as { update: { settings: unknown } }).update.settings);
    expect(JSON.stringify(calls.audit[0])).toContain("u2");
  });
});

describe("a consent wording change", () => {
  const good = { purpose: "ADS_MEASUREMENT" as const, text: "We may tell advertising platforms, using coded identifiers only, that you completed KYC or funded, so they can measure which ads work.", version: "2027-04" };
  it("needs a real sentence and a version, and only for the ads purpose", async () => {
    await expect(checkConsentNotice({ ...good, text: "short" })).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkConsentNotice({ ...good, version: "" })).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkConsentNotice({ ...good, text: "x".repeat(1001) })).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkConsentNotice({ ...good, purpose: "MARKETING_COMMS" } as never)).rejects.toBeInstanceOf(ApprovalBlockedError);
    await expect(checkConsentNotice(good)).resolves.toBeUndefined();
  });
  it("is stored as an approved wording with its version and approver", async () => {
    const { db, calls } = fakeDb();
    await applyConsentNotice(good, { approvalRequestId: "r2", decidedById: "u3" }, db);
    const w = calls.upsert[0] as { where: { provider: string }; update: { settings: Record<string, unknown> } };
    expect(w.where.provider).toBe("closedloop_consent_policy");
    expect(w.update.settings).toMatchObject({ adsNoticeText: good.text, adsNoticeVersion: good.version, approvalRequestId: "r2" });
    expect(JSON.stringify(calls.audit[0])).toContain("u3");
  });
});
