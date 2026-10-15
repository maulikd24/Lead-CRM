import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const model = (name: string) => new Proxy({}, {
  get: (_t, method: string) => async (args: unknown) => {
    calls.push(`${name}.${method}`);
    if (name === "client" && method === "findUnique") return { assignedToId: "rm-1", isDeleted: false, mergedIntoId: null };
    if (name === "transaction" && method === "aggregate") return { _max: { transactionDate: new Date("2026-10-02T00:00:00Z") } };
    if (name === "transaction") return [{ id: "t1", transactionType: "BUY", transactionDate: new Date("2026-10-02"), grossAmount: 700, product: { name: "Secret Fund" } }];
    void args;
    return method === "findMany" ? [] : null;
  },
});
vi.mock("@/lib/db/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => null }));
vi.mock("@/lib/events/flag", () => ({ customerEventsEnabled: () => false }));

import { getCustomerTimeline } from "./reader";

describe("getCustomerTimeline and trades", () => {
  it("carries no trade row (product, type, amount): only a last trading date", async () => {
    const r = await getCustomerTimeline("c1", { viewer: { id: "a", role: "ADMIN" }, limit: 50 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).not.toContain("transaction.findMany");
    const json = JSON.stringify(r.items);
    for (const leak of ["Secret Fund", "BUY", "700", "Transaction\""]) expect(json).not.toContain(leak);
    const last = r.items.find((i) => i.title === "Last trading date");
    expect(last?.at).toBe("2026-10-02T00:00:00.000Z");
  });
});
