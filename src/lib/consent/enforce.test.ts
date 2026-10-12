import { describe, expect, it, vi } from "vitest";
import { assertConsent, checkConsent, consentEnforced, ConsentDeniedError, consentGate, filterConsented, type ConsentSnapshot, type EnforceDeps } from "./enforce";
import { resolvePolicy } from "./policy";

const NOW = new Date("2026-10-09T10:00:00Z");
const snap = (over: Partial<ConsentSnapshot> = {}): ConsentSnapshot => ({ records: [], legacyMarketingConsentAt: null, ...over });
const grant = (purpose: string, channel: string | null = null) => ({ purpose, channel, status: "GRANTED" as const, capturedAt: new Date("2026-01-01") });

function deps(snaps: Record<string, ConsentSnapshot>, over: Partial<EnforceDeps> = {}) {
  const load = vi.fn(async (ids: string[]) => new Map(ids.filter((i) => snaps[i]).map((i) => [i, snaps[i]])));
  const d: EnforceDeps = { enforced: () => true, load, now: () => NOW, policy: () => resolvePolicy({}), ...over };
  return { d, load };
}

describe("consentEnforced", () => {
  it("is on only for the exact value 1", () => {
    expect(consentEnforced({ CONSENT_ENFORCEMENT: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", " 1", "1 "]) expect(consentEnforced({ CONSENT_ENFORCEMENT: v })).toBe(false);
  });
});

describe("with enforcement OFF nothing changes and nothing is read", () => {
  it("checkConsent allows without touching the database", async () => {
    const { d, load } = deps({}, { enforced: () => false });
    expect(await checkConsent("c1", "MARKETING_COMMS", "whatsapp", d)).toEqual({ allowed: true, reason: "ENFORCEMENT_OFF", state: "UNKNOWN" });
    expect(load).not.toHaveBeenCalled();
  });
  it("assertConsent resolves and does not read", async () => {
    const { d, load } = deps({}, { enforced: () => false });
    await expect(assertConsent("c1", "AI_PROCESSING_OF_CHATS", "whatsapp", d)).resolves.toMatchObject({ allowed: true });
    expect(load).not.toHaveBeenCalled();
  });
  it("filterConsented returns the very same array", async () => {
    const { d, load } = deps({}, { enforced: () => false });
    const ids = ["a", "b"];
    expect(await filterConsented(ids, "MARKETING_COMMS", "whatsapp", d)).toBe(ids);
    expect(load).not.toHaveBeenCalled();
  });
  it("consentGate returns undefined so a call site can spread nothing", () => {
    expect(consentGate("MARKETING_COMMS", "whatsapp", { enforced: () => false })).toBeUndefined();
  });
});

describe("with enforcement ON", () => {
  it("blocks a customer with no consent on file", async () => {
    const { d } = deps({ c1: snap() });
    expect(await checkConsent("c1", "MARKETING_COMMS", "whatsapp", d)).toMatchObject({ allowed: false, reason: "NO_RECORD" });
  });
  it("allows a customer with the legacy lead-form timestamp", async () => {
    const { d } = deps({ c1: snap({ legacyMarketingConsentAt: new Date("2026-08-01") }) });
    expect(await checkConsent("c1", "MARKETING_COMMS", "whatsapp", d)).toMatchObject({ allowed: true, reason: "GRANTED_LEGACY" });
  });
  it("treats a customer the loader does not return as having no consent", async () => {
    const { d } = deps({});
    expect((await checkConsent("ghost", "MARKETING_COMMS", "whatsapp", d)).allowed).toBe(false);
  });
  it("assertConsent throws a typed error carrying the decision", async () => {
    const { d } = deps({ c1: snap() });
    const err = await assertConsent("c1", "AI_PROCESSING_OF_CHATS", "whatsapp", d).catch((e) => e);
    expect(err).toBeInstanceOf(ConsentDeniedError);
    expect(err.code).toBe("CONSENT_DENIED");
    expect(err.decision.reason).toBe("NO_RECORD");
    expect(err.message).not.toContain("c1");
  });
  it("assertConsent resolves for a granted purpose", async () => {
    const { d } = deps({ c1: snap({ records: [grant("AI_PROCESSING_OF_CHATS")] }) });
    await expect(assertConsent("c1", "AI_PROCESSING_OF_CHATS", "whatsapp", d)).resolves.toMatchObject({ allowed: true });
  });
  it("fails closed when the ledger cannot be read", async () => {
    const { d } = deps({}, { load: async () => { throw new Error("db down"); } });
    await expect(checkConsent("c1", "MARKETING_COMMS", "whatsapp", d)).rejects.toThrow("db down");
    await expect(assertConsent("c1", "MARKETING_COMMS", "whatsapp", d)).rejects.toThrow("db down");
  });
  it("record-only purposes let it through", async () => {
    const { d } = deps({ c1: snap() }, { policy: () => resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }) });
    expect(await checkConsent("c1", "MARKETING_COMMS", "whatsapp", d)).toMatchObject({ allowed: true, wouldBlock: "NO_RECORD" });
  });
  it("filterConsented keeps order, drops the denied, and reads once", async () => {
    const { d, load } = deps({
      a: snap({ records: [grant("MARKETING_COMMS")] }),
      b: snap(),
      c: snap({ records: [grant("MARKETING_COMMS"), { purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: new Date("2026-02-01") }] }),
      e: snap({ legacyMarketingConsentAt: new Date("2026-03-01") }),
    });
    expect(await filterConsented(["e", "a", "b", "c"], "MARKETING_COMMS", "whatsapp", d)).toEqual(["e", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("consentGate builds a per-customer check that reports a short reason", async () => {
    const { d } = deps({ c1: snap() });
    const gate = consentGate("MARKETING_COMMS", "whatsapp", d)!;
    expect(await gate("c1")).toEqual({ allowed: false, reason: "no consent" });
    const ok = deps({ c1: snap({ legacyMarketingConsentAt: new Date("2026-03-01") }) });
    expect(await consentGate("MARKETING_COMMS", "whatsapp", ok.d)!("c1")).toEqual({ allowed: true });
  });
});
