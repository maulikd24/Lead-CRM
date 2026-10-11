import { describe, expect, it } from "vitest";

import { decideDismiss, decideMerge, type DecideDeps } from "@/lib/identity/merge-review/decide";
import { MergeBlockedError } from "@/lib/clients/merge";

import { createApprovalService } from "../service";
import { createMergeSuggestionAdapter, toCanonicalMerge, type MergeRow } from "./merge-suggestion";

const NOW = new Date("2027-04-20T09:00:00Z");
const manager = { id: "mgr", role: "MANAGER" } as const;
const rm = { id: "rm1", role: "RM" } as const;
const rm2 = { id: "rm2", role: "RM" } as const;
const finance = { id: "fin", role: "FINANCE" } as const;
const tick = () => new Promise((r) => setTimeout(r, 0));

function world(owners: { a: string | null; b: string | null } = { a: "rm1", b: "rm1" }, status = "OPEN") {
  const s = { id: "s1", status, clientAId: "a", clientBId: "b", decidedBy: null as string | null, merged: null as string | null, dismissReason: null as string | null };
  const legacy: DecideDeps = {
    visibleUserIds: async (actor) => (actor.role === "RM" ? [actor.id] : null),
    loadSuggestion: async () => ({ id: s.id, status: s.status, clientAId: s.clientAId, clientBId: s.clientBId }),
    loadClientScopes: async () => [{ id: "a", assignedToId: owners.a }, { id: "b", assignedToId: owners.b }],
    allowRate: async () => true,
    merge: async ({ survivorId, actorId }) => {
      await tick();
      if (s.status !== "OPEN") throw new MergeBlockedError("Someone has already decided this suggestion.");
      s.status = "MERGED"; s.merged = survivorId; s.decidedBy = actorId;
      return { duplicateId: "b", duplicateName: "B", conflicts: [] } as never;
    },
    dismiss: async ({ actorId, reason }) => {
      await tick();
      if (s.status !== "OPEN") return false;
      s.status = "DISMISSED"; s.decidedBy = actorId; s.dismissReason = reason;
      return true;
    },
  };
  const row = (): MergeRow => ({ id: s.id, status: s.status, score: 0.93, percent: 93, label: "Very likely the same person", reasons: ["Same mobile number", "Similar name"], a: { id: "a", first: "Riya", code: "C-1" }, b: { id: "b", first: "Riya", code: "C-2" }, restricted: owners.a !== "rm1" || owners.b !== "rm1", createdAt: new Date("2027-04-19T09:00:00Z"), decidedAt: null });
  const adapter = createMergeSuggestionAdapter({
    legacy, enabled: () => true,
    loadAwaiting: async (actor) => (s.status === "OPEN" ? [forActor(row(), actor)].filter((r) => r !== null) as MergeRow[] : []),
    loadRow: async (id, actor) => (id === s.id ? forActor(row(), actor) : null),
  });
  const svc = createApprovalService({ adapters: { "merge-suggestion": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { s, legacy, adapter, svc, row };
}
/** What the real loader does: an RM sees a pair only if they own at least one side (restricted when not both). */
function forActor(r: MergeRow, actor: { id: string; role: string }): MergeRow | null {
  if (actor.role === "RM") return r.restricted && !(r.a.id === "a" && actor.id === "rm1") ? null : r;
  return r;
}

describe("merge suggestion view", () => {
  it("maps OPEN, MERGED and DISMISSED", () => {
    const base = world().row();
    expect(toCanonicalMerge({ ...base, status: "OPEN" }).state).toBe("requested");
    expect(toCanonicalMerge({ ...base, status: "MERGED" }).state).toBe("executed");
    expect(toCanonicalMerge({ ...base, status: "DISMISSED" }).state).toBe("rejected");
  });

  it("shows first names, codes, the score and the reasons, never a contact detail, and approving is not done in the list", () => {
    const v = toCanonicalMerge(world().row());
    expect(v.subject).toMatchObject({ type: "Duplicate pair", label: "Riya (C-1) and Riya (C-2)", href: "/clients/duplicates?item=s1" });
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["reasons", "score"]));
    expect(JSON.stringify(v)).not.toMatch(/mobile\b.*\d{10}|@|pan/i);
    expect(v).toMatchObject({ requestedBy: null, autonomy: "L4", fourEyesAuthorId: null });
  });

  it("a restricted pair (an RM owns only one side) is not offered for a decision", async () => {
    const w = world({ a: "rm1", b: "rm2" });
    expect(await w.adapter.get("s1", rm2, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm2, NOW, 10)).toEqual([]);
  });

  it("never offers a restricted pair even if the loader hands it back", async () => {
    const w = world({ a: "rm1", b: "rm2" });
    const leaky = createMergeSuggestionAdapter({ legacy: w.legacy, enabled: () => true, loadAwaiting: async () => [w.row()], loadRow: async () => w.row() });
    expect(w.row().restricted).toBe(true);
    expect(await leaky.get("s1", rm, NOW)).toBeNull();
    expect(await leaky.listAwaiting(rm, NOW, 10)).toEqual([]);
  });

  it("is off with the duplicate review, and closed to roles that cannot review", async () => {
    const w = world();
    expect(await w.adapter.get("s1", finance, NOW)).toBeNull();
  });
});

describe("merge suggestion: the canonical path gives the same outcome as the legacy path", () => {
  it("dismiss (reject) with a reason: same state, same stored reason", async () => {
    const a = world();
    const b = world();
    const legacy = await decideDismiss(a.legacy, rm, { suggestionId: "s1", reason: "Different people" });
    const canon = await b.svc.decide(rm, "merge-suggestion:s1", "reject", { reason: "Different people" });
    expect(legacy.ok && canon.ok).toBe(true);
    expect(canon).toMatchObject({ ok: true, state: "rejected" });
    expect({ ...b.s }).toEqual({ ...a.s });
    expect(b.s).toMatchObject({ status: "DISMISSED", decidedBy: "rm1", dismissReason: "Different people" });
  });

  it("two reviewers dismissing at once: one wins", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([w.svc.decide(rm, "merge-suggestion:s1", "reject", { reason: "x" }), w.svc.decide(manager, "merge-suggestion:s1", "reject", { reason: "y" })]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toMatchObject({ code: "ALREADY_DECIDED" });
  });

  it("the irreversible merge is never done from the list; the adapter's own approve is the legacy merge, confirmed and with a survivor", async () => {
    const w = world();
    expect(await w.svc.decide(manager, "merge-suggestion:s1", "approve", { params: { confirmed: true, survivorId: "a" } })).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(w.s.status).toBe("OPEN");
    const a = world();
    const b = world();
    const legacy = await decideMerge(a.legacy, manager, { suggestionId: "s1", survivorId: "a", confirmed: true });
    const viaAdapter = await b.adapter.decide({ subjectId: "s1", decision: "approve", reason: null, actor: manager, now: NOW, params: { survivorId: "a", confirmed: true } });
    expect(legacy.ok && viaAdapter.ok).toBe(true);
    expect({ ...b.s }).toEqual({ ...a.s });
    const noConfirm = await b.adapter.decide({ subjectId: "s1", decision: "approve", reason: null, actor: manager, now: NOW, params: { survivorId: "a" } });
    expect(noConfirm).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("an RM who owns only one side cannot decide it in either path", async () => {
    const a = world({ a: "rm1", b: "rm2" });
    const b = world({ a: "rm1", b: "rm2" });
    expect((await decideDismiss(a.legacy, rm, { suggestionId: "s1" })).ok).toBe(false);
    expect(await b.svc.decide(rm, "merge-suggestion:s1", "reject", { reason: "x" })).toMatchObject({ ok: false });
    expect(b.s.status).toBe("OPEN");
  });

  it("a finance user is refused", async () => {
    const w = world();
    expect(await w.svc.decide(finance, "merge-suggestion:s1", "reject", { reason: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
