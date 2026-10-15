import { describe, expect, it } from "vitest";

import { approvalRefusalCopy, draftRefusalCopy } from "./refusal-copy";

describe("draftRefusalCopy: plain language for a draft that was not made", () => {
  it("a sales block says a sales draft is blocked for this customer, and offers a hand-over", () => {
    const copy = draftRefusalCopy({ status: "refused", reason: "sales topics are set aside for this customer" });
    expect(copy).toEqual({ message: "A sales draft is blocked for this customer: sales topics are set aside on their record.", canHandOver: true });
  });

  it("an open complaint blocks the sales draft and offers a hand-over", () => {
    const copy = draftRefusalCopy({ status: "refused", reason: "an open complaint or compliance concern is on record: only a service response may be drafted" });
    expect(copy.message).toContain("open complaint");
    expect(copy.canHandOver).toBe(true);
  });

  it("a recommendation the drafter already handed over says so and offers nothing more", () => {
    const copy = draftRefusalCopy({ status: "refused", reason: "model draft refused: recommendation intent", routeToHandover: true });
    expect(copy.message).toContain("passed to your RM");
    expect(copy.canHandOver).toBe(false);
  });

  it("a customer who asked not to be contacted gets no hand-over offer", () => {
    expect(draftRefusalCopy({ status: "refused", reason: "the customer has asked not to be contacted" }).canHandOver).toBe(false);
  });

  it("an unreadable do-not-discuss entry fails closed with a plain reason", () => {
    const copy = draftRefusalCopy({ status: "refused", reason: "blocked topic has no match terms (x): nothing may be drafted until it is fixed" });
    expect(copy.message).toContain("do-not-discuss topic");
    expect(copy.canHandOver).toBe(true);
  });

  it("a gateway stop is a plain message, never the internal reason", () => {
    const copy = draftRefusalCopy({ status: "blocked", reason: "consent_missing: AI_PROCESSING_OF_CHATS" });
    expect(copy.message).not.toContain("consent_missing");
    expect(copy.canHandOver).toBe(true);
  });

  it("an unknown refusal still gives a safe, plain message with a hand-over", () => {
    const copy = draftRefusalCopy({ status: "refused", reason: "something unexpected" });
    expect(copy.message).toBe("No draft was made for this customer. Write the reply yourself, or hand the conversation to your RM.");
    expect(copy.canHandOver).toBe(true);
  });
});

describe("approvalRefusalCopy: an edited message that fails the checks is not stored", () => {
  it("names the do-not-discuss topic in plain words", () => {
    expect(approvalRefusalCopy("uses a do-not-discuss topic (PMS)").message).toContain("cannot be sent for approval");
  });
  it("an empty message asks for text and offers nothing else", () => {
    expect(approvalRefusalCopy("the message is empty")).toEqual({ message: "Write a message before sending it for approval.", canHandOver: false });
  });
});
