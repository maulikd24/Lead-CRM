import { describe, expect, it } from "vitest";

import { badgeText, navStateKey, parseRemembered, railCookieName, roleLabel } from "./nav-sections";

describe("badgeText", () => {
  it("shows nothing for zero or no count, 99+ past two digits", () => {
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");
  });
});
describe("roleLabel", () => {
  it("is a person's word for the role", () => {
    expect(roleLabel("RM")).toBe("RM");
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("TEAM_MANAGER")).toBe("Team manager");
  });
});
describe("remembered state", () => {
  it("parses defensively and keeps only booleans", () => {
    expect(parseRemembered(null)).toEqual({});
    expect(parseRemembered("nope")).toEqual({});
    expect(parseRemembered('["a"]')).toEqual({});
    expect(parseRemembered('{"a":true,"b":"x"}')).toEqual({ a: true });
  });
  it("keys are per person and cookie-safe", () => {
    expect(navStateKey("A@b.co")).toBe("allvest:navOpen:a@b.co");
    expect(railCookieName("u 1;x")).toBe("sidebar_state_u1x");
  });
});
