import { describe, expect, it } from "vitest";

import { checkDraft } from "./draft";
import { draftContextFromBriefing, firstNameOf, languageOf, splitBlockedKeys, type BriefingLike } from "./context";

const briefing: BriefingLike = {
  customer: { id: "client-1", name: "Riya Sharma", preferredLanguage: "hi" },
  whyContactingNow: { programme: "Growth" },
  mustNotDiscuss: ["PMS: not ready"],
  mustNotDiscussKeys: ["asset:PMS"],
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
      blockedAssetClasses: ["PMS"],
      blockedTopics: [],
      openIssueKinds: ["complaint"],
    });
    expect(JSON.stringify(ctx)).not.toContain("statement");
    expect(JSON.stringify(ctx)).not.toContain("Sharma");
  });
});

describe("blocked keys are structured, and the display text is never matched", () => {
  it("splits asset keys, the sales block, and other topics", () => {
    expect(splitBlockedKeys(["asset:AIF", "sales", "topic:lock-in products"])).toEqual({
      blockedAssetClasses: ["AIF"],
      blockedTopics: ["sales", "lock-in products"],
    });
  });
  it("a reason that uses 'interested' or 'avoid' does not block a benign draft", () => {
    const ctx = draftContextFromBriefing(
      { ...briefing, mustNotDiscuss: ["PMS: Said not interested; avoid repeating the pitch"], mustNotDiscussKeys: ["asset:PMS"] },
      "conversation",
    );
    expect(ctx.blockedAssetClasses).toEqual(["PMS"]);
    expect(ctx.blockedTopics).toEqual([]);
    expect(checkDraft("Hi Riya, you were interested in our review call. Shall we avoid a clash and pick a slot?", ctx)).toEqual({ ok: true });
  });
  it("display text with no structured keys fails closed on every draft", () => {
    const ctx = draftContextFromBriefing({ ...briefing, mustNotDiscuss: ["PMS: not ready"], mustNotDiscussKeys: [] }, "conversation");
    expect(ctx.blockedTopics).toEqual([""]);
    expect(checkDraft("Hi Riya, checking in.", ctx).ok).toBe(false);
  });
});
