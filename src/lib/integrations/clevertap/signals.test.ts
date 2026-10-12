import { describe, expect, it } from "vitest";
import { buildProfileUpload, pickIdentity, signalsHash, type CustomerSignals } from "./signals";

const base: CustomerSignals = {
  lifecycleStage: "KYC", kycApproved: false, funded: false, nbaProgramme: "Complete KYC", priority: "High",
  acceptance: { "Mutual Funds": "HIGH", PMS: "MEDIUM", AIF: "LOW" }, salesPaused: false,
};

describe("buildProfileUpload", () => {
  it("builds a profile upload with only allowlisted av_ properties", () => {
    const up = buildProfileUpload("riya@example.com", base);
    expect(up.d).toHaveLength(1);
    expect(up.d[0]).toMatchObject({ identity: "riya@example.com", type: "profile" });
    expect(Object.keys(up.d[0].profileData).every((k) => k.startsWith("av_"))).toBe(true);
    expect(up.d[0].profileData).toMatchObject({
      av_lifecycle_stage: "KYC", av_kyc_approved: false, av_funded: false, av_nba_programme: "Complete KYC",
      av_priority: "High", av_accept_mutual_funds: "high", av_accept_pms: "medium", av_accept_aif: "low", av_sales_paused: false,
    });
  });
  it("never carries PAN, balances, names or free text even if smuggled in", () => {
    const dirty = { ...base, pan: "ABCDE1234F", aum: 12345678, note: "called, angry" } as unknown as CustomerSignals;
    const up = buildProfileUpload("x@y.com", dirty);
    expect(Object.keys(up.d[0].profileData).sort()).toEqual([
      "av_accept_aif", "av_accept_mutual_funds", "av_accept_pms", "av_funded", "av_kyc_approved",
      "av_lifecycle_stage", "av_nba_programme", "av_priority", "av_sales_paused",
    ]);
    const json = JSON.stringify(up);
    for (const smuggled of ["ABCDE1234F", "12345678", "called, angry"]) expect(json).not.toContain(smuggled);
  });
  it("accepts acceptance levels only as HIGH/MEDIUM/LOW (case-insensitive) and omits anything else", () => {
    const hostile = {
      ...base,
      acceptance: { PMS: "hacked <script>", AIF: "high", "Mutual Funds": "Medium", Bonds: "", Gold: "LOW " },
    } as unknown as CustomerSignals;
    const data = buildProfileUpload("x@y.com", hostile).d[0].profileData;
    expect(data.av_accept_aif).toBe("high");
    expect(data.av_accept_mutual_funds).toBe("medium");
    expect(data).not.toHaveProperty("av_accept_pms");
    expect(data).not.toHaveProperty("av_accept_bonds");
    expect(data).not.toHaveProperty("av_accept_gold");
    expect(JSON.stringify(data)).not.toMatch(/script|hacked/i);
  });
  it("skips asset classes whose name slugs to nothing and never uses prototype keys", () => {
    const acceptance = JSON.parse('{"": "HIGH", "!!!": "LOW", "__proto__": "HIGH", "PMS": "LOW"}');
    const data = buildProfileUpload("x@y.com", { ...base, acceptance }).d[0].profileData;
    expect(Object.keys(data).filter((k) => k.startsWith("av_accept_")).sort()).toEqual(["av_accept_pms", "av_accept_proto"]);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  });
  it("keeps the first of two asset classes that slug to the same key (sorted by name) and hashes stably", () => {
    const a = { ...base, acceptance: { "A b": "HIGH", "A-b": "LOW" } as CustomerSignals["acceptance"] };
    const b = { ...base, acceptance: { "A-b": "LOW", "A b": "HIGH" } as CustomerSignals["acceptance"] };
    const data = buildProfileUpload("x@y.com", a).d[0].profileData;
    expect(data.av_accept_a_b).toBe("high"); // "A b" sorts before "A-b" (code-unit order)
    expect(Object.keys(data).filter((k) => k.startsWith("av_accept_"))).toEqual(["av_accept_a_b"]);
    expect(signalsHash(a)).toBe(signalsHash(b));
  });
  it("omits null values instead of sending them", () => {
    const up = buildProfileUpload("x@y.com", { ...base, nbaProgramme: null, priority: null });
    expect(up.d[0].profileData).not.toHaveProperty("av_nba_programme");
    expect(up.d[0].profileData).not.toHaveProperty("av_priority");
  });
});

describe("signalsHash", () => {
  it("is stable for equal signals regardless of key order and changes when a value changes", () => {
    const a = signalsHash(base);
    const b = signalsHash({ ...base, acceptance: { AIF: "LOW", PMS: "MEDIUM", "Mutual Funds": "HIGH" } });
    expect(a).toBe(b);
    expect(signalsHash({ ...base, funded: true })).not.toBe(a);
  });
});

describe("pickIdentity", () => {
  it("prefers email, then mobile, else null", () => {
    expect(pickIdentity({ email: "a@b.com", mobile: "9000000001" })).toBe("a@b.com");
    expect(pickIdentity({ email: null, mobile: "9000000001" })).toBe("9000000001");
    expect(pickIdentity({ email: " ", mobile: null })).toBeNull();
  });
});
