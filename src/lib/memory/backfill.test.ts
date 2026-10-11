import { describe, expect, it } from "vitest";

import { legacyProposals } from "./backfill";
import { initialConfirmation, validateProposal } from "./rules";

const NOW = new Date("2027-06-30T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const base = { clientId: "c1", preferredLanguage: null as string | null, acceptances: [] as { id: string; assetClass: string; level: "HIGH" | "MEDIUM" | "LOW"; isManual: boolean; updatedAt: Date }[], dismissals: [] as { id: string; ruleKey: string; dismissedById: string | null; dismissedAt: Date; snoozeUntil: Date }[] };

describe("legacyProposals: backfill from what already exists (spec M1), human and system facts only", () => {
  it("a stored preferred language becomes a confirmed preference from a system record", () => {
    const [p] = legacyProposals({ ...base, preferredLanguage: " Hindi " }, NOW);
    expect(p).toMatchObject({ class: "PREFERENCE", key: "preference:language", sourceType: "system" });
    expect(p.value).toEqual({ text: "Hindi" });
    expect(initialConfirmation(p.sourceType, p.class)).toBe("CONFIRMED");
    expect(validateProposal(p)).toEqual({ ok: true });
  });
  it("nothing for an empty language", () => {
    expect(legacyProposals({ ...base, preferredLanguage: "  " }, NOW)).toEqual([]);
  });
  it("only MANUAL acceptance levels count (an automatic level is a guess, not a statement): LOW is a stance, HIGH an interest, MEDIUM says nothing", () => {
    const out = legacyProposals(
      { ...base, acceptances: [
        { id: "a1", assetClass: "PMS", level: "LOW", isManual: true, updatedAt: day(-3) },
        { id: "a2", assetClass: "AIF", level: "HIGH", isManual: true, updatedAt: day(-4) },
        { id: "a3", assetClass: "Bonds", level: "MEDIUM", isManual: true, updatedAt: day(-4) },
        { id: "a4", assetClass: "Tax Planning", level: "LOW", isManual: false, updatedAt: day(-4) },
      ] },
      NOW,
    );
    expect(out.map((p) => [p.class, p.key])).toEqual([["PRODUCT_STANCE", "product_stance:PMS"], ["INTEREST", "interest:AIF"]]);
    for (const p of out) expect(validateProposal(p)).toEqual({ ok: true });
  });
  it("an active snooze becomes a do-not-do that expires when the snooze ends; a lapsed one is ignored", () => {
    const out = legacyProposals({ ...base, dismissals: [{ id: "d1", ruleKey: "idle_cash", dismissedById: "u1", dismissedAt: day(-2), snoozeUntil: day(20) }, { id: "d2", ruleKey: "old_rule", dismissedById: null, dismissedAt: day(-90), snoozeUntil: day(-5) }] }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ class: "DO_NOT_DO", key: "do_not_do:suggestion:idle_cash", sourceType: "rm_entry", sourceRef: "user:u1" });
    expect(out[0].freshUntil?.toISOString()).toBe(day(20).toISOString());
  });
  it("a dismissal with no recorded person is attributed to the system record, never to an invented user", () => {
    const [p] = legacyProposals({ ...base, dismissals: [{ id: "d1", ruleKey: "x", dismissedById: null, dismissedAt: day(-2), snoozeUntil: day(5) }] }, NOW);
    expect(p).toMatchObject({ sourceType: "system" });
    expect(p.sourceRef.startsWith("import:")).toBe(true);
  });
  it("never produces an AI-sourced item", () => {
    const out = legacyProposals({ ...base, preferredLanguage: "Hindi", acceptances: [{ id: "a1", assetClass: "PMS", level: "LOW", isManual: true, updatedAt: day(-3) }], dismissals: [{ id: "d1", ruleKey: "x", dismissedById: "u1", dismissedAt: day(-2), snoozeUntil: day(5) }] }, NOW);
    for (const p of out) expect(["conversation_ai", "call_ai"]).not.toContain(p.sourceType);
  });
});
