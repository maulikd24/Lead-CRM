import { describe, expect, it } from "vitest";

import { buildClientWhere } from "@/lib/clients/build-client-where";
import { contactSearchClauses } from "./contact-search";

describe("contactSearchClauses", () => {
  it("lets an Admin (who may reveal anyway) match a number or email by any fragment", () => {
    expect(contactSearchClauses("987", true)).toEqual([{ mobile: { contains: "987", mode: "insensitive" } }, { email: { contains: "987", mode: "insensitive" } }]);
  });
  it("gives a non-Admin nothing for a short or partial value, so rows cannot be filtered digit by digit", () => {
    for (const q of ["9", "98", "987654", "98765432", "asha", "a@", "asha@exa"]) expect(contactSearchClauses(q, false)).toEqual([]);
  });
  it("matches a non-Admin only on a full number (any common shape) or a full email, exactly", () => {
    expect(contactSearchClauses("+91 98765-43123", false)).toEqual([{ mobileKey: "9876543123" }]);
    expect(contactSearchClauses("Asha@Example.com", false)).toEqual([{ emailKey: "asha@example.com" }]);
  });
});

describe("buildClientWhere q for a non-Admin", () => {
  const orOf = (visible: string[] | null, q: string) => JSON.stringify((buildClientWhere({ q }, visible) as { OR: unknown[] }).OR);
  it("does not substring-match mobile or email", () => {
    const or = orOf(["rm-1"], "987");
    expect(or).not.toContain('"mobile"');
    expect(or).not.toContain('"email"');
    expect(or).toContain('"name"');
  });
  it("keeps substring matching for an Admin", () => {
    expect(orOf(null, "987")).toContain('"mobile"');
  });
});
