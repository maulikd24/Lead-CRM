import { describe, expect, it } from "vitest";
import { actionHeadline, ageText, confidenceLabel, confirmationLabel, CONFIDENCE_NOTE, policyLines, SCORE_NOTE } from "./labels";

describe("evidence drawer wording", () => {
  it("always labels the score and the confidence as heuristics, never as probabilities", () => {
    expect(SCORE_NOTE).toMatch(/heuristic, not a probability/);
    expect(CONFIDENCE_NOTE).toMatch(/not a probability/);
    for (const c of ["low", "medium", "high"]) expect(confidenceLabel(c)).not.toMatch(/%/);
  });
  it("names the confirmation state of each evidence line", () => {
    expect(confirmationLabel("confirmed")).toBe("Confirmed");
    expect(confirmationLabel("ai_inferred")).toBe("AI-inferred, unconfirmed");
    expect(confirmationLabel("not_applicable")).toBe("Rule");
  });
  it("says No Action as nothing to do, and an abstain as no recommendation", () => {
    expect(actionHeadline({ result: "NO_ACTION", action: "No Action", programme: "x", topic: null })).toBe("Nothing to do right now");
    expect(actionHeadline({ result: "ABSTAIN", action: "No Action", programme: "x", topic: null })).toBe("No recommendation");
    expect(actionHeadline({ result: "RECOMMEND", action: "Call", programme: "PMS / AIF opportunity", topic: "PMS" })).toBe("Call: PMS");
  });
  it("describes freshness in days", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    expect(ageText("2026-10-08T10:00:00Z", now)).toBe("3 days ago");
    expect(ageText(null, now)).toBe("date unknown");
  });
  it("policy lines say plainly when something is blocked or needs approval", () => {
    const lines = policyLines({ consent: "blocked", consentPurpose: "MARKETING_COMMS", consentReason: "NO_RECORD", window: "closed", guardrails: "flagged", approvalNeeded: true, approver: "RM" });
    expect(lines.find((l) => l.label === "Consent")).toMatchObject({ ok: false, value: "Blocked for marketing comms" });
    expect(lines.find((l) => l.label === "WhatsApp window")?.ok).toBe(false);
    expect(lines.find((l) => l.label === "Approval")?.value).toMatch(/RM approves/);
  });
});
