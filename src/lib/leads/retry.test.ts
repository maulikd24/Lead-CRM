import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, { id: string; status: string; attempts: number; receivedAt: Date; rawPayload: unknown }>();
const processLead = vi.fn();
const retryParked = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    leadIntake: {
      findMany: async () => [...rows.values()].filter((r) => r.status === "ERROR"),
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => { const r = rows.get(where.id)!; r.attempts += data.attempts.increment; return r; },
      updateMany: async ({ where, data }: { where: { id: string; status: string; attempts: number }; data: { attempts: { increment: number } } }) => {
        const r = rows.get(where.id);
        if (!r || r.status !== where.status || r.attempts !== where.attempts) return { count: 0 };
        r.attempts += data.attempts.increment;
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/lib/leads/config", () => ({ getLeadIntakeConfig: async () => ({ metaPageToken: "t" }) }));
vi.mock("@/lib/leads/ingest", () => ({ processLead: (...a: unknown[]) => processLead(...a) }));
vi.mock("@/lib/leads/meta", () => ({ retryParkedMetaLead: (...a: unknown[]) => retryParked(...a) }));

import { retryFailedLeads, retryLeadIntake, MAX_LEAD_ATTEMPTS } from "./retry";

const seed = (id: string, over: Partial<{ status: string; attempts: number }> = {}) =>
  rows.set(id, { id, status: "ERROR", attempts: 1, receivedAt: new Date(Date.now() - 3_600_000), rawPayload: { normalized: { name: "n" } }, ...over });

beforeEach(() => { rows.clear(); processLead.mockReset(); retryParked.mockReset(); });

describe("retryFailedLeads (behaviour unchanged)", () => {
  it("retries old ERROR rows, bumps attempts and counts recoveries", async () => {
    seed("a"); seed("b");
    processLead.mockResolvedValueOnce({ status: "created" }).mockResolvedValueOnce({ status: "error" });
    expect(await retryFailedLeads()).toEqual({ retried: 2, recovered: 1 });
    expect(rows.get("a")!.attempts).toBe(2);
  });
  it("returns zeros when there is nothing to retry", async () => expect(await retryFailedLeads()).toEqual({ retried: 0, recovered: 0 }));
});

describe("retryLeadIntake (one row, by an Admin)", () => {
  it("retries exactly one failed lead and reports recovered", async () => {
    seed("a"); seed("b");
    processLead.mockResolvedValue({ status: "created" });
    expect(await retryLeadIntake("a")).toEqual({ outcome: "recovered" });
    expect(processLead).toHaveBeenCalledTimes(1);
    expect(rows.get("b")!.attempts).toBe(1);
  });
  it("is capped at five attempts", async () => {
    seed("a", { attempts: MAX_LEAD_ATTEMPTS });
    expect(await retryLeadIntake("a")).toEqual({ outcome: "dead" });
    expect(processLead).not.toHaveBeenCalled();
  });
  it("refuses a lead that is not in error, and one that does not exist", async () => {
    seed("a", { status: "CREATED" });
    expect(await retryLeadIntake("a")).toEqual({ outcome: "not-failed" });
    expect(await retryLeadIntake("zzz")).toEqual({ outcome: "not-found" });
    expect(processLead).not.toHaveBeenCalled();
  });
  it("a double retry processes the lead once: the second sees it is no longer failed or loses the claim", async () => {
    seed("a");
    processLead.mockImplementation(async () => { rows.get("a")!.status = "CREATED"; return { status: "created" }; });
    const [x, y] = await Promise.all([retryLeadIntake("a"), retryLeadIntake("a")]);
    expect(processLead).toHaveBeenCalledTimes(1);
    const outcomes = [x.outcome, y.outcome];
    expect(outcomes).toContain("recovered");
    expect(outcomes.filter((o) => o === "recovered")).toHaveLength(1);
  });
  it("reports a failed retry as still failing", async () => {
    seed("a");
    processLead.mockResolvedValue({ status: "error" });
    expect(await retryLeadIntake("a")).toEqual({ outcome: "still-failing" });
  });
});
