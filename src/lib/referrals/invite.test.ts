import { describe, expect, it, vi } from "vitest";

import { DEFAULT_DISCLAIMER, wordingHash } from "./disclosure";
import { buildInviteDraft, type InviteDeps } from "./invite";

const DISCLAIMER = "Referral rewards, if any, follow the programme terms. Investments are subject to market risks.";
const signoff = (text: string, by = "u-2") => JSON.stringify({ by, approver: "A. Reviewer", at: "2027-01-10T10:00:00.000Z", hash: wordingHash(text) });
const settings = (m: Record<string, string>) => async (k: string) => m[k] ?? null;
const deps = (over: Partial<InviteDeps> = {}): InviteDeps => ({
  loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: "ABCD2345", status: "ACTIVE" }),
  getSetting: settings({ disclaimer: DISCLAIMER, disclaimer_signoff: signoff(DISCLAIMER) }),
  linkBase: "https://example.test/join",
  consent: async () => ({ allowed: true, enforced: true }),
  ...over,
});

describe("buildInviteDraft", () => {
  it("returns a checked draft that has the link and the disclaimer, and sends nothing", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps() });
    expect(r).toMatchObject({ ok: true });
    const text = (r as { text: string }).text;
    expect(text).toContain("https://example.test/join?ref=ABCD2345");
    expect(text.endsWith(DISCLAIMER)).toBe(true);
  });
  it("is refused when the referrer has not consented to marketing messages (consent ledger)", async () => {
    const consent = vi.fn(async () => ({ allowed: false, enforced: true, reason: "no consent" }));
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ consent }) });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/consent/i);
    expect(consent).toHaveBeenCalledWith("c1");
  });
  it("uses the safe default wording when none is configured, once that wording is signed off", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: settings({ disclaimer_signoff: signoff(DEFAULT_DISCLAIMER) }) }) });
    expect(r).toMatchObject({ ok: true });
    expect((r as { text: string }).text.endsWith(DEFAULT_DISCLAIMER)).toBe(true);
  });
  it("is refused until compliance has signed off the wording in force (default or custom)", async () => {
    for (const getSetting of [settings({}), settings({ disclaimer: DISCLAIMER }), settings({ disclaimer_signoff: signoff(DISCLAIMER) }), settings({ disclaimer: DISCLAIMER + " Edited.", disclaimer_signoff: signoff(DISCLAIMER) })]) {
      const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting }) });
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sign-off/i) });
    }
  });
  it("is refused when the same person edited the wording and recorded its sign-off", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: settings({ disclaimer: DISCLAIMER, disclaimer_editor: "u-2", disclaimer_signoff: signoff(DISCLAIMER, "u-2") }) }) });
    expect(r).toMatchObject({ ok: false });
  });
  it("does not even look at consent or build text when there is no sign-off", async () => {
    const consent = vi.fn(async () => ({ allowed: true, enforced: true }));
    await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: settings({}), consent }) });
    expect(consent).not.toHaveBeenCalled();
  });
  it("is refused without a configured https link base, a code, or an active referrer", async () => {
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ linkBase: undefined }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: null, status: "ACTIVE" }) }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: "ABCD2345", status: "SUSPENDED" }) }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => null }) })).ok).toBe(false);
  });
  it("a disclaimer that itself breaks the copy rules is caught", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: settings({ disclaimer: "Earn ₹500 on every referral.", disclaimer_signoff: signoff("Earn ₹500 on every referral.") }) }) });
    expect(r.ok).toBe(false);
  });
});
