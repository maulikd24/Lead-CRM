import { describe, expect, it, vi } from "vitest";

import { captureConversationOutcome, CONVERSATION_OUTCOMES, outcomeFromLabel, type CaptureOutcomeInput } from "./outcome";

const base: CaptureOutcomeInput = { clientId: "client-1", outcome: "INTERESTED", channel: "AI_BOT", actorType: "AI_AGENT" };

describe("the conversation outcomes are the bible's, stored as the existing enum", () => {
  it("has the seven distinct outcomes (the bible lists Not Relevant twice)", () => {
    expect(CONVERSATION_OUTCOMES.map((o) => o.label)).toEqual(["Interested", "Not Interested", "Follow Up", "RM Handover", "Converted", "Service Issue", "Not Relevant"]);
    expect(new Set(CONVERSATION_OUTCOMES.map((o) => o.value)).size).toBe(7);
  });
  it("maps a bible label to its outcome, ignoring case and spacing", () => {
    expect(outcomeFromLabel("Follow Up")).toBe("FOLLOW_UP");
    expect(outcomeFromLabel("rm handover")).toBe("RM_HANDOVER");
    expect(outcomeFromLabel("  Not Relevant ")).toBe("NOT_RELEVANT");
    expect(outcomeFromLabel("Maybe")).toBeNull();
  });
});

describe("outcome capture feeds the existing outcome path", () => {
  it("hands a valid outcome to the existing recorder, unchanged", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ id: "row-1" }));
    await captureConversationOutcome({ ...base, outcome: "CONVERTED", assetClass: "PMS", note: "opened the account" }, { record });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ clientId: "client-1", outcome: "CONVERTED", assetClass: "PMS", actorType: "AI_AGENT" });
  });

  it("defaults an empty channel to the AI bot channel", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
    await captureConversationOutcome({ ...base, channel: "" }, { record });
    expect(record.mock.calls[0][0]).toMatchObject({ channel: "AI_BOT" });
  });

  it("refuses an RM handover that has no summary for the RM", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
    await expect(captureConversationOutcome({ ...base, outcome: "RM_HANDOVER", summary: "  " }, { record })).rejects.toThrow(/needs a summary/);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a service issue that has no note", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
    await expect(captureConversationOutcome({ ...base, outcome: "SERVICE_ISSUE" }, { record })).rejects.toThrow(/needs a note/);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses an outcome that is not one of the seven", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
    await expect(captureConversationOutcome({ ...base, outcome: "MAYBE" as never }, { record })).rejects.toThrow(/Unknown conversation outcome/);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses an outcome with no customer", async () => {
    const record = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({}));
    await expect(captureConversationOutcome({ ...base, clientId: "" }, { record })).rejects.toThrow(/needs a customer/);
  });
});
