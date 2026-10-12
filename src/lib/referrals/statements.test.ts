import { beforeEach, describe, expect, it } from "vitest";

import { FakeStore } from "./fake-store";
import { accrualStates } from "./ledger";
import { approveStatement, clearReview, markStatementPaid, prepareStatement, reverseEntry } from "./statements";
import type { NewLedgerEntry } from "./store";

const admin = { id: "u-admin", role: "ADMIN" as const };
const fin = { id: "u-fin", role: "FINANCE" as const };
let store: FakeStore;

const accrue = async (key: string, amountPaise: number, over: Partial<NewLedgerEntry> = {}) => {
  const e: NewLedgerEntry = { idempotencyKey: key, kind: "ACCRUED", referrerId: "R", referralId: "rf", eventType: "KYC_COMPLETE", ruleId: "r", refEntryId: null, statementId: null, amountPaise, periodMonth: "2027-01", flags: [], note: null, actorId: null, ...over };
  await store.appendEntries([e]);
  return store.ledger.find((x) => x.key === key)!;
};
const states = async () => accrualStates(await store.ledgerForReferrer("R"));

beforeEach(() => {
  store = new FakeStore();
});

describe("statement workflow", () => {
  it("prepare > approve by someone else > mark paid with a bank reference", async () => {
    const a = await accrue("a", 10000);
    const b = await accrue("b", 5000);
    const prep = await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" });
    expect(prep).toMatchObject({ ok: true, totalPaise: 15000 });
    const id = (prep as { statementId: string }).statementId;

    expect(await approveStatement({ store, actor: admin, statementId: id })).toMatchObject({ ok: false });
    expect((await states()).get(a.id)).toBe("ACCRUED");

    expect(await approveStatement({ store, actor: fin, statementId: id })).toEqual({ ok: true });
    expect([(await states()).get(a.id), (await states()).get(b.id)]).toEqual(["APPROVED", "APPROVED"]);

    expect(await markStatementPaid({ store, actor: fin, statementId: id, bankReference: "" })).toMatchObject({ ok: false });
    expect(await markStatementPaid({ store, actor: fin, statementId: id, bankReference: "UTR2027011234567" })).toEqual({ ok: true });
    expect((await states()).get(a.id)).toBe("PAID");
    expect(store.statements[0]).toMatchObject({ status: "PAID", bankReference: "UTR2027011234567" });
  });
  it("approval and paid marks are exactly-once: a repeat changes nothing", async () => {
    await accrue("a", 10000);
    const id = ((await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" })) as { statementId: string }).statementId;
    await approveStatement({ store, actor: fin, statementId: id });
    const n = store.ledger.length;
    expect((await approveStatement({ store, actor: fin, statementId: id })).ok).toBe(false);
    expect(store.ledger).toHaveLength(n);
  });
  it("refuses an approval if a line was reversed after the statement was prepared", async () => {
    const a = await accrue("a", 10000);
    await accrue("b", 5000);
    const id = ((await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" })) as { statementId: string }).statementId;
    expect(await reverseEntry({ store, actor: admin, referrerId: "R", entryId: a.id, reason: "Duplicate account" })).toEqual({ ok: true });
    const r = await approveStatement({ store, actor: fin, statementId: id });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/prepare/i);
    const re = await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" });
    expect(re).toMatchObject({ ok: true, totalPaise: 5000 });
  });
  it("review entries stay off the statement until cleared", async () => {
    const f = await accrue("f", 7000, { flags: ["VELOCITY"] });
    expect((await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" })).ok).toBe(false);
    expect(await clearReview({ store, actor: fin, referrerId: "R", entryId: f.id, note: "Checked, genuine friends" })).toEqual({ ok: true });
    expect((await prepareStatement({ store, actor: admin, referrerId: "R", period: "2027-01" })).ok).toBe(true);
  });
  it("reversal and clearance are idempotent and role-checked", async () => {
    const a = await accrue("a", 100);
    expect((await reverseEntry({ store, actor: { id: "m", role: "MANAGER" }, referrerId: "R", entryId: a.id, reason: "x y z" })).ok).toBe(false);
    expect((await reverseEntry({ store, actor: fin, referrerId: "R", entryId: a.id, reason: "Duplicate account" })).ok).toBe(true);
    expect((await reverseEntry({ store, actor: fin, referrerId: "R", entryId: a.id, reason: "Duplicate account" })).ok).toBe(false);
    expect(store.ledger.filter((e) => e.kind === "REVERSED")).toHaveLength(1);
  });
  it("an entry of another referrer cannot be reversed through this referrer", async () => {
    const other = await accrue("o", 100, { referrerId: "Z" });
    expect((await reverseEntry({ store, actor: fin, referrerId: "R", entryId: other.id, reason: "Duplicate account" })).ok).toBe(false);
  });
});
