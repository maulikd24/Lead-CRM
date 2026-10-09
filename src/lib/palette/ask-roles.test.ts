import { describe, expect, it } from "vitest";
import { ASK_ROLES, canAsk } from "./ask-roles";

describe("canAsk", () => {
  it("allows only the roles the action allows", () => {
    expect(canAsk("ADMIN")).toBe(true);
    expect(canAsk("MANAGER")).toBe(true);
    for (const r of ["RM", "DEALER", "TEAM_MANAGER", "PARTNER"] as const) expect(canAsk(r)).toBe(false);
    expect([...ASK_ROLES]).toEqual(["ADMIN", "MANAGER"]);
  });
});
