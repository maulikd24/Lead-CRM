import { describe, expect, it } from "vitest";

import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";
import { recordSignoff, type PilotDb } from "@/lib/agents/pilot-service";

import { createApprovalService } from "../service";
import { createAiPilotSignoffAdapter, toCanonicalSignoff, type PilotFacts } from "./ai-pilot-signoff";

const NOW = new Date("2027-04-20T09:00:00Z");
const admin = { id: "adm", role: "ADMIN" } as const;
const manager = { id: "mgr", role: "MANAGER" } as const;

function world(over: { listed?: number; signed?: boolean; oldVersion?: boolean } = {}) {
  const log: { audits: string[]; signoffs: { by: string; version: string }[] } = { audits: [], signoffs: [] };
  let signoff: { id: string; statementVersion: string; acknowledgedById: string; acknowledgedAt: Date } | null = over.signed ? { id: "so1", statementVersion: over.oldVersion ? "2025-old" : PILOT_STATEMENT_VERSION, acknowledgedById: "adm0", acknowledgedAt: NOW } : null;
  const db = {
    currentSignoff: async () => signoff,
    createSignoff: async (s: { statementVersion: string; acknowledgedById: string; acknowledgedAt: Date }) => { signoff = { id: "so2", ...s }; log.signoffs.push({ by: s.acknowledgedById, version: s.statementVersion }); },
    audit: async (e: { action: string }) => { log.audits.push(e.action); },
  } as unknown as PilotDb;
  const facts = (): PilotFacts => ({ listedUsers: over.listed ?? 2, firstListedAt: NOW, firstListedById: "adm0", signoff: signoff && { statementVersion: signoff.statementVersion, acknowledgedById: signoff.acknowledgedById, acknowledgedAt: signoff.acknowledgedAt } });
  const adapter = createAiPilotSignoffAdapter({ db, loadFacts: async () => facts() });
  const svc = createApprovalService({ adapters: { "ai-pilot-signoff": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { db, log, adapter, svc, facts, signed: () => signoff };
}
const REF = `ai-pilot-signoff:${PILOT_STATEMENT_VERSION}`;

describe("AI pilot sign-off view", () => {
  it("is requested while people are listed and the current wording is unsigned", () => {
    const v = toCanonicalSignoff(world().facts(), NOW)!;
    expect(v).toMatchObject({ kind: "ai-pilot-signoff", id: PILOT_STATEMENT_VERSION, state: "requested", fourEyesAuthorId: null, autonomy: "L4", clientId: null });
    expect(v.evidence.find((e) => e.key === "statement")?.value).toBe(PILOT_STATEMENT.join("\n"));
  });
  it("is approved once the current wording is signed, requested again for a new wording, and absent when nobody is listed", () => {
    expect(toCanonicalSignoff(world({ signed: true }).facts(), NOW)?.state).toBe("approved");
    expect(toCanonicalSignoff(world({ signed: true, oldVersion: true }).facts(), NOW)?.state).toBe("requested");
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
  it("an Admin ticks the acknowledgement: the same sign-off row and audit as the legacy action", async () => {
    const a = world();
    const b = world();
    const legacy = await recordSignoff(a.db, admin, { confirmed: true, statementVersion: PILOT_STATEMENT_VERSION }, NOW);
    const canon = await b.svc.decide(admin, REF, "approve", { params: { acknowledged: true } });
    expect(legacy).toEqual({ ok: true, changed: true });
    expect(canon).toMatchObject({ ok: true });
    expect(b.log).toEqual(a.log);
    expect(b.signed()).toMatchObject({ statementVersion: PILOT_STATEMENT_VERSION, acknowledgedById: "adm" });
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

  it("an already signed wording is not signed twice", async () => {
    const w = world({ signed: true });
    expect(await w.svc.decide(admin, REF, "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(w.log.signoffs).toEqual([]);
  });

  it("an old wording version in the handle is refused as stale", async () => {
    const w = world();
    expect(await w.svc.decide(admin, "ai-pilot-signoff:2025-old", "approve", { params: { acknowledged: true } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(w.log.signoffs).toEqual([]);
  });
});
