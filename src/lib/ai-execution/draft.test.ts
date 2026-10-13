import { describe, expect, it } from "vitest";

import { buildTemplateDraft, buildUserPrompt, checkDraft, doNotDiscussTerms, guardDraftContext, mentionsDoNotDiscuss, type DraftContext } from "./draft";

const base: DraftContext = {
  clientId: "client-1",
  firstName: "Riya",
  language: "English",
  kind: "conversation",
  acceptance: ["PMS: medium", "Equity: high"],
  lastInteraction: { channel: "whatsapp", date: "2026-10-01" },
  pendingCommitments: 0,
  doNotDiscuss: ["PMS: customer is not ready for lock-in products"],
  openIssueKinds: [],
};

describe("guardrail: an open complaint blocks a sales draft (only a service response may go out)", () => {
  it("refuses a sales conversation for a client with an open complaint", () => {
    const r = guardDraftContext({ ...base, openIssueKinds: ["complaint"] });
    expect(r.ok).toBe(false);
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

describe("guardrail: a do-not-discuss topic is never in a draft", () => {
  it("finds the words a do-not-discuss entry turns on, without the stop words", () => {
    const terms = doNotDiscussTerms(["PMS: customer is not ready for lock-in products"]);
    expect(terms).toContain("pms");
    expect(terms).toContain("lock");
    expect(terms).toContain("products");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("not");
  });
  it("flags a draft that raises the topic, whatever the case", () => {
    expect(mentionsDoNotDiscuss("Hi Riya, a Pms could suit you.", base.doNotDiscuss)).toBe("pms");
  });
  it("checkDraft refuses a draft that uses a do-not-discuss topic", () => {
    const r = checkDraft("Hi Riya, would a PMS with lock-in suit you?", base);
    expect(r.ok).toBe(false);
  });
  it("the template never contains a do-not-discuss topic, for any context shape", () => {
    const contexts: DraftContext[] = [
      base,
      { ...base, pendingCommitments: 2 },
      { ...base, lastInteraction: null, language: "Hinglish" },
      { ...base, kind: "service_response", openIssueKinds: ["complaint"] },
    ];
    for (const ctx of contexts) {
      const body = buildTemplateDraft(ctx);
      expect(mentionsDoNotDiscuss(body, ctx.doNotDiscuss), body).toBeNull();
      expect(checkDraft(body, ctx).ok, body).toBe(true);
    }
  });
  it("the prompt does not send the do-not-discuss text to the vendor (it is enforced after, not shown)", () => {
    expect(buildUserPrompt(base)).not.toContain("lock-in");
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
    const body = buildTemplateDraft({ ...base, lastInteraction: null });
    expect(body).toMatch(/checking in on your account/);
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
