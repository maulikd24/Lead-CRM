import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "@/lib/access/policy";

import { autonomyViolations } from "./autonomy";
import { DEFINITIONS, KINDS, adapterKinds, approverKinds, definitionOf, mayApprove, mayRequest, requesterOnlyKinds, seamKinds, visibleKinds } from "./definitions";

const marketingKinds = () => KINDS.filter((k) => definitionOf(k).group === "marketing");

describe("canonical approval definitions", () => {
  it("registers every path that exists today plus the sibling-branch kinds", () => {
    expect([...KINDS].sort()).toEqual(
      [
        "agent-proposal", "social-post", "referral-statement", "merge-suggestion", "ai-pilot-signoff",
        "payout-run", "commission-adjustment", "erasure-request", "partner-tax-rule", "partner-override-rule", "stage-override",
        "autopilot-action", "ad-creative", "lead-push-draft", "closed-loop-destination", "consent-policy-change",
        "product-registry-change",
      ].sort(),
    );
  });

  it("closed-loop destination and consent wording changes are four-eyes Admin decisions: Marketing can neither request nor approve them, and a customer-facing wording is never above L4", () => {
    for (const kind of ["closed-loop-destination", "consent-policy-change"] as const) {
      const d = definitionOf(kind);
      expect(d.fourEyes, kind).toBe(true);
      expect(d.approverRoles, kind).toEqual(["ADMIN"]);
      expect(d.requesterRoles, kind).toEqual(["ADMIN"]);
      expect(d.adapter, kind).toBe("native");
      expect(d.autoApprove, kind).toBe("never");
    }
    expect(definitionOf("consent-policy-change").autonomy).toMatchObject({ level: "L4", customerFacing: true });
    expect(visibleKinds("MARKETING")).not.toContain("closed-loop-destination");
  });

  it("every definition respects the owner's autonomy ceilings", () => {
    for (const k of KINDS) expect(autonomyViolations(definitionOf(k).autonomy), k).toEqual([]);
  });

  it("customer-facing kinds are L3 or L4, ad spend L4 at most, and nothing here is L5 (an approval exists because a human decides)", () => {
    for (const k of KINDS) {
      const d = definitionOf(k);
      if (d.autonomy.customerFacing) expect(["L3", "L4"], k).toContain(d.autonomy.level);
      expect(d.autonomy.level, k).not.toBe("L5");
    }
    expect(definitionOf("autopilot-action").autonomy).toMatchObject({ adSpend: true, level: "L4" });
    expect(definitionOf("agent-proposal").autonomy).toMatchObject({ customerFacing: true, level: "L4" });
    expect(definitionOf("social-post").autonomy).toMatchObject({ customerFacing: true, level: "L3" });
  });

  it("there is no auto-approval on any definition, customer-facing or not", () => {
    for (const k of KINDS) expect(definitionOf(k).autoApprove, k).toBe("never");
  });

  it("customer-facing kinds require evidence and name their consent or policy preconditions", () => {
    for (const k of KINDS) {
      const d = definitionOf(k);
      if (!d.autonomy.customerFacing) continue;
      expect(d.requiredEvidence.length, `${k} evidence`).toBeGreaterThan(0);
    }
    expect(definitionOf("agent-proposal").preconditions).toContainEqual({ type: "consent", purpose: "MARKETING_COMMS", channel: "whatsapp" });
  });

  it("four-eyes is declared where the legacy path enforces it", () => {
    for (const k of ["social-post", "referral-statement", "payout-run", "partner-tax-rule", "partner-override-rule", "erasure-request"] as const) expect(definitionOf(k).fourEyes, k).toBe(true);
    expect(definitionOf("agent-proposal").fourEyes).toBe(false); // the author is an agent; a human always decides
    expect(definitionOf("ai-pilot-signoff").fourEyes).toBe(true); // Wave 1 tightening: a compliance reviewer and a different Admin; documented in docs/approvals.md
  });

  it("segregation: marketing kinds are Admin and Marketing only; no marketing role on any other kind", () => {
    for (const k of KINDS) {
      const d = definitionOf(k);
      const roles = [...d.approverRoles, ...(d.requesterRoles === "system" ? [] : d.requesterRoles)];
      if (d.group === "marketing") for (const r of roles) expect(["ADMIN", "MARKETING"], `${k} ${r}`).toContain(r);
      else expect(roles, k).not.toContain("MARKETING");
    }
  });

  it("an approver sees only kinds they may approve; MARKETING sees only marketing kinds", () => {
    expect(visibleKinds("MARKETING").every((k) => marketingKinds().includes(k))).toBe(true);
    expect(visibleKinds("MARKETING")).toContain("social-post");
    for (const role of ["RM", "MANAGER", "FINANCE", "TEAM_MANAGER"] as const) for (const k of visibleKinds(role)) expect(marketingKinds(), `${role} ${k}`).not.toContain(k);
    expect(approverKinds("RM").sort()).toEqual(["agent-proposal", "lead-push-draft", "merge-suggestion"]);
    expect(approverKinds("FINANCE").sort()).toEqual(["partner-override-rule", "partner-tax-rule", "referral-statement"]);
  });

  it("lead-push-draft is a message to a customer: ADMIN and the owning RM approve, MARKETING never sees it, and it carries the consent and outbound-guardrail gates at L4 (a person approves, nothing is automatic)", () => {
    const d = definitionOf("lead-push-draft");
    expect(d).toMatchObject({ adapter: "read-through", group: "customer", fourEyes: false, autoApprove: "never", approverRoles: ["ADMIN", "RM"] });
    expect(d.preconditions).toEqual(expect.arrayContaining([{ type: "consent", purpose: "MARKETING_COMMS", channel: "whatsapp" }, { type: "policy", name: "outbound-guardrails" }]));
    expect(d.autonomy).toMatchObject({ level: "L4", customerFacing: true });
    expect(visibleKinds("MARKETING")).not.toContain("lead-push-draft");
    expect(visibleKinds("MANAGER")).not.toContain("lead-push-draft");
  });

  it("people with no approval role see nothing (default deny)", () => {
    for (const role of ["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"] as const) expect(visibleKinds(role), role).toEqual([]);
  });

  it("a requester who cannot approve sees only their own requests", () => {
    expect(requesterOnlyKinds("MANAGER")).toEqual(["stage-override"]);
    expect(requesterOnlyKinds("FINANCE").sort()).toEqual(["commission-adjustment", "erasure-request", "payout-run"]);
    expect(requesterOnlyKinds("RM")).toEqual([]);
  });

  it("ADMIN may approve everything that has an adapter", () => {
    for (const k of adapterKinds()) expect(mayApprove("ADMIN", k), k).toBe(true);
    for (const r of ALL_ROLES) expect(mayRequest(r, "payout-run")).toBe(r === "ADMIN" || r === "FINANCE");
  });

  it("sibling-branch kinds are definitions only, with no adapter yet", () => {
    expect(seamKinds().sort()).toEqual(["ad-creative"]); // autopilot-action got its adapter in Wave 3
    for (const k of seamKinds()) expect(definitionOf(k).adapter).toBe("seam");
  });

  it("write-through flags exist only for adapters over a foreign table, one per adapter, all distinct", () => {
    const flags = DEFINITIONS.filter((d) => d.writeThroughFlag).map((d) => d.writeThroughFlag);
    expect(new Set(flags).size).toBe(flags.length);
    expect(flags.sort()).toEqual(["APPROVALS_WT_AGENT_PROPOSAL", "APPROVALS_WT_AI_PILOT_SIGNOFF", "APPROVALS_WT_AUTOPILOT_ACTION", "APPROVALS_WT_LEAD_PUSH_DRAFT", "APPROVALS_WT_MERGE_SUGGESTION", "APPROVALS_WT_PRODUCT_REGISTRY", "APPROVALS_WT_REFERRAL_STATEMENT", "APPROVALS_WT_SOCIAL_POST"]);
    for (const d of DEFINITIONS) if (d.adapter === "native" || d.adapter === "seam") expect(d.writeThroughFlag, d.kind).toBeNull();
  });

  it("the product registry change is a four-eyes, Admin-only, internal approval (Wave 2 integration): never customer-facing, never L5, written through under its own switch", () => {
    const d = definitionOf("product-registry-change");
    expect(d).toMatchObject({ fourEyes: true, approverRoles: ["ADMIN"], requesterRoles: ["ADMIN"], adapter: "read-through", writeThroughFlag: "APPROVALS_WT_PRODUCT_REGISTRY", autoApprove: "never" });
    expect(d.autonomy.customerFacing).toBe(false);
    expect(d.supports).toEqual({ approve: true, reject: true });
    expect(visibleKinds("RM")).not.toContain("product-registry-change");
    expect(visibleKinds("MARKETING")).not.toContain("product-registry-change");
    expect(approverKinds("ADMIN")).toContain("product-registry-change");
  });
});
