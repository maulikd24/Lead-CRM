import { describe, expect, it } from "vitest";

import { joinSessionCookie } from "./sso-logout";

describe("joinSessionCookie", () => {
  const b = "authjs.session-token";
  it("returns a whole cookie, joins chunks in numeric order, ignores unrelated names", () => {
    expect(joinSessionCookie([{ name: b, value: "abc" }], b)).toBe("abc");
    expect(
      joinSessionCookie(
        [
          { name: `${b}.10`, value: "C" },
          { name: `${b}.2`, value: "B" },
          { name: `${b}.0`, value: "A" },
          { name: `${b}.x`, value: "no" },
          { name: "other", value: "no" },
        ],
        b,
      ),
    ).toBe("ABC");
    expect(joinSessionCookie([], b)).toBeNull();
  });
});
