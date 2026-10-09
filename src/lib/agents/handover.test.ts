import { describe, expect, it } from "vitest";
import { recordHandover, type HandoverDeps } from "./handover";

function setup(over: Partial<HandoverDeps> & { open?: { id: string } | null; client?: Awaited<ReturnType<HandoverDeps["loadClient"]>> } = {}) {
  const log = { markers: 0, insights: [] as Parameters<HandoverDeps["createInsight"]>[0][], tasks: [] as Parameters<HandoverDeps["createTask"]>[0][], activities: [] as Parameters<HandoverDeps["logActivity"]>[0][], notes: [] as { userId: string; type: string; payload: Record<string, string> }[] };
  const seenKeys = new Set<string>();
  const deps: HandoverDeps = {
    findOpenHandover: async () => over.open ?? null,
    createMarker: async () => { log.markers += 1; return { id: "h1" }; },
    loadClient: async () => (over.client === undefined ? { id: "c1", name: "Riya", assignedToId: "rm1", managerId: "mgr1" } : over.client),
    createInsight: async (i) => { if (seenKeys.has(i.dedupeKey)) return "exists"; seenKeys.add(i.dedupeKey); log.insights.push(i); return "created"; },
    createTask: async (t) => { log.tasks.push(t); },
    logActivity: async (a) => { log.activities.push(a); },
    notify: async (userId, type, payload) => { log.notes.push({ userId, type, payload }); },
    fallbackRecipients: async () => ["adm1"],
    now: () => new Date("2026-10-09T10:00:00Z"),
    ...over,
  };
  return { deps, log };
}
const input = { clientId: "c1", triggerMessageId: "m1", reason: 'customer mentioned "fraud"' };

describe("recordHandover", () => {
  it("leaves a compliance trace: marker, OPEN complaint insight, task, activity and notifications to the RM and their manager", async () => {
    const { deps, log } = setup();
    expect(await recordHandover(deps, input)).toEqual({ proposalId: "h1", created: true });
    expect(log.markers).toBe(1);
    expect(log.insights).toHaveLength(1);
    expect(log.insights[0]).toMatchObject({ clientId: "c1", sourceRef: "m1" });
    expect(log.insights[0].dedupeKey).toMatch(/^[0-9a-f]{40}$/);
    expect(log.tasks[0]).toMatchObject({ clientId: "c1", assignedToId: "rm1", source: "wa_handover:c1" });
    expect(log.activities).toHaveLength(1);
    expect(log.activities[0].message).toMatch(/flagged for human handling/);
    expect(log.notes.map((n) => n.userId).sort()).toEqual(["mgr1", "rm1"]);
  });
  it("is a no-op when a handover is already open for this unanswered stretch", async () => {
    const { deps, log } = setup({ open: { id: "h0" } });
    expect(await recordHandover(deps, input)).toEqual({ proposalId: "h0", created: false });
    expect(log.markers + log.insights.length + log.tasks.length + log.activities.length + log.notes.length).toBe(0);
  });
  it("the insight is idempotent per trigger message", async () => {
    const { deps, log } = setup();
    await recordHandover(deps, input);
    await recordHandover(deps, input); // marker lookup is faked as empty, so the insight dedupe is what holds
    expect(log.insights).toHaveLength(1);
  });
  it("an unassigned customer goes to the fallback recipients and gets no task", async () => {
    const { deps, log } = setup({ client: { id: "c1", name: "Riya", assignedToId: null, managerId: null } });
    await recordHandover(deps, input);
    expect(log.tasks).toHaveLength(0);
    expect(log.notes.map((n) => n.userId)).toEqual(["adm1"]);
  });
  it("does nothing for a missing client", async () => {
    const { deps, log } = setup({ client: null });
    expect(await recordHandover(deps, input)).toEqual({ proposalId: "", created: false });
    expect(log.markers).toBe(0);
  });
});
