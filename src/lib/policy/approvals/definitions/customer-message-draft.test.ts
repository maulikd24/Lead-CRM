import { describe, expect, it } from "vitest";

import { getApprovalDefinition } from "../registry";
import "./customer-message-draft";
import { mayDecideCustomerDraft, type DraftOwnership } from "./customer-message-draft";

/** Customer c1 is assigned to RM A; c2 to RM B; c3 is unassigned. Manager M sees RM A only. */
const ownership: DraftOwnership = {
  ownerOf: async (clientId) => ({ c1: "rm-a", c2: "rm-b", c3: null } as Record<string, string | null>)[clientId] ?? null,
  visibleOwnerIds: async (managerId) => (managerId === "mgr-1" ? ["rm-a"] : managerId === "mgr-all" ? null : []),
};

describe("who may approve a customer's draft", () => {
  it("an RM may approve a draft for a customer assigned to them", async () => {
    expect(await mayDecideCustomerDraft({ id: "rm-a", role: "RM" }, "c1", ownership)).toBe(true);
  });

  it("RM B cannot approve RM A's customer draft", async () => {
    expect(await mayDecideCustomerDraft({ id: "rm-b", role: "RM" }, "c1", ownership)).toBe(false);
  });

  it("a MANAGER may approve when the customer is in their visible set", async () => {
    expect(await mayDecideCustomerDraft({ id: "mgr-1", role: "MANAGER" }, "c1", ownership)).toBe(true);
  });

  it("a MANAGER may not approve a customer outside their visible set", async () => {
    expect(await mayDecideCustomerDraft({ id: "mgr-1", role: "MANAGER" }, "c2", ownership)).toBe(false);
  });

  it("an unrestricted MANAGER may approve any assigned customer", async () => {
    expect(await mayDecideCustomerDraft({ id: "mgr-all", role: "MANAGER" }, "c2", ownership)).toBe(true);
  });

  it("an ADMIN may approve any customer, assigned or not", async () => {
    expect(await mayDecideCustomerDraft({ id: "admin-1", role: "ADMIN" }, "c1", ownership)).toBe(true);
    expect(await mayDecideCustomerDraft({ id: "admin-1", role: "ADMIN" }, "c3", ownership)).toBe(true);
  });

  it("an unassigned customer is open to the ADMIN alone", async () => {
    expect(await mayDecideCustomerDraft({ id: "rm-a", role: "RM" }, "c3", ownership)).toBe(false);
    expect(await mayDecideCustomerDraft({ id: "mgr-all", role: "MANAGER" }, "c3", ownership)).toBe(false);
  });

  it("the registered definition applies the rule to the request's customer", async () => {
    const def = getApprovalDefinition("CUSTOMER_MESSAGE_DRAFT");
    // The production lookups need a database, so only the role gate is exercised here: a non-decider role is refused without a lookup.
    expect(await def.canDecide({ id: "u", role: "DEALER" as never }, { entity: "Client", entityId: "c1" })).toBe(false);
  });
});
