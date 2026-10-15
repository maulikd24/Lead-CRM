import { describe, expect, it } from "vitest";

import { guardDraftContext } from "@/lib/ai-execution/draft";

import { assemble, checkReplyText, COPILOT_PURPOSE, COPILOT_TEMPLATES, generateCopilotDraft, identifierProblem, type CopilotDraftInput } from "./draft";
import { ctx, blocked, failed, fakeModel, ok } from "./test-fixtures";

const input = (over: Partial<CopilotDraftInput> = {}): CopilotDraftInput => ({
  ctx: ctx(),
  category: "general",
  firstName: "Asha",
  excerpt: "Please send my statement",
  summary: "The customer asks for the latest account statement.",
  escalate: false,
  ...over,
});

describe("no sales reply on a complaint ticket", () => {
  it("a complaint is an escalation: a conversation (sales-style) draft is refused by the guard", () => {
    const open = ctx({ kind: "conversation", openIssueKinds: ["complaint"] });
    const guard = guardDraftContext(open);
    expect(guard.ok).toBe(false);
  });

  it("a model reply that pitches a product on a complaint ticket is never shown; the acknowledgement template is used", async () => {
    const { callModel } = fakeModel(ok("Good time to add to your PMS, our new fund suits you"));
    const out = await generateCopilotDraft(input({ category: "complaint", escalate: true, ctx: ctx({ openIssueKinds: ["complaint"] }) }), { callModel });
    expect(out.status).toBe("draft");
    if (out.status !== "draft") return;
    expect(out.source).toBe("template");
    expect(out.note).toContain("model draft not used");
    expect(out.body).not.toMatch(/PMS|fund|suits you|add to your/i);
    expect(out.body).toBe(assemble("Asha", COPILOT_TEMPLATES.complaint));
  });

  it("service replies refuse sales wording and recommendations even when written by hand", () => {
    const c = ctx({ openIssueKinds: ["complaint"] });
    expect(checkReplyText("Consider increasing your investment in our new fund.", c).ok).toBe(false);
    expect(checkReplyText("Our PMS offer returns well this quarter.", c).ok).toBe(false);
    expect(checkReplyText("Hi Asha, we are looking into this and will update you shortly.", c).ok).toBe(true);
  });

  it("an escalated complaint still gets an acknowledgement, never a sale", async () => {
    const { callModel } = fakeModel(failed("not_configured"));
    const out = await generateCopilotDraft(input({ category: "complaint", escalate: true }), { callModel });
    expect(out.status).toBe("draft");
    if (out.status === "draft") expect(out.body).toContain("We are sorry for the trouble");
  });
});

describe("guardrails before a draft is shown", () => {
  it("a model draft that names a blocked asset class is replaced by the template", async () => {
    const { callModel } = fakeModel(ok("Your PMS statement is ready to download."));
    const out = await generateCopilotDraft(input({ ctx: ctx({ blockedAssetClasses: ["PMS"] }) }), { callModel });
    expect(out.status === "draft" && out.source).toBe("template");
  });

  it("a blocked topic with no match terms fails closed: nothing is drafted", async () => {
    const { callModel, calls } = fakeModel(ok("Hello"));
    const out = await generateCopilotDraft(input({ ctx: ctx({ blockedTopics: [""] }) }), { callModel });
    expect(out.status).toBe("refused");
    expect(calls.length).toBe(0);
  });

  it("the customer's do-not-contact request refuses the draft", async () => {
    const { callModel } = fakeModel({ kind: "abstain", reason: "do_not_contact", correlationId: "c", runId: null } as never);
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out.status).toBe("refused");
  });

  it("a compliance judge that flags the model text sends the template instead", async () => {
    const { callModel } = fakeModel(ok("We can help you with the statement and the next steps."), ok("UNSAFE: implies advice"));
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out.status === "draft" && out.source).toBe("template");
    if (out.status === "draft") expect(out.note).toContain("judge");
  });

  it("an unavailable judge falls back to the reviewed template, never to an unchecked model draft", async () => {
    const { callModel } = fakeModel(ok("We have your statement request and will send it shortly."), failed("provider_error"));
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out.status === "draft" && out.source).toBe("template");
  });

  it("a consent or kill-switch block stops the draft: no template is written", async () => {
    const { callModel } = fakeModel(blocked("consent_denied"));
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out).toEqual({ status: "blocked", reason: "consent_denied" });
  });

  it("a budget cap falls back to the template, as an operating limit", async () => {
    const { callModel } = fakeModel(blocked("budget_exceeded"));
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out.status === "draft" && out.source).toBe("template");
  });
});

describe("template fallback without a key", () => {
  it("with no AI key the reviewed template for the category is shown, with a note", async () => {
    const { callModel } = fakeModel(failed("not_configured"));
    const out = await generateCopilotDraft(input({ category: "billing" }), { callModel });
    expect(out).toEqual({ status: "draft", body: assemble("Asha", COPILOT_TEMPLATES.billing), source: "template", note: "no AI key configured: template reply" });
  });

  it("every category has a template that passes every check", () => {
    for (const [category, text] of Object.entries(COPILOT_TEMPLATES)) {
      const body = assemble("Asha", text);
      expect(checkReplyText(body, ctx()), category).toEqual({ ok: true });
    }
  });
});

describe("no personal identifiers in the draft", () => {
  it.each([
    ["an email", "Please write to asha.k@example.com for more."],
    ["a phone number", "Call us on 9876543210 any time."],
    ["a PAN", "Your PAN ABCDE1234F is on file."],
    ["a link with a token", "See https://example.com/x?token=abc"],
  ])("refuses a reply with %s", (_label, text) => {
    expect(identifierProblem(text)).not.toBeNull();
    expect(checkReplyText(text, ctx()).ok).toBe(false);
  });

  it("a model draft carrying an identifier is not used", async () => {
    const { callModel } = fakeModel(ok("Your statement was sent to asha.k@example.com."));
    const out = await generateCopilotDraft(input(), { callModel });
    expect(out.status === "draft" && out.source).toBe("template");
    if (out.status === "draft") {
      expect(out.body).not.toMatch(/@/);
      expect(out.note).toContain("personal identifier");
    }
  });

  it("the model is never sent the first name, and is called under the co-pilot purpose for the client", async () => {
    const { callModel, calls } = fakeModel(ok("We have your request."));
    await generateCopilotDraft(input(), { callModel });
    const draftCall = calls.find((c) => c.purpose === COPILOT_PURPOSE);
    expect(draftCall?.subject).toEqual({ type: "client", id: "client-1" });
    expect(JSON.stringify(calls.filter((c) => c.purpose === COPILOT_PURPOSE))).not.toContain("Asha");
  });
});
