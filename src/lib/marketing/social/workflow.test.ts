import { describe, expect, it } from "vitest";

import { STANDARD_RISK_LINE } from "./compliance";
import { MAX_SCHEDULE_AHEAD_DAYS, planTransition, type PostSnapshot, type TransitionInput } from "./workflow";

const NOW = new Date("2026-10-10T09:00:00Z");
const GOOD_BODY = `Demat accounts explained in three steps.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`;
const manager = { id: "u-manager", role: "MANAGER" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const rm = { id: "u-rm", role: "RM" as const };
const post = (over: Partial<PostSnapshot> = {}): PostSnapshot => ({ status: "DRAFT", channel: "linkedin", body: GOOD_BODY, source: "STAFF", scheduledFor: null, ...over });
const run = (input: Partial<TransitionInput> & Pick<TransitionInput, "action">) => planTransition({ post: post(), actor: manager, now: NOW, ...input });

describe("the status workflow Draft > Needs review > Approved > Scheduled", () => {
  it("walks the happy path one step at a time", () => {
    const submitted = run({ action: "submit" });
    expect(submitted).toMatchObject({ ok: true, next: { status: "NEEDS_REVIEW" }, event: { action: "submit", from: "DRAFT", to: "NEEDS_REVIEW" } });

    const approved = run({ action: "approve", post: post({ status: "NEEDS_REVIEW" }), confirmed: true });
    expect(approved).toMatchObject({ ok: true, next: { status: "APPROVED", approvedById: "u-manager", approvedAt: NOW } });

    const when = new Date("2026-10-15T04:00:00Z");
    const scheduled = run({ action: "schedule", post: post({ status: "APPROVED" }), scheduledFor: when });
    expect(scheduled).toMatchObject({ ok: true, next: { status: "SCHEDULED", scheduledFor: when }, event: { to: "SCHEDULED" } });
  });

  it("cannot skip a step", () => {
    expect(run({ action: "approve", post: post({ status: "DRAFT" }), confirmed: true })).toMatchObject({ ok: false });
    expect(run({ action: "schedule", post: post({ status: "NEEDS_REVIEW" }), scheduledFor: new Date("2026-10-15T04:00:00Z") })).toMatchObject({ ok: false });
    expect(run({ action: "submit", post: post({ status: "APPROVED" }) })).toMatchObject({ ok: false });
  });

  it("approval needs the explicit human confirmation", () => {
    const r = run({ action: "approve", post: post({ status: "NEEDS_REVIEW" }) });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/confirm/i);
  });

  it("only an Admin or Manager can act; an RM cannot do any of it", () => {
    for (const action of ["submit", "approve", "request_changes", "schedule", "unschedule", "edit"] as const) {
      expect(planTransition({ post: post({ status: "NEEDS_REVIEW" }), action, actor: rm, now: NOW, confirmed: true, note: "x", scheduledFor: new Date("2026-10-15T04:00:00Z") }), action).toMatchObject({ ok: false });
    }
    expect(planTransition({ post: post({ status: "NEEDS_REVIEW" }), action: "approve", actor: admin, now: NOW, confirmed: true })).toMatchObject({ ok: true });
  });
});

describe("compliance is enforced at every gate, not only when writing", () => {
  const bad = post({ body: "Guaranteed returns, last chance!" });
  it("cannot be submitted, approved or scheduled with an issue", () => {
    expect(run({ action: "submit", post: bad })).toMatchObject({ ok: false });
    expect(run({ action: "approve", post: { ...bad, status: "NEEDS_REVIEW" }, confirmed: true })).toMatchObject({ ok: false });
    expect(run({ action: "schedule", post: { ...bad, status: "APPROVED" }, scheduledFor: new Date("2026-10-15T04:00:00Z") })).toMatchObject({ ok: false });
  });
  it("the failure tells the person what to fix", () => {
    const r = run({ action: "submit", post: bad }) as { ok: false; error: string; issues?: { code: string }[] };
    expect(r.issues?.map((i) => i.code)).toContain("RETURN_PROMISE");
  });
});

describe("requesting changes", () => {
  it("returns the post to Draft with the reviewer's note, which is required", () => {
    expect(run({ action: "request_changes", post: post({ status: "NEEDS_REVIEW" }), note: "Soften the opening" })).toMatchObject({ ok: true, next: { status: "DRAFT", reviewNote: "Soften the opening" } });
    expect(run({ action: "request_changes", post: post({ status: "NEEDS_REVIEW" }), note: "  " })).toMatchObject({ ok: false });
    expect(run({ action: "request_changes", post: post({ status: "DRAFT" }), note: "x" })).toMatchObject({ ok: false });
  });
});

describe("scheduling records intent only", () => {
  const approved = post({ status: "APPROVED" });
  it("needs a future time, within a year", () => {
    expect(run({ action: "schedule", post: approved })).toMatchObject({ ok: false });
    expect(run({ action: "schedule", post: approved, scheduledFor: new Date("2026-10-09T00:00:00Z") })).toMatchObject({ ok: false });
    expect(run({ action: "schedule", post: approved, scheduledFor: new Date(NOW.getTime() + (MAX_SCHEDULE_AHEAD_DAYS + 1) * 86_400_000) })).toMatchObject({ ok: false });
    expect(run({ action: "schedule", post: approved, scheduledFor: new Date("invalid") })).toMatchObject({ ok: false });
  });
  it("can be undone, back to Approved", () => {
    expect(run({ action: "unschedule", post: post({ status: "SCHEDULED", scheduledFor: new Date("2026-10-15T04:00:00Z") }) })).toMatchObject({ ok: true, next: { status: "APPROVED", scheduledFor: null } });
    expect(run({ action: "unschedule", post: approved })).toMatchObject({ ok: false });
  });
  it("the plan has no 'publish' action at all", () => {
    expect(run({ action: "publish" as never })).toMatchObject({ ok: false });
  });
});

describe("editing", () => {
  it("withdraws an approval and any schedule: the edited text was never approved", () => {
    const r = run({ action: "edit", post: post({ status: "SCHEDULED", scheduledFor: new Date("2026-10-15T04:00:00Z") }) });
    expect(r).toMatchObject({ ok: true, next: { status: "DRAFT", approvedById: null, approvedAt: null, scheduledFor: null }, event: { from: "SCHEDULED", to: "DRAFT" } });
    expect((r as { event: { note?: string } }).event.note).toMatch(/approval withdrawn/i);
  });
  it("editing a draft keeps it a draft and writes no misleading note", () => {
    const r = run({ action: "edit", post: post() });
    expect(r).toMatchObject({ ok: true, next: { status: "DRAFT" } });
    expect((r as { event: { note?: string } }).event.note).toBeUndefined();
  });
  it("does not require compliance to save a work in progress", () => {
    expect(run({ action: "edit", post: post({ body: "half written" }) })).toMatchObject({ ok: true });
  });
});
