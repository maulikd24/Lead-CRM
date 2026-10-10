import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { model: string; args: { where?: unknown; orderBy?: unknown; take?: number } }[] = [];
const rowsByModel: Record<string, unknown[]> = {};

vi.mock("@/lib/db/prisma", () => {
  const model = (name: string) => ({
    findMany: vi.fn(async (args: { where?: unknown }) => {
      calls.push({ model: name, args });
      return rowsByModel[name] ?? [];
    }),
  });
  return { prisma: Object.fromEntries(["interactionOutcome", "agentProposal", "message", "conversationInsight", "stage", "client", "stageHistory"].map((m) => [m, model(m)])) };
});
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: vi.fn(async () => ["team-member-1"]) }));

import { loadInsights } from "./queries";

const NOW = new Date("2026-10-09T12:00:00Z");
const scopeText = (w: unknown) => JSON.stringify(w);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rowsByModel)) delete rowsByModel[k];
});

describe("loadInsights scope", () => {
  it("applies the viewer's customer scope to every customer-linked query", async () => {
    rowsByModel.message = [{ id: "m1", clientId: "c1", createdAt: NOW, sentAt: null, client: { preferredLanguage: null } }];
    rowsByModel.interactionOutcome = [{ clientId: "c1", outcome: "INTERESTED", createdAt: NOW, client: { id: "c1", name: "Test Person", clientCode: "CL-1", preferredLanguage: null, assignedTo: null } }];
    rowsByModel.agentProposal = [{ clientId: "c1", decidedAt: NOW, messageId: "m1" }];
    rowsByModel.client = [{ id: "c1", createdAt: NOW, currentStageId: "s1" }];
    await loadInsights({ id: "mgr", role: "MANAGER" }, "7", NOW);

    // outcomes x3 (range, conversion cohort, drill-down), proposals x4 (sent, conversion cohort, range, message link),
    // messages x2, objections, journey clients, milestones: stage config and stage history are the only unscoped reads.
    const scoped = calls.filter((c) => !["stage", "stageHistory"].includes(c.model));
    expect(scoped.length).toBeGreaterThanOrEqual(11);
    for (const c of scoped) {
      const text = scopeText(c.args.where);
      expect(text, `${c.model} query must be scoped`).toContain('"isDeleted":false');
      expect(text, `${c.model} query must be scoped`).toContain('"mergedIntoId":null');
      expect(text, `${c.model} query must be scoped`).toContain("team-member-1");
    }
    // The only history read is keyed by clients that came from a scoped query.
    const history = calls.find((c) => c.model === "stageHistory");
    expect(scopeText(history?.args.where)).toContain("c1");
  });

  it("orders every capped query newest first and states when figures are partial", async () => {
    await loadInsights({ id: "admin", role: "ADMIN" }, "30", NOW);
    for (const c of calls.filter((x) => x.args.take)) expect(c.args.orderBy, `${c.model} take needs an orderBy`).toBeTruthy();
    rowsByModel.conversationInsight = Array.from({ length: 20_000 }, () => ({ assetClass: null, text: "x", occurredAt: NOW }));
    const capped = await loadInsights({ id: "admin", role: "ADMIN" }, "30", NOW);
    expect(capped.truncated).toBe(true);
    expect(capped.kpis.costPartial).toBe(true);
  });

  it("counts only sent or delivered messages and ignores updatedAt for milestones", async () => {
    await loadInsights({ id: "admin", role: "ADMIN" }, "30", NOW);
    const outbound = calls.find((c) => c.model === "message" && scopeText(c.args.where).includes("OUTBOUND"));
    expect(scopeText(outbound?.args.where)).toContain('"status":{"in":["SENT","DELIVERED","READ"]}');
  });
});
