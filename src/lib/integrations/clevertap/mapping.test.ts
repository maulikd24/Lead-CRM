import { describe, expect, it } from "vitest";
import { signalsFromIntelligence } from "./mapping";

const base = {
  lifecycle: "KYC",
  facts: { kycApproved: false },
  acceptance: { "Mutual Funds": { level: "HIGH" }, PMS: { level: "MEDIUM" }, AIF: { level: "LOW" } },
  situations: [] as { key: string }[],
  nba: { programme: "Complete KYC", priority: "High" },
};

describe("signalsFromIntelligence", () => {
  it("maps the core fields", () => {
    expect(signalsFromIntelligence(base as never)).toEqual({
      lifecycleStage: "KYC", kycApproved: false, funded: false, nbaProgramme: "Complete KYC", priority: "High",
      acceptance: { "Mutual Funds": "HIGH", PMS: "MEDIUM", AIF: "LOW" }, salesPaused: false,
    });
  });
  it.each(["Funded", "Activated", "Active"])("%s => funded", (stage) => {
    expect(signalsFromIntelligence({ ...base, lifecycle: stage } as never).funded).toBe(true);
  });
  it.each(["Lead", "Dormant", "Lost", "KYC"])("%s => not funded", (stage) => {
    expect(signalsFromIntelligence({ ...base, lifecycle: stage } as never).funded).toBe(false);
  });
  it("service_issue => salesPaused; other situations do not", () => {
    expect(signalsFromIntelligence({ ...base, situations: [{ key: "service_issue" }] } as never).salesPaused).toBe(true);
    expect(signalsFromIntelligence({ ...base, situations: [{ key: "kyc_pending" }] } as never).salesPaused).toBe(false);
  });
  it("omits acceptance levels that are not HIGH/MEDIUM/LOW", () => {
    const r = signalsFromIntelligence({ ...base, acceptance: { PMS: { level: "NONE" }, AIF: { level: "HIGH" }, Bonds: undefined } } as never);
    expect(r.acceptance).toEqual({ AIF: "HIGH" });
  });
  it("passes kycApproved through and nulls missing nba fields", () => {
    const r = signalsFromIntelligence({ ...base, facts: { kycApproved: true }, nba: {} } as never);
    expect(r.kycApproved).toBe(true);
    expect(r.nbaProgramme).toBeNull();
    expect(r.priority).toBeNull();
  });
});
