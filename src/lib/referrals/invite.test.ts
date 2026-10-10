import { describe, expect, it, vi } from "vitest";

import { buildInviteDraft, type InviteDeps } from "./invite";

const DISCLAIMER = "Referral rewards, if any, follow the programme terms. Investments are subject to market risks.";
const deps = (over: Partial<InviteDeps> = {}): InviteDeps => ({
  loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: "ABCD2345", status: "ACTIVE" }),
  getSetting: async (k) => (k === "disclaimer" ? DISCLAIMER : null),
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
  it("is refused without a configured disclaimer", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: async () => null }) });
    expect((r as { error: string }).error).toMatch(/disclaimer/i);
  });
  it("is refused without a configured https link base, a code, or an active referrer", async () => {
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ linkBase: undefined }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: null, status: "ACTIVE" }) }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => ({ clientId: "c1", firstName: "Asha", activeCode: "ABCD2345", status: "SUSPENDED" }) }) })).ok).toBe(false);
    expect((await buildInviteDraft({ referrerId: "r1", deps: deps({ loadReferrer: async () => null }) })).ok).toBe(false);
  });
  it("a disclaimer that itself breaks the copy rules is caught", async () => {
    const r = await buildInviteDraft({ referrerId: "r1", deps: deps({ getSetting: async () => "Earn ₹500 on every referral." }) });
    expect(r.ok).toBe(false);
  });
});
