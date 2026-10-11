import { describe, expect, it } from "vitest";

import { CALL_OUTCOMES, dueDate, validateCall, validateTask } from "./quick-actions-logic";

describe("dueDate", () => {
  const now = new Date("2026-10-11T06:00:00.000Z"); // 11:30 am in India
  it("today is 6 pm India time while that is still ahead, otherwise an hour from now", () => {
    expect(dueDate("today", now).toISOString()).toBe("2026-10-11T12:30:00.000Z");
    const late = new Date("2026-10-11T13:00:00.000Z");
    expect(dueDate("today", late).toISOString()).toBe("2026-10-11T14:00:00.000Z");
  });
  it("tomorrow is 10 am India time and in three days is 10 am three days on", () => {
    expect(dueDate("tomorrow", now).toISOString()).toBe("2026-10-12T04:30:00.000Z");
    expect(dueDate("3days", now).toISOString()).toBe("2026-10-14T04:30:00.000Z");
  });
});

describe("validateTask", () => {
  it("needs a client and a title", () => {
    expect(validateTask({ clientId: "", title: "Call" })).toMatch(/client/i);
    expect(validateTask({ clientId: "c1", title: "  " })).toMatch(/what/i);
    expect(validateTask({ clientId: "c1", title: "Call back" })).toBeNull();
  });
});

describe("validateCall (the same rules as recording an RM contact)", () => {
  it("needs a client and an outcome", () => {
    expect(validateCall({ clientId: "", outcome: "Connected", notes: "", nextAction: "" })).toMatch(/client/i);
    expect(validateCall({ clientId: "c1", outcome: "", notes: "", nextAction: "" })).toMatch(/outcome/i);
  });
  it("needs notes for a negative outcome", () => {
    for (const o of ["Not interested", "Unreachable", "Wrong number"]) {
      expect(validateCall({ clientId: "c1", outcome: o, notes: "", nextAction: "" })).toMatch(/notes/i);
      expect(validateCall({ clientId: "c1", outcome: o, notes: "Switched off", nextAction: "" })).toBeNull();
    }
  });
  it("needs a next action for an open-ended outcome", () => {
    for (const o of ["Call back requested", "Interested"]) {
      expect(validateCall({ clientId: "c1", outcome: o, notes: "", nextAction: "" })).toMatch(/next/i);
      expect(validateCall({ clientId: "c1", outcome: o, notes: "", nextAction: "Send the form" })).toBeNull();
    }
  });
  it("lets Connected through with nothing else", () => {
    expect(validateCall({ clientId: "c1", outcome: "Connected", notes: "", nextAction: "" })).toBeNull();
    expect(CALL_OUTCOMES).toContain("Connected");
  });
});
