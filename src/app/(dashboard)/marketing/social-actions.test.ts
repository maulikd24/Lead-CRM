import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/provider", () => ({ getProvider: vi.fn() }));

// The workflow and the service are real; only the store is an in-memory fake.
const mem = vi.hoisted(() => ({ posts: new Map<string, Record<string, unknown>>(), events: [] as unknown[] }));
vi.mock("@/lib/marketing/social/store", async () => {
  const { createSocialService } = await import("@/lib/marketing/social/service");
  const { createFakePublisher } = await import("@/lib/marketing/social/publisher");
  let n = 0;
  const store = {
    get: async (id: string) => (mem.posts.get(id) as never) ?? null,
    insert: async (data: Record<string, unknown>) => {
      const row = { scheduledFor: null, approvedById: null, approvedAt: null, reviewNote: null, createdAt: new Date(), updatedAt: new Date(), ...data, id: `p${++n}` };
      mem.posts.set(row.id, row);
      return row as never;
    },
    casUpdate: async (id: string, expected: string, data: Record<string, unknown>) => {
      const row = mem.posts.get(id);
      if (!row || row.status !== expected) return false;
      mem.posts.set(id, { ...row, ...data });
      return true;
    },
    remove: async (id: string) => void mem.posts.delete(id),
    addEvent: async (e: unknown) => void mem.events.push(e),
    list: async () => [...mem.posts.values()] as never[],
  };
  return { socialService: () => createSocialService({ store, publisher: createFakePublisher(), now: () => new Date("2026-10-10T09:00:00Z") }) };
});

import { STANDARD_RISK_LINE } from "@/lib/marketing/social/compliance";
import { createDraftAction, transitionAction } from "./social-actions";

const GOOD = `Demat accounts explained.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`;

async function postInReviewBy(author: { id: string; role: "MANAGER" | "ADMIN" }) {
  asUser(author);
  const created = await createDraftAction({ channel: "linkedin", body: GOOD });
  if (!created.ok || !created.id) throw new Error("setup failed");
  expect((await transitionAction(created.id, "submit")).ok).toBe(true);
  return created.id;
}

beforeEach(() => {
  resetSession();
  mem.posts.clear();
  mem.events.length = 0;
  vi.stubEnv("SOCIAL_DRAFTS_ENABLED", "1");
});

describe("four-eyes approval of a social post, through the server action", () => {
  it("blocks the author from approving their own post, says why, and leaves the post in review", async () => {
    const id = await postInReviewBy({ id: "m1", role: "MANAGER" });
    const r = await outcomeOf(() => transitionAction(id, "approve", { confirmed: true }));
    expect(r).toMatchObject({ kind: "returned", value: { ok: false } });
    expect((r as { value: { error: string } }).value.error).toMatch(/someone other than the author/i);
    expect(mem.posts.get(id)).toMatchObject({ status: "NEEDS_REVIEW", approvedById: null });
  });
  it("blocks an Admin who wrote the post just the same", async () => {
    const id = await postInReviewBy({ id: "a1", role: "ADMIN" });
    expect(await outcomeOf(() => transitionAction(id, "approve", { confirmed: true }))).toMatchObject({ value: { ok: false } });
  });
  it("lets a different Manager or Admin approve it, recording who", async () => {
    const id = await postInReviewBy({ id: "m1", role: "MANAGER" });
    asUser({ id: "m2", role: "MANAGER" });
    expect(await outcomeOf(() => transitionAction(id, "approve", { confirmed: true }))).toMatchObject({ value: { ok: true } });
    expect(mem.posts.get(id)).toMatchObject({ status: "APPROVED", approvedById: "m2" });
  });
  it("still needs the signed-in Admin or Manager: an RM and a signed-out caller never get that far", async () => {
    const id = await postInReviewBy({ id: "m1", role: "MANAGER" });
    asAnonymous();
    expect(await outcomeOf(() => transitionAction(id, "approve", { confirmed: true }))).toEqual({ kind: "redirect", url: "/login" });
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => transitionAction(id, "approve", { confirmed: true }))).kind).toBe("redirect");
    expect(mem.posts.get(id)).toMatchObject({ status: "NEEDS_REVIEW" });
  });
});
