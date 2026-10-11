import { describe, expect, it } from "vitest";

import { FakeStore } from "@/lib/referrals/fake-store";
import { approveStatement, prepareStatement } from "@/lib/referrals/statements";
import type { NewLedgerEntry } from "@/lib/referrals/store";

import { createApprovalService } from "../service";
import { createReferralStatementAdapter, toCanonicalStatement, type StatementView } from "./referral-statement";

const NOW = new Date("2027-04-20T09:00:00Z");
const preparer = { id: "u-prep", role: "FINANCE" } as const;
const checker = { id: "u-admin", role: "ADMIN" } as const;
const rm = { id: "u-rm", role: "RM" } as const;

async function world(opts: { on?: boolean } = {}) {
  const store = new FakeStore();
  const accrue = async (key: string, amountPaise: number) => {
    const e: NewLedgerEntry = { idempotencyKey: key, kind: "ACCRUED", referrerId: "R", referralId: "rf", eventType: "KYC_COMPLETE", ruleId: "r", refEntryId: null, statementId: null, amountPaise, periodMonth: "2027-01", flags: [], note: null, actorId: null };
    await store.appendEntries([e]);
  };
  await accrue("a", 10000);
  await accrue("b", 5000);
  const prep = (await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-01" })) as { statementId: string };
  const view = (s = store.statements.find((x) => x.id === prep.statementId)!): StatementView => ({ ...s, referrerLabel: "Referrer R-001", preparedAt: NOW, approvedAt: null, preparerName: "Fiona" });
  const adapter = createReferralStatementAdapter({
    store, enabled: () => opts.on ?? true,
    loadAwaiting: async () => store.statements.filter((s) => s.status === "PREPARED").map(view),
    loadPreparedBy: async (id) => store.statements.filter((s) => s.preparedById === id).map(view),
    loadView: async (id) => { const s = store.statements.find((x) => x.id === id); return s ? view(s) : null; },
  });
  const svc = createApprovalService({ adapters: { "referral-statement": adapter }, now: () => NOW, audit: async () => undefined, writeThrough: () => false, mirror: async () => undefined, consentGate: () => undefined });
  return { store, id: prep.statementId, adapter, svc, view };
}
const snap = (w: Awaited<ReturnType<typeof world>>) => ({ statements: w.store.statements.map((s) => ({ status: s.status, approvedById: s.approvedById })), ledger: w.store.ledger.map((e) => `${e.kind}:${e.key}:${e.amountPaise}`).sort() });

describe("referral statement view", () => {
  it("maps PREPARED, APPROVED and PAID", async () => {
    const w = await world();
    const base = w.view();
    expect(toCanonicalStatement({ ...base, status: "PREPARED" }).state).toBe("requested");
    expect(toCanonicalStatement({ ...base, status: "APPROVED" }).state).toBe("approved");
    expect(toCanonicalStatement({ ...base, status: "PAID" }).state).toBe("executed");
  });

  it("shows the total in rupees and the lines, names the preparer for four-eyes, and carries the chain", async () => {
    const w = await world();
    const v = toCanonicalStatement(w.view());
    expect(v).toMatchObject({ kind: "referral-statement", requestedBy: { id: "u-prep", name: "Fiona" }, fourEyesAuthorId: "u-prep", autonomy: "L4", clientId: null, correlationId: `approval:referral-statement:${w.id}` });
    expect(v.evidence.find((e) => e.key === "total")?.value).toBe("₹150.00");
    expect(v.evidence.find((e) => e.key === "lines")?.value).toBe("2 rewards, 2027-01");
    expect(v.subject).toMatchObject({ type: "Reward statement", label: "Referrer R-001 · 2027-01" });
  });

  it("is invisible outside Admin and Finance, and while the programme is off", async () => {
    const w = await world();
    expect(await w.adapter.get(w.id, rm, NOW)).toBeNull();
    expect(await w.adapter.listAwaiting(rm, NOW, 10)).toEqual([]);
    const off = await world({ on: false });
    expect(await off.adapter.get(off.id, checker, NOW)).toBeNull();
    expect(await off.adapter.listAwaiting(checker, NOW, 10)).toEqual([]);
  });
});

describe("referral statement: the canonical path gives the same outcome as the legacy path", () => {
  it("a second person approves: the same statement state and the same ledger rows", async () => {
    const a = await world();
    const b = await world();
    const legacy = await approveStatement({ store: a.store, actor: checker, statementId: a.id });
    const canon = await b.svc.decide(checker, `referral-statement:${b.id}`, "approve", {});
    expect(legacy.ok && canon.ok).toBe(true);
    expect(snap(b)).toEqual(snap(a));
    expect(canon).toMatchObject({ ok: true, state: "approved" });
  });

  it("four-eyes: the person who prepared it cannot approve it, in either path", async () => {
    const a = await world();
    const b = await world();
    expect((await approveStatement({ store: a.store, actor: preparer, statementId: a.id })).ok).toBe(false);
    expect(await b.svc.decide(preparer, `referral-statement:${b.id}`, "approve", {})).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
    expect(snap(b)).toEqual(snap(a));
    expect(b.store.statements[0].status).toBe("PREPARED");
  });

  it("a statement whose lines changed after it was prepared is refused, nothing written", async () => {
    const a = await world();
    const b = await world();
    for (const w of [a, b]) await w.store.appendEntries([{ idempotencyKey: "rev", kind: "REVERSED", referrerId: "R", referralId: null, eventType: null, ruleId: null, refEntryId: w.store.ledger[0].id, statementId: null, amountPaise: -10000, periodMonth: "2027-01", flags: [], note: "wrong", actorId: "u-x" }]);
    const legacy = await approveStatement({ store: a.store, actor: checker, statementId: a.id });
    const canon = await b.svc.decide(checker, `referral-statement:${b.id}`, "approve", {});
    expect(legacy.ok).toBe(false);
    expect(canon).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(snap(b)).toEqual(snap(a));
  });

  it("two approvers at once: exactly one approval and one set of ledger rows", async () => {
    const w = await world();
    const other = { id: "u-fin2", role: "FINANCE" } as const;
    const before = w.store.ledger.length;
    const [r1, r2] = await Promise.all([w.svc.decide(checker, `referral-statement:${w.id}`, "approve", {}), w.svc.decide(other, `referral-statement:${w.id}`, "approve", {})]);
    expect([r1, r2].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect(w.store.statements[0].status).toBe("APPROVED");
    expect(w.store.ledger.length - before).toBe(2); // one APPROVED entry per line, once
  });

  it("an RM is refused before anything is read, and there is no reject path (prepare again instead)", async () => {
    const w = await world();
    expect(await w.svc.decide(rm, `referral-statement:${w.id}`, "approve", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await w.svc.decide(checker, `referral-statement:${w.id}`, "reject", { reason: "wrong month" })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
    expect(w.store.statements[0].status).toBe("PREPARED");
  });

  it("an approved statement cannot be approved again", async () => {
    const w = await world();
    await w.svc.decide(checker, `referral-statement:${w.id}`, "approve", {});
    const n = w.store.ledger.length;
    expect(await w.svc.decide(checker, `referral-statement:${w.id}`, "approve", {})).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
    expect(w.store.ledger).toHaveLength(n);
  });
});
