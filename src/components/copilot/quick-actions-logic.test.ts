import { describe, expect, it } from "vitest";

import { quickActionPlan, suggestedMessageHref } from "./quick-actions-logic";

const suggestion = {
  channel: "whatsapp" as const,
  templateId: "tpl-42",
  templateName: "Follow-up",
  variables: { name: "Asha" },
};

describe("quickActionPlan", () => {
  it("keeps Follow-up as the only primary action and moves the suggested message into More", () => {
    const plan = quickActionPlan("c1", suggestion);
    expect(plan.primary).toEqual({ kind: "followup", label: "Follow-up" });
    expect(plan.overflow).toEqual([
      { kind: "message", label: "Suggested message", href: suggestedMessageHref("c1", suggestion) },
    ]);
  });

  it("shows no More menu when there is no suggested message", () => {
    expect(quickActionPlan("c1", null).overflow).toEqual([]);
  });

  it("never repeats the primary action inside the More menu", () => {
    const plan = quickActionPlan("c1", suggestion);
    const overflowKinds = plan.overflow.map((a) => a.kind);
    expect(overflowKinds).not.toContain(plan.primary.kind);
    expect(new Set(overflowKinds).size).toBe(overflowKinds.length);
  });
});

describe("suggestedMessageHref", () => {
  it("keeps the client page, channel, template and encoded variables the row always linked to", () => {
    const href = suggestedMessageHref("c1", suggestion);
    expect(href).toBe(
      `/clients/c1?suggestChannel=whatsapp&suggestTemplateId=tpl-42&suggestVars=${encodeURIComponent('{"name":"Asha"}')}#send-message`,
    );
  });
});
