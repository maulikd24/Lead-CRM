import { describe, expect, it } from "vitest";

import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";
import { recordSignoff, type PilotDb } from "@/lib/agents/pilot-service";

import { createApprovalService } from "../service";
import { createAiPilotSignoffAdapter, toCanonicalSignoff, type PilotFacts } from "./ai-pilot-signoff";

const NOW = new Date("2027-04-20T09:00:00Z");
const admin = { id: "adm", role: "ADMIN" } as const;
const admin2 = { id: "adm2", role: "ADMIN" } as const;
const manager = { id: "mgr", role: "MANAGER" } as const;

type Row = { id: string; statementVersion: string; acknowledgedById: string; acknowledgedAt: Date };
/** signatures: how many of the two required signatures are already in (first by "adm0", the compliance reviewer; second by "adm1"). */
function world(over: { listed?: number; signatures?: 0 | 1 | 2; oldVersion?: boolean } = {}) {
  const log: { audits: string[]; signoffs: { by: string; version: string }[] } = { audits: [], signoffs: [] };
  const v = over.oldVersion ? "2025-old" : PILOT_STATEMENT_VERSION;
  const rows: Row[] = [];
  if ((over.signatures ?? 0) >= 1) rows.push({ id: "so1", statementVersion: v, acknowledgedById: "adm0", acknowledgedAt: NOW });
  if ((over.signatures ?? 0) >= 2) rows.push({ id: "so1b", statementVersion: v, acknowledgedById: "adm1", acknowledgedAt: new Date(NOW.getTime() + 1000) });
  const db = {
    activeSignoffs: async () => rows,
    createSignoff: async (s: { statementVersion: string; acknowledgedById: string; acknowledgedAt: Date }) => { rows.push({ id: `so${rows.length + 2}`, ...s }); log.signoffs.push({ by: s.acknowledgedById, version: s.statementVersion }); },
    audit: async (e: { action: string }) => { log.audits.push(e.action); },
  } as unknown as PilotDb;
  const facts = (): PilotFacts => ({ listedUsers: over.listed ?? 2, firstListedAt: NOW, firstListedById: "adm0", signoffs: rows.map((r) => ({ statementVersion: r.statementVersion, acknowledgedById: r.acknowledgedById, acknowledgedAt: r.acknowledgedAt })) });
  const adapter = createAiPilotSignoffAdapter({ db, loadFacts: async () => facts() });
  const svc = createApprovalService({ adapters: { "ai-pilot-signoff": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { db, log, adapter, svc, facts, rows: () => rows };
}
const REF = `ai-pilot-signoff:${PILOT_STATEMENT_VERSION}`;

describe("AI pilot sign-off view (four-eyes: a compliance reviewer and a different Admin)", () => {
  it("is requested while people are listed and the current wording is unsigned", () => {
    const v = toCanonicalSignoff(world().facts(), NOW)!;
    expect(v).toMatchObject({ kind: "ai-pilot-signoff", id: PILOT_STATEMENT_VERSION, state: "requested", fourEyesAuthorId: null, autonomy: "L4", clientId: null });
    expect(v.evidence.find((e) => e.key === "statement")?.value).toBe(PILOT_STATEMENT.join("\n"));
    expect(v.summary).toMatch(/compliance/i);
  });
  it("with the compliance signature in, it is STILL requested, names the countersignature and blocks that signer from approving it too", () => {
    const v = toCanonicalSignoff(world({ signatures: 1 }).facts(), NOW)!;
    expect(v).toMatchObject({ state: "requested", legacyState: "AWAITING_COUNTERSIGNATURE", fourEyesAuthorId: "adm0" });
    expect(v.summary).toMatch(/different Admin/i);
    expect(v.evidence.find((e) => e.key === "signatures")?.value).toMatch(/compliance/i);
  });
  it("is approved only when two different people have signed the current wording", () => {
    const v = toCanonicalSignoff(world({ signatures: 2 }).facts(), NOW)!;
    expect(v).toMatchObject({ state: "approved", legacyState: "SIGNED", approver: { id: "adm1" } });
  });
  it("two signatures by the same person are not an approval", () => {
    const f = world({ signatures: 1 }).facts();
    f.signoffs = [...f.signoffs, { ...f.signoffs[0], acknowledgedAt: new Date(NOW.getTime() + 1) }];
    expect(toCanonicalSignoff(f, NOW)?.state).toBe("requested");
  });
  it("is requested again for a new wording, and absent when nobody is listed", () => {
    expect(toCanonicalSignoff(world({ signatures: 2, oldVersion: true }).facts(), NOW)?.state).toBe("requested");
    expect(toCanonicalSignoff(world({ listed: 0 }).facts(), NOW)).toBeUndefined();
  });
  it("is for Admins only", async () => {
    const w = world();
    expect(await w.adapter.get(PILOT_STATEMENT_VERSION, admin, NOW)).not.toBeNull();
    expect(await w.adapter.get(PILOT_STATEMENT_VERSION, manager, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(manager, NOW, 5)).toEqual([]);
  });
});

describe("AI pilot sign-off: the canonical path gives the same outcome as the legacy path", () => {
  it("the first Admin ticks the acknowledgement: the same row and audit as the legacy action, and the pilot is still NOT unlocked", async () => {
    const a = world();
    const b = world();
    const legacy = await recordSignoff(a.db, admin, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    const canon = await b.svc.decide(admin, REF, "approve", { params: { acknowledged: true } });
    expect(legacy).toEqual({ ok: true, changed: true });
    expect(canon).toMatchObject({ ok: true });
    expect(b.log).toEqual(a.log);
    expect(b.rows()).toHaveLength(1);
    expect(b.rows()[0]).toMatchObject({ statementVersion: PILOT_STATEMENT_VERSION, acknowledgedById: "adm" });
    expect(toCanonicalSignoff(b.facts(), NOW)?.state).toBe("requested");
  });

  it("the SAME Admin cannot countersign: refused as self-approval by the canonical service (and by the legacy action), nothing recorded", async () => {
    const a = world({ signatures: 1 });
    const b = world({ signatures: 1 });
    const first = { id: "adm0", role: "ADMIN" } as const;
    expect(await a.svc.decide(first, REF, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(await recordSignoff(b.db, first, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW)).toMatchObject({ ok: false });
    expect(a.log.signoffs).toEqual([]);
    expect(b.log.signoffs).toEqual([]);
  });

  it("a DIFFERENT Admin countersigns: both paths record one row and one audit, and the pilot unlocks", async () => {
    const a = world({ signatures: 1 });
    const b = world({ signatures: 1 });
    expect(await recordSignoff(a.db, admin2, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW)).toEqual({ ok: true, changed: true });
    expect(await b.svc.decide(admin2, REF, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: true });
    expect(b.log).toEqual(a.log);
    expect(toCanonicalSignoff(b.facts(), NOW)).toMatchObject({ state: "approved", approver: { id: "adm2" } });
  });

  it("without the acknowledgement nothing is recorded", async () => {
    const w = world();
    expect(await w.svc.decide(admin, REF, "approve", {})).toMatchObject({ ok: false, code: "NEEDS_INPUT" });
    expect(w.log.signoffs).toEqual([]);
  });

  it("a manager is refused and nothing is recorded; there is no reject", async () => {
    const w = world();
    expect(await w.svc.decide(manager, REF, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await w.svc.decide(admin, REF, "reject", { reason: "no" })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(w.log.signoffs).toEqual([]);
  });

  it("an already complete wording is not signed again", async () => {
    const w = world({ signatures: 2 });
    expect(await w.svc.decide(admin, REF, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(w.log.signoffs).toEqual([]);
  });

  it("an old wording version in the handle is refused as stale", async () => {
    const w = world();
    expect(await w.svc.decide(admin, "ai-pilot-signoff:2025-old", "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(w.log.signoffs).toEqual([]);
  });
});
