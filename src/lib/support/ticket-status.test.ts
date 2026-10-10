import { describe, expect, it } from "vitest";

import { isOpenTicket } from "./ticket-status";

describe("isOpenTicket", () => {
  it("treats resolved and closed (any case) as done", () => {
    expect(isOpenTicket("resolved")).toBe(false);
    expect(isOpenTicket("Closed")).toBe(false);
  });
  it("treats open, pending, unknown and missing as still open", () => {
    for (const s of ["open", "pending", "on_hold", "weird", null, ""]) expect(isOpenTicket(s)).toBe(true);
  });
});
