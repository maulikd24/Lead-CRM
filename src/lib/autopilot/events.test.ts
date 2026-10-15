import { describe, expect, it } from "vitest";

import { emitWith, type EventStore, type NewEventRow } from "@/lib/events/emit";
import { eventIdFor } from "@/lib/events/envelope";
import { eventDef } from "@/lib/events/registry";
import { buildAgentRun, buildAutopilotApplied, buildAutopilotApplyFailed, buildAutopilotApproved, buildAutopilotDenied, buildAutopilotRecommended } from "@/lib/events/producers";

const NOW = new Date("2027-07-01T10:00:00Z");
const RUN = "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a11";
async function store(input: Parameters<typeof emitWith>[1] | null) {
  expect(input).not.toBeNull();
  const rows: NewEventRow[] = [];
  const s: EventStore = { async insert(r) { rows.push(r); return "inserted"; }, async recordFailure() {} };
  const out = await emitWith({ store: s, enabled: () => true, now: () => NOW }, input!);
  return { out, row: rows[0] };
}

describe("Autopilot events: agent and recommendation facts carry the audit run's correlation id", () => {
  it("registers the new types as customerless INTERNAL facts", () => {
    for (const t of ["campaign.autopilot.denied", "campaign.autopilot.apply.failed"]) expect(eventDef(t), t).toMatchObject({ dataClass: "INTERNAL", customerRequired: false });
  });

  it("every builder is stored by the registry, and the recommendation chain shares ONE correlation id from the run to the applied action", async () => {
    const rec = buildAutopilotRecommended({ recId: "BD1:m1", correlationId: RUN, auditRunId: "run1", actionKind: "pause_campaign", severity: "high", occurredAt: NOW });
    const approved = buildAutopilotApproved({ recId: "BD1:m1", correlationId: RUN, actorUserId: "u1", occurredAt: NOW });
    const applied = buildAutopilotApplied({ recId: "BD1:m1", correlationId: RUN, actorUserId: "u1", occurredAt: NOW });
    for (const e of [rec, approved, applied]) expect((await store(e)).out.status).toBe("stored");
    expect([rec, approved, applied].map((e) => e.correlationId)).toEqual([RUN, RUN, RUN]);
    // The cause of each is the event before it, so an Action Ledger can walk the chain without a lookup.
    expect(rec.causationId ?? null).toBeNull();
    expect(approved.causationId).toBe(eventIdFor(rec.source, rec.dedupeKey));
    expect(applied.causationId).toBe(eventIdFor(approved.source, approved.dedupeKey));
  });

  it("a denial and a failed apply name their cause too", async () => {
    const rec = buildAutopilotRecommended({ recId: "R:1", correlationId: RUN });
    const approved = buildAutopilotApproved({ recId: "R:1", correlationId: RUN, actorUserId: "u1" });
    const denied = buildAutopilotDenied({ recId: "R:1", correlationId: RUN, actorUserId: "u1", reasonCode: "not_relevant" });
    const failed = buildAutopilotApplyFailed({ recId: "R:1", correlationId: RUN, actorUserId: "u1", errorClass: "provider_refused" });
    expect(denied.causationId).toBe(eventIdFor(rec.source, rec.dedupeKey));
    expect(failed.causationId).toBe(eventIdFor(approved.source, approved.dedupeKey));
    for (const e of [denied, failed]) expect((await store(e)).out.status).toBe("stored");
  });

  it("the same fact emitted twice stores once (the dedupe key comes from the proposal, not from a random id)", () => {
    const a = buildAutopilotRecommended({ recId: "R:1", correlationId: RUN });
    const b = buildAutopilotRecommended({ recId: "R:1", correlationId: RUN });
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it("agent run events: started, completed, failed and blocked, keyed by the run", async () => {
    for (const kind of ["started", "completed", "failed", "blocked"] as const) {
      const e = buildAgentRun(kind, { agentKey: "ad_autopilot", runId: "run1", correlationId: RUN, outcome: "ok", errorClass: "boom", reasonCode: "kill_switch" });
      expect((await store(e)).out.status, kind).toBe("stored");
      expect(e.type).toBe(`agent.run.${kind}`);
      expect(e.correlationId).toBe(RUN);
      expect(e.actor).toEqual({ type: "agent", id: "ad_autopilot" });
    }
  });

  it("metadata is ids, enums and counts: no text from a person, no customer detail", async () => {
    const { row } = await store(buildAutopilotDenied({ recId: "R:1", correlationId: RUN, actorUserId: "u1", reasonCode: "other", note: "call Riya on 9876543210" } as never));
    expect(JSON.stringify(row.metadata)).not.toContain("9876543210");
  });
});
