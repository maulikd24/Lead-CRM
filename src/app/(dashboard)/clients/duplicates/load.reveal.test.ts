import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ suggestion: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mergeSuggestion: { findUnique: db.suggestion },
    client: { findUnique: db.client },
    position: { count: vi.fn().mockResolvedValue(0) },
    activity: { findFirst: vi.fn().mockResolvedValue(null) },
    leadIntake: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: vi.fn(async (id: string, role: string) => (role === "ADMIN" ? null : [id])) }));

import { loadComparison } from "@/lib/identity/merge-review/load";

const full = (id: string) => ({
  id, name: "Riya Sharma", clientCode: `CL-${id}`, mobile: "9876543210", email: "riya@example.com", pan: "ABCDE1234F", city: null, leadSource: null, createdAt: new Date("2026-01-01"), ckycRef: null, region: null,
  currentStage: { name: "KYC" }, assignedTo: { name: "Asha" }, kycRecord: null, fundingRecord: null, dealerIntroduction: null, accountHolders: [],
  _count: new Proxy({}, { get: () => 0 }),
});
const open = (owner: string) => ({
  id: "s1", status: "OPEN", score: 0.9, reasons: [],
  clientA: { id: "ca", isDeleted: false, mergedIntoId: null, assignedToId: owner },
  clientB: { id: "cb", isDeleted: false, mergedIntoId: null, assignedToId: owner },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.client.mockImplementation(async ({ where }: { where: { id: string } }) => full(where.id));
});

describe("the review page only offers a reveal to roles that can use it", () => {
  it("a Manager gets masked values and no reveal; the raw values are not in the payload", async () => {
    db.suggestion.mockResolvedValue(open("rm-1"));
    const res = await loadComparison({ id: "mgr", role: "MANAGER" }, "s1");
    expect(res).toMatchObject({ ok: true, data: { sides: { a: { canReveal: false }, b: { canReveal: false } } } });
    const json = JSON.stringify(res);
    for (const raw of ["9876543210", "riya@example.com", "ABCDE1234F"]) expect(json).not.toContain(raw);
    expect(json).toContain("••••••234F");
    expect(json).toContain("+91 ••••• ••210");
  });
  it("an Admin and the RM who owns both customers may reveal", async () => {
    db.suggestion.mockResolvedValue(open("rm-1"));
    expect(await loadComparison({ id: "ad", role: "ADMIN" }, "s1")).toMatchObject({ data: { sides: { a: { canReveal: true }, b: { canReveal: true } } } });
    expect(await loadComparison({ id: "rm-1", role: "RM" }, "s1")).toMatchObject({ data: { sides: { a: { canReveal: true }, b: { canReveal: true } } } });
  });
});
