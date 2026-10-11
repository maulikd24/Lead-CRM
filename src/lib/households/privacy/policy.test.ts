import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "@/lib/access/policy";

import {
  CONSENTABLE_FACETS,
  FACETS,
  HOUSEHOLD_POLICY,
  consentCovers,
  facetVisible,
  validateConsentScopes,
  type ConsentRow,
} from "./policy";

const NOW = new Date("2027-06-30T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const row = (over: Partial<ConsentRow> = {}): ConsentRow => ({ subjectClientId: "B", granteeClientId: null, scopes: ["member_identity"], status: "GRANTED", capturedAt: day(-5), expiresAt: null, ...over });

describe("the policy table: what the RM of one member may see of another", () => {
  it("the default is only that the relationship exists", () => {
    expect(HOUSEHOLD_POLICY.relationship_exists.crossScope).toBe("always");
    for (const f of FACETS.filter((x) => x !== "relationship_exists")) expect(HOUSEHOLD_POLICY[f].crossScope, f).not.toBe("always");
  });
  it("memory and contact details never cross the wall, whatever a consent row says", () => {
    expect(HOUSEHOLD_POLICY.memory_confirmed.crossScope).toBe("never");
    expect(HOUSEHOLD_POLICY.contact_details.crossScope).toBe("never");
    expect(CONSENTABLE_FACETS).not.toContain("memory_confirmed");
    expect(CONSENTABLE_FACETS).not.toContain("contact_details");
    expect(CONSENTABLE_FACETS).not.toContain("relationship_exists");
  });
  it("every facet is declared (a new facet cannot be added without a policy)", () => {
    expect(Object.keys(HOUSEHOLD_POLICY).sort()).toEqual([...FACETS].sort());
  });
});

describe("facetVisible: every role, every facet, in and out of scope, with and without consent", () => {
  const desk = new Set(["ADMIN", "MANAGER", "RM"]);
  const granted = (f: string) => [row({ scopes: [f] })];

  it.each(ALL_ROLES)("%s", (role) => {
    for (const facet of FACETS) {
      // outside the household's reach: no role other than the desk roles sees anything, not even that it exists
      if (!desk.has(role)) {
        for (const inScope of [true, false]) expect(facetVisible({ facet, role, inScope, consents: granted(facet), now: NOW, viewerMemberIds: ["A"] }), `${role} ${facet} inScope=${inScope}`).toBe(false);
        continue;
      }
      // a member the viewer can already open: visible
      expect(facetVisible({ facet, role, inScope: true, consents: [], now: NOW, viewerMemberIds: ["A"] }), `${role} ${facet} in scope`).toBe(true);
      // a member of another RM's book, no consent: only that the relationship exists
      expect(facetVisible({ facet, role, inScope: false, consents: [], now: NOW, viewerMemberIds: ["A"] }), `${role} ${facet} cross, no consent`).toBe(facet === "relationship_exists");
      // with a matching consent: consentable facets open, never-facets stay shut
      const withConsent = facetVisible({ facet, role, inScope: false, consents: granted(facet), now: NOW, viewerMemberIds: ["A"] });
      expect(withConsent, `${role} ${facet} cross, consent`).toBe(facet === "relationship_exists" || (CONSENTABLE_FACETS as readonly string[]).includes(facet));
    }
  });

  it("ADMIN is not special for the wall's own rule: with no consent an admin viewing a member outside their direct scope still gets only the relationship (admin scope is 'everyone', so inScope is true in practice)", () => {
    // the loader sets inScope from the viewer's record scope; ADMIN's scope is everyone, so an ADMIN is always inScope. The pure rule itself does not special-case a role.
    expect(facetVisible({ facet: "member_identity", role: "ADMIN", inScope: false, consents: [], now: NOW, viewerMemberIds: [] })).toBe(false);
  });
});

describe("consent semantics", () => {
  const base = { facet: "portfolio_summary" as const, role: "RM", inScope: false, now: NOW, viewerMemberIds: ["A"] };
  it("a consent for another facet does not open this one", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["member_identity"] })] })).toBe(false);
  });
  it("a withdrawn consent closes it, even if an older grant exists", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["portfolio_summary"], capturedAt: day(-10) }), row({ scopes: ["portfolio_summary"], status: "WITHDRAWN", capturedAt: day(-2) })] })).toBe(false);
  });
  it("a later grant reopens it", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["portfolio_summary"], status: "WITHDRAWN", capturedAt: day(-10) }), row({ scopes: ["portfolio_summary"], capturedAt: day(-2) })] })).toBe(true);
  });
  it("an expired grant is no grant", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["portfolio_summary"], expiresAt: day(-1) })] })).toBe(false);
  });
  it("a grant dated in the future is not in effect yet", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["portfolio_summary"], capturedAt: day(3) })] })).toBe(false);
  });
  it("a grant to one specific member does not open the facet to the RM of a different member", () => {
    expect(facetVisible({ ...base, viewerMemberIds: ["C"], consents: [row({ scopes: ["portfolio_summary"], granteeClientId: "A" })] })).toBe(false);
    expect(facetVisible({ ...base, viewerMemberIds: ["A"], consents: [row({ scopes: ["portfolio_summary"], granteeClientId: "A" })] })).toBe(true);
  });
  it("a specific withdrawal for the viewer's member overrides a general grant to everyone", () => {
    const rows = [row({ scopes: ["portfolio_summary"], granteeClientId: null, capturedAt: day(-10) }), row({ scopes: ["portfolio_summary"], granteeClientId: "A", status: "WITHDRAWN", capturedAt: day(-2) })];
    expect(facetVisible({ ...base, viewerMemberIds: ["A"], consents: rows })).toBe(false);
    expect(facetVisible({ ...base, viewerMemberIds: ["C"], consents: rows })).toBe(true);
  });
  it("a consent row that lists a never-facet is ignored for it", () => {
    expect(consentCovers([row({ scopes: ["memory_confirmed", "contact_details"] })], "memory_confirmed", ["A"], NOW)).toBe(false);
    expect(consentCovers([row({ scopes: ["memory_confirmed"] })], "contact_details", ["A"], NOW)).toBe(false);
  });
  it("a consent that belongs to some other subject is not used", () => {
    expect(facetVisible({ ...base, consents: [row({ scopes: ["portfolio_summary"], subjectClientId: "Z" })], subjectClientId: "B" })).toBe(false);
  });
});

describe("validateConsentScopes", () => {
  it("accepts consentable facets, rejects the relationship itself and the never-facets, rejects empty", () => {
    expect(validateConsentScopes(["member_identity", "portfolio_summary"])).toEqual({ ok: true, scopes: ["member_identity", "portfolio_summary"] });
    expect(validateConsentScopes([])).toMatchObject({ ok: false });
    expect(validateConsentScopes(["memory_confirmed"])).toMatchObject({ ok: false });
    expect(validateConsentScopes(["contact_details"])).toMatchObject({ ok: false });
    expect(validateConsentScopes(["relationship_exists"])).toMatchObject({ ok: false });
    expect(validateConsentScopes(["nonsense"])).toMatchObject({ ok: false });
  });
  it("de-duplicates", () => {
    expect(validateConsentScopes(["member_identity", "member_identity"])).toEqual({ ok: true, scopes: ["member_identity"] });
  });
});
