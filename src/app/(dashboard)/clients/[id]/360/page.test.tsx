import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";
import { canOpen360 } from "@/lib/clients/access";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
const db = vi.hoisted(() => ({ client: { findUnique: vi.fn() }, user: { findMany: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
// The rails fetch their own data; the page must not render (or fetch for) a customer the viewer may not open.
vi.mock("@/components/c360/rails", () => ({ C360Rail: () => null, C360Section: () => null, ConsentChip: () => null }));
vi.mock("@/components/c360/rail-views", () => ({ RailSkeleton: () => null, TimelineSkeleton: () => null }));

import Customer360Page from "./page";

const live = { id: "c1", name: "Riya Shah", clientCode: "C-001", assignedToId: "rm-1", isDeleted: false, mergedIntoId: null, status: "ACTIVE", currentStage: { name: "New Lead" }, assignedTo: { name: "RM Raj" }, kycRecord: null };
const open = (id = "c1", tab?: string) => Customer360Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab }) });

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_C360", "1");
  db.client.findUnique.mockResolvedValue(live);
  db.user.findMany.mockResolvedValue([]);
});

describe("Customer 360 page gate", () => {
  it("is a 404 while the flag is off, before the session or the database is read", async () => {
    vi.stubEnv("NEXT_PUBLIC_C360", "");
    asUser({ role: "ADMIN" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
    expect(db.client.findUnique).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => open())).toEqual({ kind: "redirect", url: "/login" });
    expect(db.client.findUnique).not.toHaveBeenCalled();
  });
  it("is a 404 for an unknown customer", async () => {
    asUser({ role: "ADMIN" });
    db.client.findUnique.mockResolvedValue(null);
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
  it("opens for the assigned RM", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
  });
  it("is a 404 (not a redirect) for an RM who is not the assigned one", async () => {
    asUser({ id: "rm-2", role: "RM" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
  it("is a 404 for a role with no desk (partner, dealer, finance)", async () => {
    for (const role of ["PARTNER", "DEALER", "FINANCE", "TEAM_MANAGER", "AFFILIATE", "DISTRIBUTOR"] as const) {
      asUser({ role });
      expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
    }
  });
  it("is a 404 for a merged customer, even for an admin", async () => {
    asUser({ role: "ADMIN" });
    db.client.findUnique.mockResolvedValue({ ...live, mergedIntoId: "c2" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
  it("shows an archived customer to an admin only", async () => {
    db.client.findUnique.mockResolvedValue({ ...live, isDeleted: true });
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
    asUser({ id: "rm-1", role: "RM" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
  it("lets a manager open a direct report's customer and the unassigned pool, but not another team's", async () => {
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
    db.client.findUnique.mockResolvedValue({ ...live, assignedToId: null });
    expect((await outcomeOf(() => open())).kind).toBe("returned");
    db.client.findUnique.mockResolvedValue({ ...live, assignedToId: "rm-9" });
    expect(await outcomeOf(() => open())).toEqual({ kind: "notFound" });
  });
});

describe("Customer 360 tabs in the URL", () => {
  it("opens on any known tab and on an unknown one (falls back to Overview)", async () => {
    asUser({ role: "ADMIN" });
    for (const tab of ["overview", "timeline", "portfolio", "consent", "tickets", "bogus", undefined]) expect((await outcomeOf(() => open("c1", tab))).kind).toBe("returned");
  });
  it("authorises before any tab is considered: a customer the viewer may not open is a 404 on every tab", async () => {
    asUser({ id: "rm-2", role: "RM" });
    for (const tab of ["overview", "timeline", "portfolio", "consent", "tickets"]) expect(await outcomeOf(() => open("c1", tab))).toEqual({ kind: "notFound" });
  });
});

describe("canOpen360 decision table", () => {
  type Row = { who: string; role: string; visible: string[] | null; client: { assignedToId: string | null; isDeleted: boolean; mergedIntoId: string | null }; expected: boolean };
  const c = (over: Partial<Row["client"]> = {}) => ({ assignedToId: "rm-1", isDeleted: false, mergedIntoId: null, ...over });
  const rows: Row[] = [
    { who: "admin, live, assigned", role: "ADMIN", visible: null, client: c(), expected: true },
    { who: "admin, live, unassigned", role: "ADMIN", visible: null, client: c({ assignedToId: null }), expected: true },
    { who: "admin, archived", role: "ADMIN", visible: null, client: c({ isDeleted: true }), expected: true },
    { who: "admin, merged", role: "ADMIN", visible: null, client: c({ mergedIntoId: "x" }), expected: false },
    { who: "admin, merged and archived", role: "ADMIN", visible: null, client: c({ mergedIntoId: "x", isDeleted: true }), expected: false },
    { who: "manager, report's client", role: "MANAGER", visible: ["mgr", "rm-1"], client: c(), expected: true },
    { who: "manager, unassigned", role: "MANAGER", visible: ["mgr", "rm-1"], client: c({ assignedToId: null }), expected: true },
    { who: "manager, other team", role: "MANAGER", visible: ["mgr", "rm-1"], client: c({ assignedToId: "rm-9" }), expected: false },
    { who: "manager, report's archived client", role: "MANAGER", visible: ["mgr", "rm-1"], client: c({ isDeleted: true }), expected: false },
    { who: "manager, merged", role: "MANAGER", visible: ["mgr", "rm-1"], client: c({ mergedIntoId: "x" }), expected: false },
    { who: "rm, own client", role: "RM", visible: ["rm-1"], client: c(), expected: true },
    { who: "rm, unassigned", role: "RM", visible: ["rm-1"], client: c({ assignedToId: null }), expected: false },
    { who: "rm, someone else's", role: "RM", visible: ["rm-1"], client: c({ assignedToId: "rm-2" }), expected: false },
    { who: "rm, own archived", role: "RM", visible: ["rm-1"], client: c({ isDeleted: true }), expected: false },
    { who: "dealer, anything", role: "DEALER", visible: ["d-1"], client: c(), expected: false },
    { who: "partner, anything", role: "PARTNER", visible: ["p-1"], client: c(), expected: false },
  ];
  it.each(rows)("$who -> $expected", ({ role, visible, client, expected }) => {
    expect(canOpen360(role, visible, client)).toBe(expected);
  });
});
