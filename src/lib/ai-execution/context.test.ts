import { describe, expect, it } from "vitest";

import { draftContextFromBriefing, firstNameOf, languageOf, type BriefingLike } from "./context";

const briefing: BriefingLike = {
  customer: { id: "client-1", name: "Riya Sharma", preferredLanguage: "hi" },
  whyContactingNow: { programme: "Growth" },
  mustNotDiscuss: ["PMS: not ready"],
  assetClassAcceptance: { PMS: { level: "medium" }, Equity: { level: "high" } },
  recentInteractions: [{ channel: "whatsapp", date: "2026-10-01" }],
  pendingCommitments: [{ text: "send the statement", due: "2026-10-15" }],
  openIssues: [{ kind: "complaint" }],
};

describe("the drafter sees a plain context, never the raw briefing", () => {
  it("keeps the first name only", () => {
    expect(firstNameOf("Riya Sharma")).toBe("Riya");
    expect(firstNameOf("  ")).toBe("there");
    expect(firstNameOf("O'Brien-Smith Jr")).toBe("O'BrienSmith");
  });
  it("maps Hindi preference to Hinglish and everything else to English", () => {
    expect(languageOf("hi")).toBe("Hinglish");
    expect(languageOf("hi-IN")).toBe("Hinglish");
    expect(languageOf("en")).toBe("English");
    expect(languageOf(null)).toBe("English");
  });
  it("copies only what a draft needs, and counts the open commitments without their text", () => {
    const ctx = draftContextFromBriefing(briefing, "conversation");
    expect(ctx).toEqual({
      clientId: "client-1",
      firstName: "Riya",
      language: "Hinglish",
      kind: "conversation",
      acceptance: ["PMS: medium", "Equity: high"],
      lastInteraction: { channel: "whatsapp", date: "2026-10-01" },
      pendingCommitments: 1,
      doNotDiscuss: ["PMS: not ready"],
      openIssueKinds: ["complaint"],
    });
    expect(JSON.stringify(ctx)).not.toContain("statement");
    expect(JSON.stringify(ctx)).not.toContain("Sharma");
  });
});
