import { describe, expect, it } from "vitest";

import { planShareDecision } from "@/lib/director/share";

import { createApprovalService } from "../service";
import { createDirectorReportAdapter, toCanonicalDirectorReport, type ReportApprovalRow, type ShareRow, type DigestRow } from "./director-report";

/**
 * Director report publication: a report link (it opens nothing until a person approves it) and the weekly digest draft (never sent by the system). One
 * canonical kind, two legacy rows, told apart by the id prefix (share: and digest:). The adapter calls the legacy functions and decides nothing.
 */
const NOW = new Date("2027-07-05T09:00:00Z");
const author = { id: "u-m", role: "MARKETING" } as const;
const marketing2 = { id: "u-m2", role: "MARKETING" } as const;
const admin = { id: "u-a", role: "ADMIN" } as const;
const rm = { id: "u-rm", role: "RM" } as const;

const shareRow = (over: Partial<ShareRow> = {}): ShareRow => ({ type: "share", id: "s1", label: "October board pack", periodFrom: new Date("2027-06-29T00:00:00Z"), periodTo: new Date("2027-07-05T00:00:00Z"), expiresAt: new Date("2027-07-12T09:00:00Z"), createdAt: NOW, createdById: "u-m", createdByName: "Maya", awaitingApproval: true, approvedAt: null, approvedById: null, revokedAt: null, decisionNote: null, fourEyes: false, ...over });
const digestRow = (over: Partial<DigestRow> = {}): DigestRow => ({ type: "digest", id: "d1", subject: "Marketing summary, 29 Jun to 5 Jul", bodyText: "DRAFT\nFunded customers: 8", weekStart: new Date("2027-06-28T00:00:00Z"), status: "DRAFT", approvedById: null, approvedAt: null, createdAt: NOW, ...over });

function world(initial: ReportApprovalRow[] = [shareRow(), digestRow()], opts: { fourEyes?: boolean } = {}) {
  const rows = new Map(initial.map((r) => [`${r.type}:${r.id}`, r]));
  const calls: string[] = [];
  const legacy = {
    async decideShare(i: { id: string; actorId: string; decision: "approve" | "decline"; confirmed?: boolean; reason?: string }) {
      calls.push(`share:${i.decision}:${i.actorId}`);
      const row = rows.get(`share:${i.id}`) as ShareRow | undefined;
      if (!row) return { ok: false as const, error: "That link no longer exists." };
      const plan = planShareDecision({ share: { awaitingApproval: row.awaitingApproval, revokedAt: row.revokedAt, expiresAt: row.expiresAt, createdById: row.createdById }, actorId: i.actorId, decision: i.decision, fourEyes: opts.fourEyes ?? false, confirmed: i.confirmed, reason: i.reason, now: NOW });
      if (!plan.ok) return plan;
      rows.set(`share:${i.id}`, plan.decision === "approve" ? { ...row, awaitingApproval: false, approvedAt: NOW, approvedById: i.actorId } : { ...row, awaitingApproval: false, revokedAt: NOW, decisionNote: plan.reason });
      return { ok: true as const, decision: plan.decision };
    },
    async approveDigest(id: string, userId: string) { calls.push(`digest:approve:${userId}`); const r = rows.get(`digest:${id}`) as DigestRow | undefined; if (!r || r.status !== "DRAFT") return false; rows.set(`digest:${id}`, { ...r, status: "APPROVED", approvedById: userId, approvedAt: NOW }); return true; },
    async discardDigest(id: string, userId: string) { calls.push(`digest:discard:${userId}`); const r = rows.get(`digest:${id}`) as DigestRow | undefined; if (!r || r.status !== "DRAFT") return false; rows.set(`digest:${id}`, { ...r, status: "DISCARDED" }); return true; },
  };
  const adapter = createDirectorReportAdapter({
    legacy, now: () => NOW,
    loadAwaiting: async () => [...rows.values()].filter((r) => (r.type === "share" ? r.awaitingApproval && !r.revokedAt : r.status === "DRAFT")),
    loadRequestedBy: async (userId) => [...rows.values()].filter((r): r is ShareRow => r.type === "share" && r.createdById === userId),
    loadRow: async (key) => rows.get(key) ?? null,
  });
  const svc = createApprovalService({ adapters: { "director-report": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined as never });
  return { rows, calls, adapter, svc };
}

describe("director report view", () => {
  it("a report link: pending is requested, approved is approved, declined is rejected with the reason, an unapproved link past its expiry is expired", () => {
    const st = (over: Partial<ShareRow>) => toCanonicalDirectorReport(shareRow(over), NOW)?.state;
    expect(st({})).toBe("requested");
    expect(st({ awaitingApproval: false, approvedAt: NOW, approvedById: "u-a" })).toBe("approved");
    expect(st({ awaitingApproval: false, revokedAt: NOW, decisionNote: "Numbers look off" })).toBe("rejected");
    expect(toCanonicalDirectorReport(shareRow({ revokedAt: NOW, awaitingApproval: false, decisionNote: "Numbers look off" }), NOW)!.decisionReason).toBe("Numbers look off");
    expect(st({ expiresAt: new Date("2027-07-05T09:00:00Z") })).toBe("expired");
    expect(st({ awaitingApproval: false, approvedAt: NOW, approvedById: "u-a", revokedAt: new Date("2027-07-06T00:00:00Z") })).toBe("approved");
  });
  it("a digest draft: draft is requested by the system, approved is approved, discarded is rejected", () => {
    const st = (over: Partial<DigestRow>) => toCanonicalDirectorReport(digestRow(over), NOW)?.state;
    expect(st({})).toBe("requested");
    expect(st({ status: "APPROVED", approvedAt: NOW, approvedById: "u-a" })).toBe("approved");
    expect(st({ status: "DISCARDED" })).toBe("rejected");
    expect(toCanonicalDirectorReport(digestRow(), NOW)!.requestedBy).toBeNull();
  });
  it("carries what a reviewer decides on: the period or subject, never a link or a token", () => {
    const share = toCanonicalDirectorReport(shareRow(), NOW)!;
    expect(share).toMatchObject({ ref: "director-report:share:s1", kind: "director-report", requestedBy: { id: "u-m", name: "Maya" }, autonomy: "L4", clientId: null });
    expect(share.evidence.find((e) => e.key === "report")!.value).toMatch(/29 Jun.*5 Jul/);
    const digest = toCanonicalDirectorReport(digestRow(), NOW)!;
    expect(digest.ref).toBe("director-report:digest:d1");
    expect(digest.evidence.find((e) => e.key === "report")!.value).toContain("Funded customers: 8");
    expect(JSON.stringify([share, digest])).not.toMatch(/token|https?:/i);
  });
  it("four eyes: a link's maker is named as the author only when the setting says so; a digest has no author", () => {
    expect(toCanonicalDirectorReport(shareRow({ fourEyes: true }), NOW)!.fourEyesAuthorId).toBe("u-m");
    expect(toCanonicalDirectorReport(shareRow({ fourEyes: false }), NOW)!.fourEyesAuthorId).toBeNull();
    expect(toCanonicalDirectorReport(digestRow(), NOW)!.fourEyesAuthorId).toBeNull();
  });
  it("is invisible outside Admin and Marketing", async () => {
    const w = world();
    expect(await w.adapter.get("share:s1", author, NOW)).not.toBeNull();
    expect(await w.adapter.get("digest:d1", admin, NOW)).not.toBeNull();
    expect(await w.adapter.get("share:s1", rm, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm, NOW, 10)).toEqual([]);
  });
  it("an id with no known prefix is not found, not an error", async () => {
    const w = world();
    expect(await w.adapter.get("s1", admin, NOW)).toBeNull();
    expect(await w.adapter.get("report:s1", admin, NOW)).toBeNull();
  });
});

describe("director report: the canonical path calls the legacy path and nothing else", () => {
  it("approves a link and the legacy row changes, with the reader's tick required", async () => {
    const w = world();
    expect(await w.svc.decide(admin, "director-report:share:s1", "approve", { params: {} })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    const r = await w.svc.decide(admin, "director-report:share:s1", "approve", { params: { confirmed: true } });
    expect(r).toMatchObject({ ok: true, state: "approved" });
    expect((w.rows.get("share:s1") as ShareRow)).toMatchObject({ awaitingApproval: false, approvedById: "u-a" });
    expect(w.calls).toEqual(["share:approve:u-a"]);
  });
  it("four eyes (the setting on): the maker cannot approve their own link; another person can", async () => {
    const w = world([shareRow({ fourEyes: true })], { fourEyes: true });
    expect(await w.svc.decide(author, "director-report:share:s1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(w.calls).toEqual([]);
    expect(await w.svc.decide(marketing2, "director-report:share:s1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: true });
  });
  it("four eyes off: the maker may approve their own link", async () => {
    const w = world();
    expect(await w.svc.decide(author, "director-report:share:s1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: true });
  });
  it("declines a link with a reason, which is stored and the link never opens", async () => {
    const w = world();
    expect(await w.svc.decide(admin, "director-report:share:s1", "reject", { params: {} })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(await w.svc.decide(admin, "director-report:share:s1", "reject", { reason: "Numbers look off", params: {} })).toMatchObject({ ok: true, state: "rejected" });
    expect((w.rows.get("share:s1") as ShareRow)).toMatchObject({ revokedAt: NOW, decisionNote: "Numbers look off" });
  });
  it("approves and discards a digest draft through the digest functions", async () => {
    const w = world();
    expect(await w.svc.decide(marketing2, "director-report:digest:d1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: true, state: "approved" });
    expect(w.calls).toEqual(["digest:approve:u-m2"]);
    const w2 = world();
    expect(await w2.svc.decide(marketing2, "director-report:digest:d1", "reject", { reason: "Not this week", params: {} })).toMatchObject({ ok: true, state: "rejected" });
    expect(w2.calls).toEqual(["digest:discard:u-m2"]);
  });
  it("a digest that is no longer a draft cannot be decided again", async () => {
    const w = world([digestRow({ status: "APPROVED", approvedById: "u-a", approvedAt: NOW })]);
    expect(await w.svc.decide(marketing2, "director-report:digest:d1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
  });
  it("a link that is already decided cannot be decided again", async () => {
    const w = world([shareRow({ awaitingApproval: false, approvedAt: NOW, approvedById: "u-a" })]);
    expect(await w.svc.decide(marketing2, "director-report:share:s1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
  });
  it("an RM can do nothing here", async () => {
    const w = world();
    expect(await w.svc.decide(rm, "director-report:share:s1", "approve", { params: { confirmed: true } })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(w.calls).toEqual([]);
  });
});

describe("director report: listing", () => {
  it("awaiting is pending links and draft digests; a maker sees their own links under their requests", async () => {
    const w = world();
    expect((await w.adapter.listAwaiting(admin, NOW, 10)).map((v) => v.ref).sort()).toEqual(["director-report:digest:d1", "director-report:share:s1"]);
    expect((await w.adapter.listRequestedBy(author, NOW, 10)).map((v) => v.ref)).toEqual(["director-report:share:s1"]);
  });
});
