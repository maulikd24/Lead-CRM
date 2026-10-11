import { describe, expect, it } from "vitest";

import { STANDARD_RISK_LINE } from "@/lib/marketing/social/compliance";
import { createFakePublisher } from "@/lib/marketing/social/publisher";
import { createSocialService, type EventRow, type PostRow, type PostStore } from "@/lib/marketing/social/service";

import { createApprovalService } from "../service";
import { createSocialPostAdapter, toCanonicalSocialPost, type SocialRow } from "./social-post";

const GOOD = `Demat accounts explained.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`;
const NOW = new Date("2027-04-20T09:00:00Z");
const author = { id: "u-m", role: "MARKETING" } as const;
const marketing2 = { id: "u-m2", role: "MARKETING" } as const;
const admin = { id: "u-a", role: "ADMIN" } as const;
const rm = { id: "u-rm", role: "RM" } as const;

function world(post: Partial<PostRow> = {}) {
  const posts = new Map<string, PostRow>();
  const events: EventRow[] = [];
  const base: PostRow = { id: "p1", channel: "linkedin", title: "Demat", body: GOOD, status: "NEEDS_REVIEW", source: "STAFF", scheduledFor: null, createdById: author.id, approvedById: null, approvedAt: null, reviewNote: null, complianceIssues: [], brief: null, createdAt: NOW, updatedAt: NOW, ...post };
  posts.set(base.id, base);
  const store: PostStore = {
    async get(id) { return posts.get(id) ?? null; },
    async insert() { throw new Error("not used"); },
    async casUpdate(id, expected, data) { const r = posts.get(id); if (!r || r.status !== expected) return false; posts.set(id, { ...r, ...data }); return true; },
    async remove() {},
    async addEvent(e) { events.push(e); },
    async list() { return [...posts.values()]; },
  };
  const service = createSocialService({ store, publisher: createFakePublisher(), now: () => NOW });
  const rowOf = (): SocialRow => ({ ...posts.get("p1")!, submittedAt: NOW, authorName: "Maya" });
  const adapter = createSocialPostAdapter({ service, loadAwaiting: async () => [...posts.values()].filter((p) => p.status === "NEEDS_REVIEW").map((p) => ({ ...p, submittedAt: NOW, authorName: "Maya" })), loadRequestedBy: async (id) => [...posts.values()].filter((p) => p.createdById === id).map((p) => ({ ...p, submittedAt: NOW, authorName: "Maya" })), loadRow: async (id) => (posts.has(id) ? { ...posts.get(id)!, submittedAt: NOW, authorName: "Maya" } : null) });
  const svc = createApprovalService({ adapters: { "social-post": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { posts, events, service, adapter, svc, rowOf };
}
const snap = (w: ReturnType<typeof world>) => { const p = w.posts.get("p1")!; return { status: p.status, approvedById: p.approvedById, reviewNote: p.reviewNote, events: w.events.map((e) => `${e.action}:${e.fromStatus}>${e.toStatus}:${e.actorId}`) }; };

describe("social post view", () => {
  it("maps the review workflow onto canonical states", () => {
    const w = world();
    const st = (status: PostRow["status"], extra: Partial<SocialRow> = {}) => toCanonicalSocialPost({ ...w.rowOf(), status, ...extra }, NOW)?.state;
    expect(st("NEEDS_REVIEW")).toBe("requested");
    expect(st("APPROVED")).toBe("approved");
    expect(st("SCHEDULED")).toBe("approved");
    expect(st("DRAFT")).toBeUndefined(); // never submitted: there is no approval yet
    expect(st("DRAFT", { reviewNote: "Fix the disclosure" })).toBe("rejected"); // changes were requested
  });

  it("carries the text, the compliance state and four-eyes (not for AI drafts)", () => {
    const w = world();
    const v = toCanonicalSocialPost(w.rowOf(), NOW)!;
    expect(v).toMatchObject({ ref: "social-post:p1", kind: "social-post", requestedBy: { id: "u-m", name: "Maya" }, fourEyesAuthorId: "u-m", autonomy: "L3", clientId: null });
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["post", "compliance"]));
    expect(toCanonicalSocialPost({ ...w.rowOf(), source: "AI" }, NOW)!.fourEyesAuthorId).toBeNull();
    expect(v.evidence.find((e) => e.key === "channel")?.value).toBe("LinkedIn");
    expect(v.summary).toBe("Post for LinkedIn: Demat");
  });

  it("is invisible outside the marketing roles", async () => {
    const w = world();
    expect(await w.adapter.get("p1", author, NOW)).not.toBeNull();
    expect(await w.adapter.get("p1", admin, NOW)).not.toBeNull();
    expect(await w.adapter.get("p1", rm, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm, NOW, 10)).toEqual([]);
  });
});

describe("social post: the canonical path gives the same outcome as the legacy path", () => {
  async function both(opts: { post?: Partial<PostRow>; user: { id: string; role: "ADMIN" | "MARKETING" | "RM" }; decision: "approve" | "reject"; confirmed?: boolean; reason?: string }) {
    const a = world(opts.post);
    const b = world(opts.post);
    const legacy = opts.decision === "approve" ? await a.service.transition("p1", "approve", { actor: opts.user, confirmed: opts.confirmed }) : await a.service.transition("p1", "request_changes", { actor: opts.user, note: opts.reason });
    const canon = await b.svc.decide(opts.user, "social-post:p1", opts.decision, { reason: opts.reason, params: opts.confirmed ? { confirmed: true } : {} });
    return { a, b, legacy, canon };
  }

  it("a second person approves a staff post", async () => {
    const { a, b, legacy, canon } = await both({ user: admin, decision: "approve", confirmed: true });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b)).toMatchObject({ status: "APPROVED", approvedById: "u-a" });
  });

  it("four-eyes: the author cannot approve their own staff post, in either path", async () => {
    const { a, b, legacy, canon } = await both({ user: author, decision: "approve", confirmed: true });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("NEEDS_REVIEW");
  });

  it("an AI draft can be approved by the person who asked for it (there is no human author)", async () => {
    const { a, b, legacy, canon } = await both({ post: { source: "AI" }, user: author, decision: "approve", confirmed: true });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
  });

  it("without the confirmation tick nothing is approved", async () => {
    const { a, b, legacy, canon } = await both({ user: admin, decision: "approve" });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(snap(b)).toEqual(snap(a));
  });

  it("a post that no longer passes the compliance check is refused with the reasons", async () => {
    const { a, b, legacy, canon } = await both({ post: { body: "Guaranteed returns, buy now!" }, user: admin, decision: "approve", confirmed: true });
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "BLOCKED" });
    expect((canon as { reasons?: string[] }).reasons?.length).toBeGreaterThan(0);
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b).status).toBe("NEEDS_REVIEW");
  });

  it("reject = request changes, with the reviewer's note", async () => {
    const { a, b, canon } = await both({ user: admin, decision: "reject", reason: "Add the SEBI line" });
    expect(canon).toMatchObject({ ok: true, state: "rejected" });
    expect(snap(b)).toEqual(snap(a));
    expect(snap(b)).toMatchObject({ status: "DRAFT", reviewNote: "Add the SEBI line" });
  });

  it("an RM can do nothing here", async () => {
    const { a, b, canon } = await both({ user: rm, decision: "approve", confirmed: true });
    expect(canon).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(snap(b)).toEqual(snap(a));
  });

  it("two reviewers at once: one approval, one 'already decided'", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([w.svc.decide(admin, "social-post:p1", "approve", { params: { confirmed: true } }), w.svc.decide(marketing2, "social-post:p1", "approve", { params: { confirmed: true } })]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toMatchObject({ code: "ALREADY_DECIDED" });
    expect(w.posts.get("p1")!.status).toBe("APPROVED");
    expect(w.events.filter((e) => e.action === "approve")).toHaveLength(1);
  });

  it("a post that is already approved cannot be approved again", async () => {
    const { b, canon } = await both({ post: { status: "APPROVED", approvedById: "u-a" }, user: marketing2, decision: "approve", confirmed: true });
    expect(canon).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(snap(b).approvedById).toBe("u-a");
  });
});

describe("social post: listing", () => {
  it("awaiting is the posts in review; the author's own appear under their requests", async () => {
    const w = world();
    expect((await w.adapter.listAwaiting(admin, NOW, 10)).map((v) => v.id)).toEqual(["p1"]);
    expect((await w.adapter.listRequestedBy(author, NOW, 10)).map((v) => v.id)).toEqual(["p1"]);
  });
});
