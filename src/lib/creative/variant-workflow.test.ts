import { describe, expect, it } from "vitest";

import { planVariantTransition, VARIANT_STATUS_LABEL, type VariantSnapshot } from "./variant-workflow";

const snap = (over: Partial<VariantSnapshot> = {}): VariantSnapshot => ({ status: "DRAFT", complianceStatus: "PASS", authorId: "u1", source: "STAFF", ...over });
const actor = (id: string, role = "MANAGER") => ({ id, role });

describe("variant workflow: Draft > Needs review > Approved", () => {
  it("labels", () => {
    expect(VARIANT_STATUS_LABEL).toEqual({ DRAFT: "Draft", NEEDS_REVIEW: "Needs review", APPROVED: "Approved" });
  });

  it("submit moves a passing draft to review", () => {
    const r = planVariantTransition({ variant: snap(), action: "submit", actor: actor("u1") });
    expect(r).toMatchObject({ ok: true, next: { status: "NEEDS_REVIEW" } });
  });

  it("submit is refused while any rule fails", () => {
    const r = planVariantTransition({ variant: snap({ complianceStatus: "FAIL" }), action: "submit", actor: actor("u1") });
    expect(r).toMatchObject({ ok: false });
  });

  it("approve needs a second person for staff-written copy (four eyes)", () => {
    const own = planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW" }), action: "approve", actor: actor("u1"), confirmed: true });
    expect(own).toMatchObject({ ok: false });
    const other = planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW" }), action: "approve", actor: actor("u2"), confirmed: true });
    expect(other).toMatchObject({ ok: true, next: { status: "APPROVED", approvedById: "u2" } });
  });

  it("an AI draft has no human author, so any Admin or Manager may approve it", () => {
    const r = planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW", source: "AI" }), action: "approve", actor: actor("u1"), confirmed: true });
    expect(r.ok).toBe(true);
  });

  it("approve needs the reader's tick and a passing check, on the text as it is now", () => {
    expect(planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW" }), action: "approve", actor: actor("u2") })).toMatchObject({ ok: false });
    expect(planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW", complianceStatus: "FAIL" }), action: "approve", actor: actor("u2"), confirmed: true })).toMatchObject({ ok: false });
  });

  it("request changes needs a note and returns it to draft", () => {
    expect(planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW" }), action: "request_changes", actor: actor("u2") })).toMatchObject({ ok: false });
    expect(planVariantTransition({ variant: snap({ status: "NEEDS_REVIEW" }), action: "request_changes", actor: actor("u2"), note: "Shorten it" })).toMatchObject({ ok: true, next: { status: "DRAFT", reviewNote: "Shorten it" } });
  });

  it("editing withdraws an approval", () => {
    const r = planVariantTransition({ variant: snap({ status: "APPROVED" }), action: "edit", actor: actor("u1") });
    expect(r).toMatchObject({ ok: true, next: { status: "DRAFT", approvedById: null, approvedAt: null } });
    expect(r.ok && r.event.note).toMatch(/withdrawn/i);
  });

  it("steps must follow in order", () => {
    expect(planVariantTransition({ variant: snap({ status: "DRAFT" }), action: "approve", actor: actor("u2"), confirmed: true })).toMatchObject({ ok: false });
    expect(planVariantTransition({ variant: snap({ status: "APPROVED" }), action: "submit", actor: actor("u1") })).toMatchObject({ ok: false });
  });

  it("only an Admin or Manager can work on creative", () => {
    expect(planVariantTransition({ variant: snap(), action: "submit", actor: actor("u1", "RM") })).toMatchObject({ ok: false });
  });

  it("there is no publish action", () => {
    expect(planVariantTransition({ variant: snap({ status: "APPROVED" }), action: "publish" as never, actor: actor("u1") })).toMatchObject({ ok: false });
  });
});
