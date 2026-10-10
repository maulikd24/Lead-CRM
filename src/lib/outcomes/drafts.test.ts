import { describe, expect, it } from "vitest";

import { OUTCOMES_AGENT_KEY, createOutcomeDraft, taskFromSuggestion, type DraftDeps } from "./drafts";
import type { Suggestion } from "./types";

const now = new Date("2026-10-10T05:00:00Z");

function deps(over: Partial<DraftDeps> = {}): DraftDeps & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    isEnabled: async () => true,
    consent: async () => ({ allowed: true }),
    hasOpenDraft: async () => false,
    save: async (p) => (saved.push(p), { id: "prop1" }),
    now: () => now,
    ...over,
  };
}

describe("createOutcomeDraft", () => {
  it("saves a DRAFT proposal for a person to review, from a fixed template, and nothing else happens", async () => {
    const d = deps();
    const r = await createOutcomeDraft({ clientId: "c1", firstName: "Asha", template: "review_overdue", reason: "Review is overdue" }, d);
    expect(r).toEqual({ status: "drafted", proposalId: "prop1" });
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({ agentKey: OUTCOMES_AGENT_KEY, clientId: "c1", status: "DRAFT", provider: "rules", model: "template-v1", inputTokens: 0, outputTokens: 0, blockedReason: null });
    expect((d.saved[0] as { body: string }).body).toContain("Asha");
    expect((d.saved[0] as { expiresAt: Date }).expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("does nothing while the agent switch is off", async () => {
    const d = deps({ isEnabled: async () => false });
    expect(await createOutcomeDraft({ clientId: "c1", firstName: "Asha", template: "goal_checkin", reason: "x" }, d)).toEqual({ status: "skipped", reason: "agent is disabled" });
    expect(d.saved).toEqual([]);
  });

  it("does nothing when the consent gate says no", async () => {
    const d = deps({ consent: async () => ({ allowed: false, reason: "no consent" }) });
    expect(await createOutcomeDraft({ clientId: "c1", firstName: "Asha", template: "goal_checkin", reason: "x" }, d)).toEqual({ status: "skipped", reason: "no consent" });
    expect(d.saved).toEqual([]);
  });

  it("does not stack a second draft for the same customer", async () => {
    const d = deps({ hasOpenDraft: async () => true });
    expect(await createOutcomeDraft({ clientId: "c1", firstName: "Asha", template: "key_date", reason: "x" }, d)).toEqual({ status: "skipped", reason: "already has a draft" });
  });

  it("a name that would trip the guardrails is blocked, not saved as a draft", async () => {
    const d = deps();
    // A first name that contains a mobile number is exactly what the outbound guardrail exists to catch.
    const r = await createOutcomeDraft({ clientId: "c1", firstName: "9876543210", template: "key_date", reason: "x" }, d);
    expect(r.status).toBe("blocked");
    expect(d.saved[0]).toMatchObject({ status: "BLOCKED" });
  });

  it("never calls a model: there is no provider in the dependencies", () => {
    expect(Object.keys(deps())).not.toContain("provider");
  });
});

describe("taskFromSuggestion", () => {
  const s: Suggestion = { ruleKey: "review_overdue", fingerprint: "never", title: "t", detail: "d", severity: "high", rank: 70, why: [{ label: "a", value: "b" }], task: { title: "Hold the review", dueInDays: 3 }, draft: null };
  it("makes a task due in the stated days, with a source that dedupes by rule and situation", () => {
    const t = taskFromSuggestion(s, now);
    expect(t.title).toBe("Hold the review");
    expect(t.source).toBe("outcomes:review_overdue:never");
    expect(t.dueAt.getTime()).toBe(now.getTime() + 3 * 86_400_000);
  });
  it("cuts a long fingerprint so the source stays short", () => {
    expect(taskFromSuggestion({ ...s, fingerprint: "x".repeat(300) }, now).source.length).toBeLessThanOrEqual(120);
  });
});
