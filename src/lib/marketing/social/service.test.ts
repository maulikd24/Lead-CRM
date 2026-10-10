import { beforeEach, describe, expect, it } from "vitest";

import { STANDARD_RISK_LINE } from "./compliance";
import { createFakePublisher } from "./publisher";
import { createSocialService, type EventRow, type PostRow, type PostStore } from "./service";

const GOOD = `Demat accounts explained.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`;
const NOW = new Date("2026-10-10T09:00:00Z");
const manager = { id: "u-m", role: "MANAGER" };
const approver = { id: "u-a", role: "ADMIN" };
const rm = { id: "u-rm", role: "RM" };

function memoryStore() {
  const posts = new Map<string, PostRow>();
  const events: EventRow[] = [];
  let n = 0;
  const store: PostStore = {
    async get(id) {
      return posts.get(id) ?? null;
    },
    async insert(data) {
      const row: PostRow = { scheduledFor: null, approvedById: null, approvedAt: null, reviewNote: null, createdAt: NOW, updatedAt: NOW, ...data, id: `p${++n}` };
      posts.set(row.id, row);
      return row;
    },
    async casUpdate(id, expected, data) {
      const row = posts.get(id);
      if (!row || row.status !== expected) return false;
      posts.set(id, { ...row, ...data });
      return true;
    },
    async remove(id) {
      posts.delete(id);
    },
    async addEvent(e) {
      events.push(e);
    },
    async list() {
      return [...posts.values()];
    },
  };
  return { store, posts, events };
}

let mem: ReturnType<typeof memoryStore>;
let publisher: ReturnType<typeof createFakePublisher>;
let svc: ReturnType<typeof createSocialService>;
beforeEach(() => {
  mem = memoryStore();
  publisher = createFakePublisher();
  svc = createSocialService({ store: mem.store, publisher, now: () => NOW });
});

describe("createDraft", () => {
  it("stores a DRAFT with the compliance snapshot and an audit event", async () => {
    const r = await svc.createDraft({ channel: "linkedin", title: "Demat", body: "Guaranteed returns!", actor: manager, source: "STAFF" });
    expect(r.ok).toBe(true);
    const post = [...mem.posts.values()][0];
    expect(post).toMatchObject({ status: "DRAFT", source: "STAFF", createdById: "u-m", channel: "linkedin" });
    expect((post.complianceIssues as { code: string }[]).map((i) => i.code)).toContain("RETURN_PROMISE");
    expect(mem.events[0]).toMatchObject({ action: "create", toStatus: "DRAFT", actorId: "u-m" });
  });

  it("saves a work in progress even when it does not pass yet (the gates are later)", async () => {
    expect((await svc.createDraft({ channel: "linkedin", body: "half", actor: manager, source: "STAFF" })).ok).toBe(true);
  });

  it("rejects an RM, an unknown channel and an empty body", async () => {
    expect((await svc.createDraft({ channel: "linkedin", body: "x", actor: rm, source: "STAFF" })).ok).toBe(false);
    expect((await svc.createDraft({ channel: "x", body: "x", actor: manager, source: "STAFF" })).ok).toBe(false);
    expect((await svc.createDraft({ channel: "linkedin", body: "  ", actor: manager, source: "STAFF" })).ok).toBe(false);
    expect(mem.posts.size).toBe(0);
  });

  it("records the brief for AI drafts", async () => {
    await svc.createDraft({ channel: "instagram", body: GOOD, actor: manager, source: "AI", brief: "explain demat" });
    expect([...mem.posts.values()][0]).toMatchObject({ source: "AI", brief: "explain demat" });
  });
});

describe("the whole workflow through the service", () => {
  it("submit, approve (confirmed), schedule; every step leaves an event and nothing is ever published", async () => {
    const created = await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" });
    const id = (created as { ok: true; post: PostRow }).post.id;
    expect((await svc.transition(id, "submit", { actor: manager })).ok).toBe(true);
    expect((await svc.transition(id, "approve", { actor: approver, confirmed: true })).ok).toBe(true);
    const when = new Date("2026-10-20T04:00:00Z");
    const done = await svc.transition(id, "schedule", { actor: manager, scheduledFor: when });
    expect(done.ok).toBe(true);
    expect(mem.posts.get(id)).toMatchObject({ status: "SCHEDULED", approvedById: "u-a", scheduledFor: when });
    expect(mem.events.map((e) => e.action)).toEqual(["create", "submit", "approve", "schedule"]);
    expect(publisher.published).toHaveLength(0);
  });

  it("refuses to approve without confirmation and leaves the post as it was", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    const r = await svc.transition(post.id, "approve", { actor: manager });
    expect(r.ok).toBe(false);
    expect(mem.posts.get(post.id)!.status).toBe("NEEDS_REVIEW");
  });

  it("FOUR EYES: the author cannot approve their own post; nothing is written and no event is left", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    const r = await svc.transition(post.id, "approve", { actor: manager, confirmed: true });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/someone other than|different/i);
    expect(mem.posts.get(post.id)).toMatchObject({ status: "NEEDS_REVIEW", approvedById: null });
    expect(mem.events.map((e) => e.action)).toEqual(["create", "submit"]);
    // another Admin or Manager can
    expect((await svc.transition(post.id, "approve", { actor: { id: "u-m2", role: "MANAGER" }, confirmed: true })).ok).toBe(true);
  });

  it("FOUR EYES: an AI-generated draft may be approved by any Admin or Manager, including whoever asked for it", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "AI", brief: "demat basics" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    expect((await svc.transition(post.id, "approve", { actor: manager, confirmed: true })).ok).toBe(true);
    expect(mem.posts.get(post.id)).toMatchObject({ status: "APPROVED", approvedById: "u-m" });
  });

  it("returns the compliance issues when a gate refuses", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: "Last chance!", actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    const r = await svc.transition(post.id, "submit", { actor: manager });
    expect(r).toMatchObject({ ok: false });
    expect((r as { issues?: { code: string }[] }).issues?.map((i) => i.code)).toContain("URGENCY");
  });

  it("scheduling asks the publisher interface for a dry-run only", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    await svc.transition(post.id, "approve", { actor: approver, confirmed: true });
    const blocked = createSocialService({ store: mem.store, publisher: { ...publisher, checkReady: () => ({ ok: false, reason: "channel not connected" }) }, now: () => NOW });
    const r = await blocked.transition(post.id, "schedule", { actor: manager, scheduledFor: new Date("2026-10-20T04:00:00Z") });
    expect(r).toMatchObject({ ok: false, error: "channel not connected" });
    expect(mem.posts.get(post.id)!.status).toBe("APPROVED");
  });

  it("a lost race (the post changed under us) is reported, not overwritten", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    const racing: PostStore = { ...mem.store, casUpdate: async () => false };
    const r = await createSocialService({ store: racing, publisher, now: () => NOW }).transition(post.id, "submit", { actor: manager });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/changed/i);
    expect(mem.events).toHaveLength(1);
  });

  it("an unknown post is a clean error", async () => {
    expect(await svc.transition("nope", "submit", { actor: manager })).toMatchObject({ ok: false });
  });
});

describe("editPost", () => {
  it("an edit to an approved post withdraws the approval and the schedule", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    await svc.transition(post.id, "approve", { actor: approver, confirmed: true });
    const r = await svc.editPost(post.id, { body: `${GOOD}\nOne more line.`, actor: manager });
    expect(r.ok).toBe(true);
    expect(mem.posts.get(post.id)).toMatchObject({ status: "DRAFT", approvedById: null, approvedAt: null, scheduledFor: null });
    expect(mem.events.at(-1)).toMatchObject({ action: "edit", fromStatus: "APPROVED", toStatus: "DRAFT" });
    expect(mem.events.at(-1)!.note).toMatch(/approval withdrawn/i);
  });

  it("refreshes the compliance snapshot with the new text", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: "Last chance", actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.editPost(post.id, { body: GOOD, actor: manager });
    expect(mem.posts.get(post.id)!.complianceIssues).toEqual([]);
  });

  it("refuses an RM and an empty body", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    expect((await svc.editPost(post.id, { body: "x", actor: rm })).ok).toBe(false);
    expect((await svc.editPost(post.id, { body: " ", actor: manager })).ok).toBe(false);
  });
});

describe("discardDraft", () => {
  it("removes a Draft only; anything further along must be edited back to Draft first", async () => {
    const { post } = (await svc.createDraft({ channel: "linkedin", body: GOOD, actor: manager, source: "STAFF" })) as { ok: true; post: PostRow };
    await svc.transition(post.id, "submit", { actor: manager });
    expect((await svc.discardDraft(post.id, manager)).ok).toBe(false);
    await svc.transition(post.id, "request_changes", { actor: manager, note: "again" });
    expect((await svc.discardDraft(post.id, manager)).ok).toBe(true);
    expect(mem.posts.size).toBe(0);
  });
});
