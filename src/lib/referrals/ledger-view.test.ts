import { describe, expect, it } from "vitest";

import { assembleLedger, rowActions, type RawEntry } from "./ledger-view";

let n = 0;
const D = (s: string) => new Date(s);
const raw = (over: Partial<RawEntry> & Pick<RawEntry, "kind">): RawEntry => ({ id: `e${++n}`, referrerId: "R", referralId: "ref1", eventType: "KYC_COMPLETE", ruleId: "rule1", refEntryId: null, amountPaise: 10000, periodMonth: "2027-01", flags: [], note: null, actorId: null, clawbackUntil: null, createdAt: D("2027-01-10T00:00:00Z"), ...over });
const ctx = { referrerNames: new Map([["R", "Asha Test"]]), referredCodes: new Map([["ref1", "CL-00042"]]), ruleNames: new Map([["rule1", "KYC bonus"]]), actorNames: new Map([["u1", "Fin Person"]]) };

describe("assembleLedger", () => {
  it("makes one row per reward with its state, names and the entries that followed it, oldest first", () => {
    const a = raw({ kind: "ACCRUED", flags: ["VELOCITY"] });
    const cleared = raw({ kind: "REVIEW_CLEARED", refEntryId: a.id, amountPaise: 0, note: "Checked", actorId: "u1", createdAt: D("2027-01-12T00:00:00Z") });
    const rows = assembleLedger([a, cleared], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a.id, referrerName: "Asha Test", referredCode: "CL-00042", ruleName: "KYC bonus", amountPaise: 10000, state: "ACCRUED", clawback: null });
    expect(rows[0].history.map((h) => [h.kind, h.by, h.note])).toEqual([["ACCRUED", null, null], ["REVIEW_CLEARED", "Fin Person", "Checked"]]);
  });
  it("shows a clawback on its reward: state Taken back, the clawback's own state, and the entry it needs for confirming or waiving", () => {
    const a = raw({ kind: "ACCRUED" });
    const c = raw({ kind: "CLAWBACK", refEntryId: a.id, amountPaise: -10000, periodMonth: "2027-02", flags: ["CLAWBACK_KYC_REVOKED"], note: "KYC was revoked on 2027-01-20", createdAt: D("2027-01-21T00:00:00Z") });
    const [row] = assembleLedger([a, c], ctx);
    expect(row.state).toBe("CLAWED_BACK");
    expect(row.clawback).toMatchObject({ id: c.id, state: "NEEDS_REVIEW", amountPaise: -10000, taken: false, flags: ["CLAWBACK_KYC_REVOKED"], note: "KYC was revoked on 2027-01-20" });
  });
  it("marks a clawback as taken once an approved statement recovered it", () => {
    const a = raw({ kind: "ACCRUED" });
    const c = raw({ kind: "CLAWBACK", refEntryId: a.id, amountPaise: -10000 });
    const [row] = assembleLedger([a, raw({ kind: "APPROVED", refEntryId: a.id }), raw({ kind: "PAID_MARKED", refEntryId: a.id }), c, raw({ kind: "APPROVED", refEntryId: c.id, amountPaise: -10000 })], ctx);
    expect(row.clawback).toMatchObject({ taken: true });
  });
  it("puts everything that waits for a person first (a flagged reward or a clawback awaiting review), then newest first", () => {
    const old = raw({ kind: "ACCRUED", createdAt: D("2027-01-01T00:00:00Z"), flags: ["VELOCITY"] });
    const newer = raw({ kind: "ACCRUED", createdAt: D("2027-01-09T00:00:00Z") });
    const newest = raw({ kind: "ACCRUED", createdAt: D("2027-01-10T00:00:00Z") });
    const clawedOld = raw({ kind: "ACCRUED", createdAt: D("2027-01-02T00:00:00Z") });
    const claw = raw({ kind: "CLAWBACK", refEntryId: clawedOld.id, amountPaise: -10000 });
    const confirmed = raw({ kind: "ACCRUED", createdAt: D("2027-01-03T00:00:00Z") });
    const confirmedClaw = raw({ kind: "CLAWBACK", refEntryId: confirmed.id, amountPaise: -10000 });
    const rows = assembleLedger([old, newer, newest, clawedOld, claw, confirmed, confirmedClaw, raw({ kind: "REVIEW_CLEARED", refEntryId: confirmedClaw.id, amountPaise: 0 })], ctx);
    expect(rows.map((r) => r.id).slice(0, 2).sort()).toEqual([old.id, clawedOld.id].sort());
    expect(rows.slice(2).map((r) => r.id)).toEqual([newest.id, newer.id, confirmed.id]);
  });
  it("falls back to plain words for a removed referrer, customer or rule", () => {
    const a = raw({ kind: "ACCRUED", referrerId: "gone", referralId: "gone", ruleId: "gone" });
    expect(assembleLedger([a], ctx)[0]).toMatchObject({ referrerName: "Former referrer", referredCode: null, ruleName: "Deleted rule" });
  });
});

describe("rowActions: what a person may do with a row", () => {
  const row = (state: string, clawback: null | { state: "NEEDS_REVIEW" | "CONFIRMED" | "WAIVED"; taken: boolean } = null) => ({ state, clawback }) as never;
  it("a reward in review can be cleared or reversed; a clean one only reversed", () => {
    expect(rowActions(row("NEEDS_REVIEW"))).toEqual(["clear", "reverse"]);
    expect(rowActions(row("ACCRUED"))).toEqual(["reverse"]);
  });
  it("an approved, paid, reversed reward has no actions", () => {
    for (const s of ["APPROVED", "PAID", "REVERSED"]) expect(rowActions(row(s))).toEqual([]);
  });
  it("a clawback awaiting review can be confirmed or waived; a confirmed one only waived; a waived or recovered one nothing", () => {
    expect(rowActions(row("CLAWED_BACK", { state: "NEEDS_REVIEW", taken: false }))).toEqual(["confirm_clawback", "waive_clawback"]);
    expect(rowActions(row("CLAWED_BACK", { state: "CONFIRMED", taken: false }))).toEqual(["waive_clawback"]);
    expect(rowActions(row("CLAWED_BACK", { state: "CONFIRMED", taken: true }))).toEqual([]);
    expect(rowActions(row("CLAWED_BACK", { state: "NEEDS_REVIEW", taken: true }))).toEqual(["confirm_clawback"]);
    expect(rowActions(row("PAID", { state: "WAIVED", taken: false }))).toEqual([]);
  });
});
