import { describe, expect, it } from "vitest";

import { buildContractVM, dataStatus } from "./status";

const ok = (sample: boolean, contractVerified: boolean, source: "native" | "external" | "sample" = sample ? "sample" : "external") => ({ status: "ok" as const, data: 1, sample, contractVerified, source });

describe("dataStatus", () => {
  it("says sample data first, whatever the verification flag", () => {
    expect(dataStatus(ok(true, true)).key).toBe("sample");
    expect(dataStatus(ok(true, false)).tone).toBe("warning");
  });
  it("tells a live verified connection from an unverified one", () => {
    expect(dataStatus(ok(false, true))).toMatchObject({ key: "verified", tone: "success" });
    expect(dataStatus(ok(false, false))).toMatchObject({ key: "unverified", tone: "warning" });
  });
  it("covers not connected and errors without leaking internals", () => {
    expect(dataStatus({ status: "not_connected" }).key).toBe("not_connected");
    const err = dataStatus({ status: "error", kind: "server" });
    expect(err).toMatchObject({ key: "error", tone: "destructive" });
    expect(JSON.stringify(err)).not.toMatch(/token|stack|prisma/i);
  });
});

describe("dataStatus for the native source", () => {
  it("is live and trusted, with no contract to verify", () => {
    const s = dataStatus(ok(false, true, "native"));
    expect(s).toMatchObject({ key: "native", tone: "success" });
    expect(JSON.stringify(s)).not.toMatch(/contract|verified|referral api/i);
  });
  it("is never shown as unverified, even if the verification flag were false", () => {
    expect(dataStatus(ok(false, false, "native")).key).toBe("native");
  });
});

describe("buildContractVM", () => {
  const base = { version: "2026-10-r1", verifiedAt: null };
  it("sends a missing connection to Settings first", () => {
    const vm = buildContractVM({ ...base, state: "not_connected", verified: false }, { isAdmin: true });
    expect(vm.status.key).toBe("not_connected");
    expect(vm.steps[0]).toMatch(/Connect the referral API/);
  });
  it("explains that sample data has no contract", () => {
    expect(buildContractVM({ ...base, state: "mock", verified: false }, { isAdmin: false }).status.key).toBe("sample");
  });
  it("lists the three steps for an unverified live connection, worded by role", () => {
    const admin = buildContractVM({ ...base, state: "live", verified: false }, { isAdmin: true });
    expect(admin.steps).toHaveLength(3);
    expect(admin.steps[2]).toMatch(/Record it with Mark contract verified/);
    expect(admin.canOpenSettings).toBe(true);
    const finance = buildContractVM({ ...base, state: "live", verified: false }, { isAdmin: false });
    expect(finance.steps[2]).toMatch(/Ask an administrator/);
    expect(finance.canOpenSettings).toBe(false);
  });
  it("shows the verification date only when verified and valid", () => {
    expect(buildContractVM({ ...base, state: "live", verified: true, verifiedAt: "2026-10-05T10:00:00.000Z" }, { isAdmin: true }).verifiedOn).toMatch(/5 Oct 2026/);
    expect(buildContractVM({ ...base, state: "live", verified: false, verifiedAt: "2026-10-05T10:00:00.000Z" }, { isAdmin: true }).verifiedOn).toBeNull();
    expect(buildContractVM({ ...base, state: "live", verified: true, verifiedAt: "nonsense" }, { isAdmin: true }).verifiedOn).toBeNull();
  });
});
