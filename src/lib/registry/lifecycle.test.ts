import { describe, expect, it } from "vitest";

import { decideReview, retire, submitForReview, suspend, type VersionMeta } from "./lifecycle";

const admin = (id: string) => ({ userId: id, role: "ADMIN" });
const v = (over: Partial<VersionMeta> = {}): VersionMeta => ({ id: "v2", productId: "p1", state: "DRAFT", createdById: "u-author", ...over });
const head = (over: Partial<{ status: "DRAFT" | "APPROVED" | "SUSPENDED" | "RETIRED"; activeVersionId: string | null }> = {}) => ({ id: "p1", status: "DRAFT" as const, activeVersionId: null, ...over });

describe("draft > review > approved flow", () => {
  it("lets the author submit a DRAFT for review, and nothing else", () => {
    expect(submitForReview(v(), admin("u-author"))).toEqual({ ok: true, state: "IN_REVIEW" });
    expect(submitForReview(v({ state: "IN_REVIEW" }), admin("u-author"))).toMatchObject({ ok: false });
    expect(submitForReview(v({ state: "APPROVED" }), admin("u-author"))).toMatchObject({ ok: false });
  });

  it("only an ADMIN may submit or decide (default deny)", () => {
    expect(submitForReview(v(), { userId: "u-author", role: "RM" })).toMatchObject({ ok: false });
    expect(decideReview(head(), v({ state: "IN_REVIEW" }), { userId: "u2", role: "MANAGER" }, "approve")).toMatchObject({ ok: false });
  });

  it("maker-checker: the author cannot approve their own version", () => {
    expect(decideReview(head(), v({ state: "IN_REVIEW" }), admin("u-author"), "approve")).toMatchObject({ ok: false, error: expect.stringContaining("author") });
  });

  it("approving makes the version the one in force, supersedes the previous active version and approves the product", () => {
    const r = decideReview(head({ status: "APPROVED", activeVersionId: "v1" }), v({ state: "IN_REVIEW" }), admin("u-checker"), "approve");
    expect(r).toEqual({ ok: true, versionState: "APPROVED", product: { status: "APPROVED", activeVersionId: "v2" }, supersede: "v1" });
  });

  it("approving a new version of a SUSPENDED product is the review that reinstates it", () => {
    const r = decideReview(head({ status: "SUSPENDED", activeVersionId: "v1" }), v({ state: "IN_REVIEW" }), admin("u-checker"), "approve");
    expect(r).toMatchObject({ ok: true, product: { status: "APPROVED", activeVersionId: "v2" } });
  });

  it("never approves anything on a RETIRED product", () => {
    expect(decideReview(head({ status: "RETIRED" }), v({ state: "IN_REVIEW" }), admin("u-checker"), "approve")).toMatchObject({ ok: false });
  });

  it("a rejection leaves the product untouched", () => {
    expect(decideReview(head({ status: "APPROVED", activeVersionId: "v1" }), v({ state: "IN_REVIEW" }), admin("u-checker"), "reject")).toEqual({ ok: true, versionState: "REJECTED", product: null, supersede: null });
  });

  it("only an IN_REVIEW version can be decided", () => {
    expect(decideReview(head(), v({ state: "DRAFT" }), admin("u-checker"), "approve")).toMatchObject({ ok: false });
    expect(decideReview(head(), v({ state: "APPROVED" }), admin("u-checker"), "approve")).toMatchObject({ ok: false });
  });
});

describe("suspend and retire", () => {
  it("suspend is immediate for an APPROVED product and needs a reason", () => {
    expect(suspend(head({ status: "APPROVED", activeVersionId: "v1" }), admin("u1"), "Regulator query")).toEqual({ ok: true, status: "SUSPENDED" });
    expect(suspend(head({ status: "APPROVED" }), admin("u1"), "  ")).toMatchObject({ ok: false });
  });
  it("only an approved product can be suspended", () => {
    expect(suspend(head({ status: "DRAFT" }), admin("u1"), "x")).toMatchObject({ ok: false });
    expect(suspend(head({ status: "RETIRED" }), admin("u1"), "x")).toMatchObject({ ok: false });
  });
  it("retire is final and needs a reason; a retired product cannot be retired again", () => {
    expect(retire(head({ status: "SUSPENDED" }), admin("u1"), "Closed to new money")).toEqual({ ok: true, status: "RETIRED" });
    expect(retire(head({ status: "RETIRED" }), admin("u1"), "again")).toMatchObject({ ok: false });
    expect(retire(head({ status: "APPROVED" }), admin("u1"), "")).toMatchObject({ ok: false });
  });
  it("non-admins can do neither", () => {
    expect(suspend(head({ status: "APPROVED" }), { userId: "u", role: "RM" }, "x")).toMatchObject({ ok: false });
    expect(retire(head({ status: "APPROVED" }), { userId: "u", role: "MARKETING" }, "x")).toMatchObject({ ok: false });
  });
});
