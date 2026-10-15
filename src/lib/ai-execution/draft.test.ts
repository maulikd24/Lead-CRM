import { describe, expect, it } from "vitest";

import { assetTerms, blockedTopicUsed, buildTemplateDraft, buildUserPrompt, checkDraft, guardDraftContext, stemOf, topicStems, unmatchedBlockedEntry, type DraftContext } from "./draft";

const base: DraftContext = {
  clientId: "client-1",
  firstName: "Riya",
  language: "English",
  kind: "conversation",
  acceptance: ["PMS: medium", "Equity: high"],
  lastInteraction: { channel: "whatsapp", date: "2026-10-01" },
  pendingCommitments: 0,
  blockedAssetClasses: ["PMS"],
  blockedTopics: [],
  openIssueKinds: [],
};

describe("guardrail: an open complaint blocks a sales draft (only a service response may go out)", () => {
  it("refuses a sales conversation for a client with an open complaint", () => {
    expect(guardDraftContext({ ...base, openIssueKinds: ["complaint"] }).ok).toBe(false);
  });
  it("refuses it for a compliance concern and an incorrect-info issue too", () => {
    expect(guardDraftContext({ ...base, openIssueKinds: ["compliance_concern"] }).ok).toBe(false);
    expect(guardDraftContext({ ...base, openIssueKinds: ["incorrect_info"] }).ok).toBe(false);
  });
  it("allows a service response for a client with an open complaint", () => {
    expect(guardDraftContext({ ...base, kind: "service_response", openIssueKinds: ["complaint"] }).ok).toBe(true);
  });
  it("allows an ordinary conversation when nothing is open", () => {
    expect(guardDraftContext(base).ok).toBe(true);
  });
});

describe("guardrail: a sales block on the customer refuses every conversation draft (fail closed)", () => {
  it("refuses every conversation draft when the sales block is set", () => {
    const r = guardDraftContext({ ...base, blockedTopics: ["sales"] });
    expect(r).toEqual({ ok: false, reason: "sales topics are set aside for this customer" });
  });
  it("still allows a service response while sales are set aside", () => {
    expect(guardDraftContext({ ...base, kind: "service_response", blockedTopics: ["sales"] }).ok).toBe(true);
  });
});

describe("guardrail: an asset class or topic with no match terms fails closed", () => {
  it("refuses a blocked asset class with no name to match on", () => {
    expect(assetTerms("")).toEqual([]);
    expect(guardDraftContext({ ...base, blockedAssetClasses: [""] }).ok).toBe(false);
  });
  it("refuses a free-text topic made only of stop words", () => {
    expect(topicStems("the and for")).toEqual([]);
    expect(guardDraftContext({ ...base, blockedTopics: ["the and for"] }).ok).toBe(false);
  });
  it("refuses the whole context when a blocked entry is empty (display text with no keys)", () => {
    expect(unmatchedBlockedEntry({ ...base, blockedTopics: [""] })).toBe("(empty topic)");
    expect(checkDraft("Hi Riya, checking in.", { ...base, blockedTopics: [""] }).ok).toBe(false);
  });
});

describe("asset classes match by their alias map and by name", () => {
  it("PMS is named by its aliases", () => {
    expect(assetTerms("PMS")).toEqual(expect.arrayContaining(["pms", "portfolio management service", "discretionary", "managed account"]));
  });
  it("catches each alias in a draft, whatever the case and plural", () => {
    for (const phrase of ["a PMS could help", "Portfolio Management Service", "a discretionary mandate", "managed accounts", "your PMS-style plan"]) {
      expect(blockedTopicUsed(`Hi Riya, ${phrase}.`, base), phrase).toBe("PMS");
    }
  });
  it("catches an AIF, a mutual fund, and a bond by their aliases", () => {
    expect(blockedTopicUsed("Hi Riya, an alternative investment fund.", { ...base, blockedAssetClasses: ["AIF"] })).toBe("AIF");
    expect(blockedTopicUsed("Hi Riya, mutual funds are open.", { ...base, blockedAssetClasses: ["Mutual Funds"] })).toBe("Mutual Funds");
    expect(blockedTopicUsed("Hi Riya, a fixed income option.", { ...base, blockedAssetClasses: ["Bonds"] })).toBe("Bonds");
  });
  it("does not match a word that merely contains the term", () => {
    expect(blockedTopicUsed("Hi Riya, we can take a call on the spmsfund.", base)).toBeNull();
  });
});

describe("free-text topics match by stem", () => {
  it("matches inflections of the same stem", () => {
    expect(stemOf("products")).toBe("product");
    expect(blockedTopicUsed("Hi Riya, a new product is ready.", { ...base, blockedAssetClasses: [], blockedTopics: ["lock-in products"] })).toBe("lock-in products");
  });
  it("does not match a benign word that shares no stem", () => {
    expect(blockedTopicUsed("Hi Riya, shall we talk tomorrow?", { ...base, blockedAssetClasses: [], blockedTopics: ["lock-in products"] })).toBeNull();
  });
});

describe("guardrail: a do-not-discuss topic is never in a draft", () => {
  it("checkDraft refuses a draft that uses a blocked asset class", () => {
    const r = checkDraft("Hi Riya, would a PMS suit you?", base);
    expect(r.ok).toBe(false);
  });
  it("the template never contains a blocked asset class or topic, for any context shape", () => {
    const contexts: DraftContext[] = [
      base,
      { ...base, pendingCommitments: 2 },
      { ...base, lastInteraction: null, language: "Hinglish" },
      { ...base, kind: "service_response", openIssueKinds: ["complaint"] },
    ];
    for (const ctx of contexts) {
      const body = buildTemplateDraft(ctx);
      expect(blockedTopicUsed(body, ctx), body).toBeNull();
      expect(checkDraft(body, ctx).ok, body).toBe(true);
    }
  });
  it("the prompt sends the blocked asset classes and topics as structured keys, not the display text", () => {
    const prompt = buildUserPrompt({ ...base, blockedTopics: ["sales"] });
    expect(prompt).toContain('"blockedAssetClasses":["PMS"]');
    expect(prompt).toContain('"blockedTopics":["sales"]');
  });
});

describe("a benign draft is not blocked by the words a reason uses", () => {
  it("'interested' and 'avoid' in a reason do not block an ordinary message", () => {
    const body = "Hi Riya, we are glad you were interested in the review call. Let us know a good time.";
    expect(checkDraft(body, base)).toEqual({ ok: true });
  });
});

describe("recommendation intent is refused on every conversation draft", () => {
  // No asset class blocked here, so the recommendation check (not the topic check) is what refuses the phrase.
  const noBlocks: DraftContext = { ...base, blockedAssetClasses: [] };
  const phrases = [
    "Hi Riya, now is a good time to add to your holdings.",
    "Hi Riya, a PMS would suit you well.",
    "Hi Riya, you should consider increasing your allocation this quarter.",
    "Hi Riya, top up your SIP this month.",
    "Hi Riya, this is ideal for you.",
  ];
  it.each(phrases)("refuses and flags a recommendation: %s", (body) => {
    const r = checkDraft(body, noBlocks);
    expect(r).toMatchObject({ ok: false, code: "recommendation" });
  });
  it("refuses it on a service response too when it sells", () => {
    expect(checkDraft("Hi Riya, a good time to add would be now.", { ...noBlocks, kind: "service_response" }).ok).toBe(false);
  });
  it("does not refuse an ordinary acknowledgement or a call offer", () => {
    expect(checkDraft("Hi Riya, a good time to talk is Monday. Let us know.", noBlocks)).toEqual({ ok: true });
  });
});

describe("guardrail: the outbound compliance rules still apply to every draft", () => {
  it("refuses a draft that promises returns", () => {
    expect(checkDraft("Hi Riya, we guarantee good returns on this.", base).ok).toBe(false);
  });
  it("refuses a draft that gives advice", () => {
    expect(checkDraft("Hi Riya, you should buy this now.", base).ok).toBe(false);
  });
  it("refuses a draft that echoes a PAN", () => {
    expect(checkDraft("Hi Riya, your PAN ABCDE1234F is confirmed.", base).ok).toBe(false);
  });
});

describe("the template opens from the customer's context, not a product", () => {
  it("follows up on a pending commitment without quoting it", () => {
    const body = buildTemplateDraft({ ...base, pendingCommitments: 1 });
    expect(body).toContain("Hi Riya");
    expect(body).toMatch(/open point/);
    expect(body).not.toMatch(/PMS|invest|portfolio|return/i);
  });
  it("follows up on the last conversation when there is no commitment", () => {
    const body = buildTemplateDraft(base);
    expect(body).toMatch(/following up on our last conversation/);
    expect(body).not.toMatch(/PMS|invest|portfolio|return/i);
  });
  it("uses a plain check-in when there is no context at all", () => {
    expect(buildTemplateDraft({ ...base, lastInteraction: null })).toMatch(/checking in on your account/);
  });
  it("gives a Hinglish wording for a Hinglish customer", () => {
    expect(buildTemplateDraft({ ...base, language: "Hinglish", lastInteraction: null })).toMatch(/aapke account/);
  });
});

describe("a service response is never a sales message", () => {
  const svc: DraftContext = { ...base, kind: "service_response", openIssueKinds: ["complaint"] };
  it("the template is an acknowledgement with the next steps", () => {
    const body = buildTemplateDraft(svc);
    expect(body).toMatch(/noted your concern/);
    expect(checkDraft(body, svc).ok).toBe(true);
  });
  it("refuses a model wording that sells", () => {
    expect(checkDraft("Hi Riya, we have a new portfolio opportunity for you.", svc).ok).toBe(false);
  });
  it("the prompt for a service response carries no acceptance or sales context", () => {
    const user = buildUserPrompt(svc);
    expect(user).not.toContain("acceptance");
    expect(user).not.toContain("PMS");
  });
});

describe("the prompt is minimised", () => {
  it("sends the first name only, never a surname", () => {
    const user = buildUserPrompt({ ...base, firstName: "Riya" });
    expect(user).toContain("Riya");
    expect(user).not.toMatch(/Sharma/);
  });
});
