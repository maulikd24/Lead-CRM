import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pseudonymize } from "@/lib/access/pseudonym";

import { standInId, standInName } from "./stand-in";

const OLD = process.env.AUTH_SECRET;
beforeEach(() => { process.env.AUTH_SECRET = "test-secret-one"; });
afterEach(() => { process.env.AUTH_SECRET = OLD; });

/** The attribution stand-in is the access module's pseudonymiser, not a second one. */
describe("attribution stand-ins are the access pseudonymiser", () => {
  it("the id IS pseudonymize(id)", () => expect(standInId("cm9clientidabc")).toBe(pseudonymize("cm9clientidabc")));
  it("the name is derived from the same label (so the id and the name always agree)", () => {
    expect(standInName("cm9clientidabc")).toBe(`Lead ${pseudonymize("cm9clientidabc").slice(2, 7)}`);
  });
  // The properties the old private copy had, kept (equivalence): stable, one label per customer, opaque.
  it("is stable per customer and different per customer", () => {
    expect(standInId("a")).toBe(standInId("a"));
    expect(standInId("a")).not.toBe(standInId("b"));
  });
  it("does not contain the real id or any part of a name, and has a fixed readable shape", () => {
    expect(standInId("cm9clientidabc")).not.toContain("clientid");
    expect(standInName("cm9clientidabc")).toMatch(/^Lead [0-9a-f]{5}$/);
  });
  // The reason for the swap: the old copy was an UNKEYED hash, so anyone with an id could recompute it. Now it needs the secret.
  it("cannot be recomputed without the server secret", () => {
    const withOne = standInId("a");
    process.env.AUTH_SECRET = "test-secret-two";
    expect(standInId("a")).not.toBe(withOne);
  });
  it("refuses to run without a secret rather than hashing with nothing", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => standInId("a")).toThrow();
  });
});
