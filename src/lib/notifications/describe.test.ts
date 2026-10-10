import { describe, expect, it } from "vitest";

import { describeNotification, notificationCategory, notificationUrl } from "./describe";

const n = { type: "duplicate_review_requested", payload: { suggestionId: "s1", clientId: "c1", clientCode: "C-001", rmName: "Asha", requestedById: "u1" } };

describe("duplicate_review_requested notification", () => {
  it("names the RM and the RM's own customer code, and nothing about the other customer", () => {
    expect(describeNotification(n)).toBe("Asha asks you to review a possible duplicate of C-001");
  });
  it("lands on the duplicate review queue, not on the (possibly out-of-team) customer page", () => {
    expect(notificationUrl(n)).toBe("/clients/duplicates");
  });
  it("belongs to the assignments category", () => {
    expect(notificationCategory(n.type)).toBe("assignments");
  });
});
