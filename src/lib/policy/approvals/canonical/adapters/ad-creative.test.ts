import { describe, expect, it } from "vitest";

import { DEFAULT_BRAND_PROFILE } from "@/lib/creative/brand";
import { briefInputSchema, generateKit } from "@/lib/creative/kit";
import { createCreativeService, type BriefRow, type CreativeStore, type VariantRow } from "@/lib/creative/service";

import { createApprovalService } from "../service";
import { createAdCreativeAdapter, toCanonicalAdCreative, type CreativeApprovalRow } from "./ad-creative";

/**
 * Ad creative (four-eyes review of one channel variant). The legacy path is the creative service's `transition` (compliance re-run on the text as it is
 * now, author may not approve their own copy when the setting says so, compare-and-set on the status). The canonical path calls it and nothing else.
 */
const NOW = new Date("2027-07-05T09:00:00Z");
const author = { id: "u-m", role: "MARKETING" } as const;
const marketing2 = { id: "u-m2", role: "MARKETING" } as const;
const admin = { id: "u-a", role: "ADMIN" } as const;
const rm = { id: "u-rm", role: "RM" } as const;
const input = briefInputSchema.parse({ title: "Demat basics", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed"] });

function world(opts: { variant?: Partial<VariantRow>; fourEyes?: boolean } = {}) {
  const briefs = new Map<string, BriefRow>();
  const variants = new Map<string, VariantRow>();
  const events: { variantId: string; action: string; actorId: string; note?: string | null }[] = [];
  const kit = generateKit(input, DEFAULT_BRAND_PROFILE);
  const brief: BriefRow = { id: "b1", title: input.title, topic: input.topic, audience: input.audience, language: "en", hookType: input.hookType, usp: null, cta: null, master: kit.master, formats: ["meta_feed"], referenceIds: [], brandVersion: 1, createdById: author.id };
  briefs.set("b1", brief);
  const draft = kit.variants[0];
  variants.set("v1", { id: "v1", briefId: "b1", format: "meta_feed", language: "en", fields: draft.fields, disclaimer: draft.disclaimer, status: "NEEDS_REVIEW", source: "STAFF", complianceStatus: "PASS", complianceChecks: [], score: 80, verdict: "scale", authorId: author.id, approvedById: null, approvedAt: null, reviewNote: null, ...opts.variant });
  const store: CreativeStore = {
    async insertBrief() { throw new Error("not used"); }, async insertVariant() { throw new Error("not used"); },
    async getBrief(id) { return briefs.get(id) ?? null; }, async getVariant(id) { return variants.get(id) ?? null; },
    async variantsOf(id) { return [...variants.values()].filter((v) => v.briefId === id); },
    async casUpdateVariant(id, expected, data) { const v = variants.get(id); if (!v || v.status !== expected) return false; variants.set(id, { ...v, ...data }); return true; },
    async updateBriefReferences() {}, async addEvent(e) { events.push(e); return `e${events.length}`; }, async deleteBrief() {},
  };
  const service = createCreativeService({ store, getProfile: async () => ({ version: 1, profile: DEFAULT_BRAND_PROFILE }), loadReferenceCopies: async () => [], audit: async () => undefined, now: () => NOW, fourEyes: async () => opts.fourEyes ?? true });
  const rowOf = (): CreativeApprovalRow => ({ ...variants.get("v1")!, briefTitle: brief.title, submittedAt: NOW, authorName: "Maya", fourEyes: opts.fourEyes ?? true });
  const adapter = createAdCreativeAdapter({
    service,
    loadAwaiting: async () => [...variants.values()].filter((v) => v.status === "NEEDS_REVIEW").map((v) => ({ ...v, briefTitle: brief.title, submittedAt: NOW, authorName: "Maya", fourEyes: opts.fourEyes ?? true })),
    loadRequestedBy: async (userId) => [...variants.values()].filter((v) => v.authorId === userId).map((v) => ({ ...v, briefTitle: brief.title, submittedAt: NOW, authorName: "Maya", fourEyes: opts.fourEyes ?? true })),
    loadRow: async (id) => { const v = variants.get(id); return v ? { ...v, briefTitle: brief.title, submittedAt: NOW, authorName: "Maya", fourEyes: opts.fourEyes ?? true } : null; },
  });
  const svc = createApprovalService({ adapters: { "ad-creative": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined as never });
  return { variants, events, service, adapter, svc, rowOf };
}
const snap = (w: ReturnType<typeof world>) => { const v = w.variants.get("v1")!; return { status: v.status, approvedById: v.approvedById, reviewNote: v.reviewNote, events: w.events.map((e) => `${e.action}:${e.actorId}`) }; };

describe("ad creative view", () => {
  it("maps the review workflow onto canonical states", () => {
    const w = world();
    const st = (status: VariantRow["status"], extra: Partial<CreativeApprovalRow> = {}) => toCanonicalAdCreative({ ...w.rowOf(), status, ...extra })?.state;
    expect(st("NEEDS_REVIEW")).toBe("requested");
    expect(st("APPROVED")).toBe("approved");
    expect(st("DRAFT")).toBeUndefined();
    expect(st("DRAFT", { reviewNote: "Shorten the headline" })).toBe("rejected");
  });
  it("carries the copy, the checks and four eyes (not for AI drafts, and not when the setting is off)", () => {
    const w = world();
    const v = toCanonicalAdCreative(w.rowOf())!;
    expect(v).toMatchObject({ ref: "ad-creative:v1", kind: "ad-creative", requestedBy: { id: "u-m", name: "Maya" }, fourEyesAuthorId: "u-m", autonomy: "L3", clientId: null });
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["creative", "compliance", "channel"]));
    expect(v.evidence.find((e) => e.key === "channel")?.value).toBe("Meta feed ad (Facebook and Instagram)");
    expect(toCanonicalAdCreative({ ...w.rowOf(), source: "AI" })!.fourEyesAuthorId).toBeNull();
    expect(toCanonicalAdCreative({ ...w.rowOf(), fourEyes: false })!.fourEyesAuthorId).toBeNull();
  });
  it("shows the failing checks as the compliance evidence, never an invented pass", () => {
    const w = world();
    const failing = toCanonicalAdCreative({ ...w.rowOf(), complianceStatus: "FAIL", complianceChecks: [{ id: "advice", label: "No investment advice or recommendation", status: "fail", matched: "buy now", message: "Reads as advice." }] })!;
    expect(failing.evidence.find((e) => e.key === "compliance")!.value).toMatch(/advice/i);
    expect(w.rowOf().complianceStatus).toBe("PASS");
  });
  it("is invisible outside Admin and Marketing", async () => {
    const w = world();
    expect(await w.adapter.get("v1", author, NOW)).not.toBeNull();
    expect(await w.adapter.get("v1", admin, NOW)).not.toBeNull();
    expect(await w.adapter.get("v1", rm, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm, NOW, 10)).toEqual([]);
    expect(await w.adapter.listRequestedBy(rm, NOW, 10)).toEqual([]);
  });
});

describe("ad creative: the canonical path gives the same outcome as the legacy path", () => {
  async function both(opts: { variant?: Partial<VariantRow>; fourEyes?: boolean; user: { id: string; role: "ADMIN" | "MARKETING" | "RM" }; decision: "approve" | "reject"; confirmed?: boolean; reason?: string }) {
    const a = world({ variant: opts.variant, fourEyes: opts.fourEyes });
    const b = world({ variant: opts.variant, fourEyes: opts.fourEyes });
    const legacy = opts.decision === "approve" ? await a.service.transition("v1", "approve", opts.user, { confirmed: opts.confirmed }) : await a.service.transition("v1", "request_changes", opts.user, { note: opts.reason });
    const canon = await b.svc.decide(opts.user, "ad-creative:v1", opts.decision, { reason: opts.reason, params: opts.confirmed ? { confirmed: true } : {} });
    return { a, b, legacy, canon };
  }
  it("a second person approves staff copy", async () => {
    const { a, b, legacy, canon } = await both({ user: admin, decision: "approve", confirmed: true });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b)).toMatchObject({ status: "APPROVED", approvedById: "u-a" });
  });
  it("four eyes: the author cannot approve their own copy, in either path", async () => {
    const { a, b, legacy, canon } = await both({ user: author, decision: "approve", confirmed: true });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("NEEDS_REVIEW");
  });
  it("with four eyes switched off in the settings the author may approve their own copy, in either path", async () => {
    const { a, b, legacy, canon } = await both({ fourEyes: false, user: author, decision: "approve", confirmed: true });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
  });
  it("an AI draft can be approved by the person who asked for it", async () => {
    const { a, b, legacy, canon } = await both({ variant: { source: "AI" }, user: author, decision: "approve", confirmed: true });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
  });
  it("without the confirmation tick nothing is approved", async () => {
    const { a, b, legacy, canon } = await both({ user: admin, decision: "approve" });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(snap(b)).toEqual(snap(a));
  });
  it("copy that no longer passes the compliance check is refused, in either path", async () => {
    const w0 = world();
    const bad = { ...w0.rowOf().fields, headline: ["Guaranteed returns"] };
    const { a, b, legacy, canon } = await both({ variant: { fields: bad }, user: admin, decision: "approve", confirmed: true });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("NEEDS_REVIEW");
  });
  it("reject = request changes with the reviewer's note", async () => {
    const { a, b, canon } = await both({ user: admin, decision: "reject", reason: "Shorten the headline" });
    expect(canon).toMatchObject({ ok: true, state: "rejected" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b)).toMatchObject({ status: "DRAFT", reviewNote: "Shorten the headline" });
  });
  it("an RM can do nothing here", async () => {
    const { a, b, canon } = await both({ user: rm, decision: "approve", confirmed: true });
    expect(canon).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(snap(b)).toEqual(snap(a));
  });
  it("two reviewers at once: one approval, one 'already decided'", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([w.svc.decide(admin, "ad-creative:v1", "approve", { params: { confirmed: true } }), w.svc.decide(marketing2, "ad-creative:v1", "approve", { params: { confirmed: true } })]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toMatchObject({ code: "ALREADY_DECIDED" });
    expect(w.events.filter((e) => e.action === "approve")).toHaveLength(1);
  });
  it("an approved variant cannot be approved again", async () => {
    const { b, canon } = await both({ variant: { status: "APPROVED", approvedById: "u-a" }, user: marketing2, decision: "approve", confirmed: true });
    expect(canon).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(snap(b).approvedById).toBe("u-a");
  });
});

describe("ad creative: listing", () => {
  it("awaiting is the variants in review; the author's own appear under their requests", async () => {
    const w = world();
    expect((await w.adapter.listAwaiting(admin, NOW, 10)).map((v) => v.id)).toEqual(["v1"]);
    expect((await w.adapter.listRequestedBy(author, NOW, 10)).map((v) => v.id)).toEqual(["v1"]);
  });
});
