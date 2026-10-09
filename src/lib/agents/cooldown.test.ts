import { describe, expect, it } from "vitest";
import { blockingProposalWhere, isCoolingDown, COOLDOWN_LOOKBACK_MS, SENT_COOLDOWN_MS, REJECTED_COOLDOWN_MS, BLOCKED_COOLDOWN_MS, type RecentProposal } from "./cooldown";

const NOW = new Date("2026-10-09T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 60 * 60 * 1000;
const D = 24 * H;
const p = (over: Partial<RecentProposal>): RecentProposal => ({ status: "SENT", createdAt: ago(D), decidedAt: ago(D), expiresAt: new Date(NOW.getTime() + 2 * D), ...over });

describe("isCoolingDown", () => {
  it("does not block a customer with no recent proposals", () => {
    expect(isCoolingDown([], NOW)).toBe(false);
  });
  it("documents the windows", () => {
    expect([SENT_COOLDOWN_MS, REJECTED_COOLDOWN_MS, BLOCKED_COOLDOWN_MS, COOLDOWN_LOOKBACK_MS]).toEqual([7 * D, 14 * D, D, 14 * D]);
  });
  it("blocks an unexpired DRAFT, not an expired one (boundary: expiresAt === now is expired)", () => {
    expect(isCoolingDown([p({ status: "DRAFT", decidedAt: null, expiresAt: new Date(NOW.getTime() + 1) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "DRAFT", decidedAt: null, expiresAt: NOW })], NOW)).toBe(false);
    expect(isCoolingDown([p({ status: "DRAFT", decidedAt: null, expiresAt: ago(H) })], NOW)).toBe(false);
  });
  it("blocks an APPROVED (in flight) draft regardless of age", () => {
    expect(isCoolingDown([p({ status: "APPROVED", createdAt: ago(10 * D), decidedAt: ago(10 * D), expiresAt: ago(8 * D) })], NOW)).toBe(true);
  });
  it("blocks for 7 days after a SEND, then releases", () => {
    expect(isCoolingDown([p({ status: "SENT", decidedAt: ago(7 * D - 1) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "SENT", decidedAt: ago(7 * D) })], NOW)).toBe(false);
    expect(isCoolingDown([p({ status: "SENT", decidedAt: ago(8 * D) })], NOW)).toBe(false);
  });
  it("blocks for 14 days after a REJECT, then releases", () => {
    expect(isCoolingDown([p({ status: "REJECTED", decidedAt: ago(13 * D) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "REJECTED", decidedAt: ago(14 * D - 1) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "REJECTED", decidedAt: ago(14 * D) })], NOW)).toBe(false);
  });
  it("blocks for 1 day after a BLOCKED row, then releases", () => {
    expect(isCoolingDown([p({ status: "BLOCKED", decidedAt: null, createdAt: ago(D - 1) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "BLOCKED", decidedAt: null, createdAt: ago(D) })], NOW)).toBe(false);
  });
  it("falls back to createdAt when decidedAt is missing", () => {
    expect(isCoolingDown([p({ status: "SENT", decidedAt: null, createdAt: ago(H) })], NOW)).toBe(true);
    expect(isCoolingDown([p({ status: "SENT", decidedAt: null, createdAt: ago(9 * D) })], NOW)).toBe(false);
  });
  it("never blocks on EXPIRED", () => {
    expect(isCoolingDown([p({ status: "EXPIRED", decidedAt: null, createdAt: ago(H) })], NOW)).toBe(false);
  });
  it("blocks if any one of several proposals blocks", () => {
    expect(isCoolingDown([p({ status: "EXPIRED" }), p({ status: "REJECTED", decidedAt: ago(2 * D) })], NOW)).toBe(true);
  });
});

describe("blockingProposalWhere (Prisma pre-filter mirrors isCoolingDown)", () => {
  const where = blockingProposalWhere(NOW) as { OR: { status: string; expiresAt?: unknown; OR?: unknown[] }[] };
  const cut = (ms: number) => new Date(NOW.getTime() - ms);
  const rule = (status: string) => where.OR.find((r) => r.status === status)!;
  it("blocks any APPROVED and unexpired DRAFTs", () => {
    expect(rule("APPROVED")).toEqual({ status: "APPROVED" });
    expect(rule("DRAFT")).toEqual({ status: "DRAFT", expiresAt: { gt: NOW } });
  });
  it.each([["SENT", 7 * D], ["REJECTED", 14 * D], ["BLOCKED", D]] as const)("%s uses decidedAt ?? createdAt with the same window as isCoolingDown", (status, ms) => {
    expect(rule(status).OR).toEqual([{ decidedAt: { gt: cut(ms) } }, { decidedAt: null, createdAt: { gt: cut(ms) } }]);
  });
});
